import path from 'node:path';
import process from 'node:process';

import inquirer from 'inquirer';

import {
  CONFIG_PATH,
  CliError,
  assertExecutableCommand,
  deleteByPath,
  getByPath,
  handleCommandError,
  loadGlobalConfig,
  parseConfigValue,
  resolveExistingDirectoryPath,
  resolveUserPath,
  saveGlobalConfig,
  setByPath,
  validateConfigValue,
} from './shared.js';
import { launchEditor } from '../workspace/opener.js';
import { resolveStoredProjectName } from '../workspace/resolver.js';

export function registerConfigCommand(program) {
  const configCommand = program
    .command('config')
    .description('Manage global perky configuration');

  configCommand
    .command('set <key> <value>')
    .description('Set a config value using dot notation')
    .action(async (key, rawValue) => {
      try {
        await setConfig(key, rawValue);
      } catch (error) {
        handleCommandError(error);
      }
    });

  configCommand
    .command('get <key>')
    .description('Read a config value using dot notation')
    .action(async (key) => {
      try {
        await getConfig(key);
      } catch (error) {
        handleCommandError(error);
      }
    });

  configCommand
    .command('list')
    .description('Print the full global configuration')
    .action(async () => {
      try {
        await listConfig();
      } catch (error) {
        handleCommandError(error);
      }
    });

  configCommand
    .command('add-project <name>')
    .description('Register a project preset')
    .option('--path <path>', 'Project root path')
    .option('--browser <url>', 'Default URL to open for this project')
    .option('--editor <editor>', 'Editor command for this project')
    .option('--start <cmd>', 'Project-level start command, e.g. "npm run dev"')
    .option('--service <spec>', 'Add a service as "name=cmd" or "name@cwd=cmd"', collectOption, [])
    .option('--yes', 'Overwrite an existing project without confirmation')
    .action(async (name, options) => {
      try {
        await addProject(name, options);
      } catch (error) {
        handleCommandError(error);
      }
    });

  configCommand
    .command('remove-project <name>')
    .description('Remove a project preset')
    .option('--yes', 'Skip confirmation')
    .action(async (name, options) => {
      try {
        await removeProject(name, options);
      } catch (error) {
        handleCommandError(error);
      }
    });

  configCommand
    .command('edit')
    .description('Open the global config file in your editor')
    .action(async () => {
      try {
        await editConfig();
      } catch (error) {
        handleCommandError(error);
      }
    });
}

export async function setConfig(key, rawValue) {
  const value = parseConfigValue(rawValue);
  validateConfigValue(key, value);

  const config = await loadGlobalConfig();
  setByPath(config, key, value);
  await saveGlobalConfig(config);
  console.log(`Set ${key}.`);
}

export async function getConfig(key) {
  const config = await loadGlobalConfig();
  const value = getByPath(config, key);

  if (value === undefined) {
    throw new CliError(`Config key not found: ${key}`);
  }

  console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value));
}

export async function listConfig() {
  const config = await loadGlobalConfig();
  console.log(JSON.stringify(config, null, 2));
}

export async function addProject(name, options = {}) {
  const config = await loadGlobalConfig();
  config.projects ??= {};
  const existingName = resolveStoredProjectName(config.projects, name);
  const savedName = existingName ?? name;

  if (existingName && !options.yes) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `Project "${existingName}" already exists. Replace it?`,
        default: false,
      },
    ]);

    if (!overwrite) {
      console.log('Canceled.');
      return;
    }
  }

  const answers = await promptForMissingProjectFields(name, options);
  const projectPath = await resolveExistingDirectoryPath(answers.path, process.cwd(), 'Project path');
  await assertExecutableCommand(answers.editor, 'Editor command');

  const services = parseServices(answers.services, projectPath);
  await assertServiceDirectoriesExist(services, projectPath);
  const project = {
    path: projectPath,
    browser: answers.browser || undefined,
    editor: answers.editor || undefined,
    startCmd: answers.start || undefined,
    services: services.length ? services : undefined,
  };

  config.projects[savedName] = removeUndefined(project);

  await saveGlobalConfig(config);
  console.log(`Added project "${savedName}" -> ${projectPath}`);

  if (!project.startCmd && !services.length) {
    console.log(`No start command was saved. Add one later with "perky config set projects.${savedName}.startCmd <cmd>".`);
  }
}

export async function removeProject(name, options = {}) {
  const config = await loadGlobalConfig();
  const savedName = resolveStoredProjectName(config.projects ?? {}, name);

  if (!savedName) {
    throw new CliError(`Project not found: ${name}`);
  }

  if (!options.yes) {
    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: `Remove project "${savedName}"?`,
        default: false,
      },
    ]);

    if (!confirmed) {
      console.log('Canceled.');
      return;
    }
  }

  deleteByPath(config, `projects.${savedName}`);
  await saveGlobalConfig(config);
  console.log(`Removed project "${savedName}".`);
}

export async function editConfig() {
  const config = await loadGlobalConfig();
  await saveGlobalConfig(config);
  await launchEditor(config.defaults?.editor ?? 'code', CONFIG_PATH);
  console.log(`Opening ${CONFIG_PATH}`);
}

async function promptForMissingProjectFields(name, options) {
  const questions = [];

  if (!options.path) {
    questions.push({
      type: 'input',
      name: 'path',
      message: `Path for ${name}`,
      default: process.cwd(),
      filter: (value) => path.resolve(value),
      validate: (value) => Boolean(value.trim()) || 'Enter a project path.',
    });
  }

  if (!options.browser) {
    questions.push({
      type: 'input',
      name: 'browser',
      message: 'Default browser URL',
      default: '',
    });
  }

  if (!options.editor) {
    questions.push({
      type: 'input',
      name: 'editor',
      message: 'Editor command',
      default: '',
    });
  }

  if (!options.start && !options.service?.length) {
    questions.push({
      type: 'input',
      name: 'start',
      message: 'Project start command',
      default: '',
    });
    questions.push({
      type: 'confirm',
      name: 'addServices',
      message: 'Add separate services for perky start?',
      default: false,
    });
    questions.push({
      type: 'input',
      name: 'services',
      message: 'Services',
      default: '',
      when: (answers) => answers.addServices,
      filter: normalizeServiceSpecs,
      validate: (value) => validateServiceSpecs(normalizeServiceSpecs(value)),
    });
  }

  const answers = questions.length ? await inquirer.prompt(questions) : {};

  return {
    path: options.path ?? answers.path,
    browser: options.browser ?? answers.browser,
    editor: options.editor ?? answers.editor,
    start: options.start ?? answers.start,
    services: options.service ?? answers.services ?? [],
  };
}

async function assertDirectoryExists(projectPath) {
  await resolveExistingDirectoryPath(projectPath, process.cwd(), 'Project path');
}

async function assertServiceDirectoriesExist(services, projectPath) {
  for (const service of services) {
    if (service.cwd) {
      await assertDirectoryExists(resolveUserPath(service.cwd, projectPath));
    }
  }
}

function collectOption(value, previous) {
  return [...previous, value];
}

function parseServices(serviceSpecs, projectPath) {
  return normalizeServiceSpecs(serviceSpecs).map((spec) => parseServiceSpec(spec, projectPath));
}

function parseServiceSpec(spec, projectPath) {
  const separatorIndex = spec.indexOf('=');
  if (separatorIndex === -1) {
    throw new CliError(`Invalid service "${spec}". Use "name=cmd" or "name@cwd=cmd".`);
  }

  const left = spec.slice(0, separatorIndex).trim();
  const cmd = spec.slice(separatorIndex + 1).trim();
  const [rawName, rawCwd] = left.split('@');
  const name = rawName?.trim();
  const cwd = rawCwd?.trim();

  if (!name || !cmd) {
    throw new CliError(`Invalid service "${spec}". Use "name=cmd" or "name@cwd=cmd".`);
  }

  return removeUndefined({
    name,
    cmd,
    cwd: cwd ? path.relative(projectPath, resolveUserPath(cwd, projectPath)) || '.' : undefined,
  });
}

function validateServiceSpecs(serviceSpecs) {
  try {
    for (const spec of serviceSpecs) {
      parseServiceSpec(spec, process.cwd());
    }
    return true;
  } catch (error) {
    return error.message;
  }
}

function normalizeServiceSpecs(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
