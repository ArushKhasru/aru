import process from 'node:process';

import { CliError, assertExecutableCommand } from '../commands/shared.js';
import { normalizeUrl, openTarget } from './browser.js';
import { launchDetached } from './process.js';
import { getProjectOpenUrls } from './resolver.js';

export async function openWorkspace(project, options = {}) {
  const results = [];
  const failures = [];

  if (options.editor !== false) {
    await collectOpenResult(results, failures, 'Editor', project.path, () => launchEditor(project.editor, project.path));
  }

  if (options.browser !== false) {
    for (const url of getProjectOpenUrls(project)) {
      const normalizedUrl = normalizeUrl(url);
      await collectOpenResult(results, failures, 'Browser', normalizedUrl, () => openTarget(normalizedUrl, project.browserCommand));
    }
  }

  if (options.terminal !== false) {
    await collectOpenResult(results, failures, 'Terminal', project.path, () => launchTerminal(project.path, project.shell));
  }

  if (options.explorer !== false) {
    await collectOpenResult(results, failures, 'File Explorer', project.path, () => launchExplorer(project.path));
  }

  return { results, failures };
}

export async function launchEditor(editor, targetPath) {
  const launcher = getEditorCommand(editor, targetPath);

  try {
    await assertExecutableCommand(editor, 'Editor command');
    await launchDetached(launcher.command, launcher.args);
  } catch (error) {
    throw new CliError(`Editor not found: ${editor}. Set defaults.editor or this project's editor to an installed command.`, {
      cause: error,
    });
  }
}

export function getEditorCommand(editor, targetPath) {
  if (process.platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', editor, targetPath] };
  }

  return { command: editor, args: [targetPath] };
}

export async function launchTerminal(targetPath, shell) {
  const launcher = getTerminalCommand(targetPath, shell);

  try {
    await launchDetached(launcher.command, launcher.args);
  } catch (error) {
    throw new CliError(`Could not open terminal for ${targetPath}.`, { cause: error });
  }
}

export async function launchExplorer(targetPath) {
  const launcher = getExplorerCommand(targetPath);

  try {
    await launchDetached(launcher.command, launcher.args);
  } catch (error) {
    throw new CliError(`Could not open file explorer for ${targetPath}.`, { cause: error });
  }
}

export function getTerminalCommand(targetPath, shell = 'default') {
  const selectedShell = String(shell || 'default').toLowerCase();

  if (process.platform === 'win32') {
    if (['wt', 'windows-terminal', 'windowsterminal'].includes(selectedShell)) {
      return { command: 'wt', args: ['-d', targetPath] };
    }

    if (selectedShell.includes('cmd')) {
      return { command: 'cmd', args: ['/c', 'start', '', 'cmd', '/k', `cd /d "${targetPath}"`] };
    }

    const command = selectedShell.includes('pwsh') ? 'pwsh' : 'powershell';
    return {
      command: 'cmd',
      args: [
        '/c',
        'start',
        '',
        command,
        '-NoExit',
        '-Command',
        `Set-Location -LiteralPath '${escapePowerShellSingleQuoted(targetPath)}'`,
      ],
    };
  }

  if (process.platform === 'darwin') {
    return { command: 'open', args: ['-a', 'Terminal', targetPath] };
  }

  const terminal = process.env.TERMINAL || 'x-terminal-emulator';
  if (terminal.includes('gnome-terminal')) {
    return { command: terminal, args: [`--working-directory=${targetPath}`] };
  }

  if (terminal.includes('xfce4-terminal') || terminal.includes('mate-terminal')) {
    return { command: terminal, args: [`--working-directory=${targetPath}`] };
  }

  if (terminal.includes('konsole')) {
    return { command: terminal, args: ['--workdir', targetPath] };
  }

  return { command: terminal, args: [] };
}

export function getExplorerCommand(targetPath) {
  if (process.platform === 'win32') {
    return { command: 'explorer', args: [targetPath] };
  }

  if (process.platform === 'darwin') {
    return { command: 'open', args: [targetPath] };
  }

  return { command: 'xdg-open', args: [targetPath] };
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replaceAll("'", "''");
}

async function collectOpenResult(results, failures, label, target, task) {
  try {
    await task();
    results.push({ label, target });
  } catch (error) {
    failures.push({
      label,
      target,
      message: error.message,
      error,
    });
  }
}
