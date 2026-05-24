import path from 'node:path';
import process from 'node:process';

import inquirer from 'inquirer';

import {
  CONFIG_PATH,
  CliError,
  deleteByPath,
  getByPath,
  handleCommandError,
  launchEditor,
  loadGlobalConfig,
  parseConfigValue,
  resolveUserPath,
  saveGlobalConfig,
  setByPath,
  validateConfigValue,
} from './shared.js';

export function registerConfigCommand(program) {
  const configCommand = program
    .command('config')
    .description('Manage global kaks configuration');

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
  const answers = await promptForMissingProjectFields(name, options);
  const projectPath = resolveUserPath(answers.path);

  config.projects ??= {};
  config.projects[name] = {
    path: projectPath,
    browser: answers.browser || undefined,
    editor: answers.editor || undefined,
  };

  await saveGlobalConfig(config);
  console.log(`Added project "${name}" -> ${projectPath}`);
}

export async function removeProject(name, options = {}) {
  const config = await loadGlobalConfig();

  if (!config.projects?.[name]) {
    throw new CliError(`Project not found: ${name}`);
  }

  if (!options.yes) {
    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: `Remove project "${name}"?`,
        default: false,
      },
    ]);

    if (!confirmed) {
      console.log('Canceled.');
      return;
    }
  }

  deleteByPath(config, `projects.${name}`);
  await saveGlobalConfig(config);
  console.log(`Removed project "${name}".`);
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

  const answers = questions.length ? await inquirer.prompt(questions) : {};

  return {
    path: options.path ?? answers.path,
    browser: options.browser ?? answers.browser,
    editor: options.editor ?? answers.editor,
  };
}
