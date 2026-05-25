import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { resolveExistingDirectoryPath } from '../src/commands/shared.js';
import { getEditorCommand } from '../src/workspace/opener.js';
import { launchDetached } from '../src/workspace/process.js';
import { resolveProject, resolveStoredProjectName } from '../src/workspace/resolver.js';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repoRoot, 'cli.js');

test('project names resolve case-insensitively', async () => {
  const root = await makeTempWorkspace();
  const projectDir = await makeMixedCaseProject(root);
  const variantPath = path.join(root, 'mixedparent', 'caseproject');

  const resolved = await resolveProject({
    projects: {
      ctf: {
        path: variantPath,
        browser: 'http://localhost:3000',
      },
    },
    defaults: {
      editor: 'code',
      browser: 'default',
      shell: 'powershell',
    },
  }, 'CTF');

  assert.equal(resolved.name, 'ctf');
  assert.equal(resolved.project.path, projectDir);
  assert.equal(resolved.project.browserCommand, 'default');
});

test('configured project paths are checked before opening', async () => {
  const root = await makeTempWorkspace();
  const missingPath = path.join(root, 'missing-project');

  await assert.rejects(
    () => resolveProject({
      projects: {
        ctf: { path: missingPath },
      },
    }, 'ctf'),
    /Project path does not exist/,
  );
});

test('stored project lookup preserves exact names and accepts case variants', () => {
  const projects = {
    ctf: {},
    OtherApp: {},
  };

  assert.equal(resolveStoredProjectName(projects, 'ctf'), 'ctf');
  assert.equal(resolveStoredProjectName(projects, 'CTF'), 'ctf');
  assert.equal(resolveStoredProjectName(projects, 'otherapp'), 'OtherApp');
  assert.equal(resolveStoredProjectName(projects, 'missing'), null);
});

test('add-project saves an existing directory and open accepts uppercase project input', async () => {
  const root = await makeTempWorkspace();
  const configDir = path.join(root, 'config');
  const projectDir = await makeMixedCaseProject(root);
  const variantPath = path.join(root, 'mixedparent', 'caseproject');

  const addResult = await runCli([
    'config',
    'add-project',
    'ctf',
    '--path',
    variantPath,
    '--browser',
    'http://localhost:3000',
    '--editor',
    process.execPath,
    '--start',
    'npm run dev',
    '--yes',
  ], { perky_CONFIG_DIR: configDir });

  assert.equal(addResult.code, 0, addResult.stderr);
  assert.match(addResult.stdout, /Added project "ctf"/);

  const storedConfig = JSON.parse(await fs.readFile(path.join(configDir, 'config.json'), 'utf8'));
  assert.equal(storedConfig.projects.ctf.path, projectDir);

  const openResult = await runCli([
    'open',
    'CTF',
    '--no-browser',
    '--no-editor',
    '--no-explorer',
    '--no-terminal',
  ], { perky_CONFIG_DIR: configDir });

  assert.equal(openResult.code, 0, openResult.stderr);
  assert.match(openResult.stdout, /Opening project: ctf/);
  assert.match(openResult.stdout, /Project "ctf" is ready\./);
  assert.doesNotMatch(openResult.stderr, /unsettled top-level await/i);
});

test('open reports a missing configured project path', async () => {
  const root = await makeTempWorkspace();
  const configDir = path.join(root, 'config');
  const missingPath = path.join(root, 'missing-project');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, 'config.json'), JSON.stringify({
    projects: {
      ctf: {
        path: missingPath,
        browser: 'http://localhost:3000',
        editor: 'code',
      },
    },
  }, null, 2));

  const result = await runCli([
    'open',
    'ctf',
    '--no-browser',
    '--no-editor',
    '--no-explorer',
    '--no-terminal',
  ], { perky_CONFIG_DIR: configDir });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Project path does not exist/);
});

test('add-project rejects missing editor commands before saving', async () => {
  const root = await makeTempWorkspace();
  const configDir = path.join(root, 'config');
  const projectDir = await makeMixedCaseProject(root);

  const result = await runCli([
    'config',
    'add-project',
    'ctf',
    '--path',
    projectDir,
    '--browser',
    'http://localhost:3000',
    '--editor',
    'perky-missing-editor-command',
    '--start',
    'npm run dev',
    '--yes',
  ], { perky_CONFIG_DIR: configDir });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Editor command not found: perky-missing-editor-command/);
});

test('open reports invalid editor command without unsettled top-level await warning', async () => {
  const root = await makeTempWorkspace();
  const configDir = path.join(root, 'config');
  const projectDir = await makeMixedCaseProject(root);
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, 'config.json'), JSON.stringify({
    projects: {
      ctf: {
        path: projectDir,
        browser: 'http://localhost:3000',
        editor: 'perky-missing-editor-command',
      },
    },
  }, null, 2));

  const result = await runCli([
    'open',
    'ctf',
    '--no-browser',
    '--no-explorer',
    '--no-terminal',
  ], { perky_CONFIG_DIR: configDir });

  assert.equal(result.code, 1);
  assert.match(result.stdout, /Opening project: ctf/);
  assert.match(result.stdout, /Project "ctf" opened with 1 failure\./);
  assert.match(result.stderr, /FAILED Editor/);
  assert.doesNotMatch(result.stderr, /unsettled top-level await/i);
});

test('Windows editor aliases launch through cmd start', { skip: process.platform !== 'win32' }, () => {
  const command = getEditorCommand('code', 'D:\\Projects\\Demo');

  assert.equal(command.command, 'cmd');
  assert.deepEqual(command.args, ['/c', 'start', '', 'code', 'D:\\Projects\\Demo']);
});

test('detached launcher returns after spawn instead of waiting for process exit', async () => {
  const startedAt = Date.now();
  await launchDetached(process.execPath, ['-e', 'setTimeout(() => {}, 1500)']);
  const elapsed = Date.now() - startedAt;

  assert.ok(elapsed < 1000, `expected detached launcher to return quickly, took ${elapsed}ms`);
});

test('existing directories resolve even when path casing differs', async () => {
  const root = await makeTempWorkspace();
  const projectDir = await makeMixedCaseProject(root);
  const variantPath = path.join(root, 'mixedparent', 'caseproject');

  assert.equal(await resolveExistingDirectoryPath(variantPath), projectDir);
});

async function makeTempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'perky-test-'));
}

async function makeMixedCaseProject(root) {
  const projectDir = path.join(root, 'MixedParent', 'CaseProject');
  await fs.mkdir(projectDir, { recursive: true });
  return projectDir;
}

async function runCli(args, env = {}) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      timeout: 5000,
    });

    return {
      code: 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}
