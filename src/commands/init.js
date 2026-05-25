import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import inquirer from 'inquirer';

import {
  CONFIG_PATH,
  getDefaultConfig,
  handleCommandError,
  pathExists,
  resolveUserPath,
  saveGlobalConfig,
} from './shared.js';

const PROVIDERS = {
  gemini: { label: 'Gemini', envKey: 'GEMINI_API_KEY', model: 'gemini-2.0-flash' },
  openai: { label: 'OpenAI', envKey: 'OPENAI_API_KEY', model: 'gpt-4o-mini' },
  ollama: { label: 'Ollama', envKey: 'LLAMA_API_KEY', model: 'llama3.1' },
};

export function registerInitCommand(program) {
  program
    .command('init')
    .description('Run first-time perky setup')
    .option('--force', 'Overwrite existing global perky config')
    .addHelpText('after', `

Examples:
  $ perky init
  $ perky init --force
`)
    .action(async (options) => {
      try {
        await init(options);
      } catch (error) {
        handleCommandError(error);
      }
    });
}

export async function init(options = {}) {
  console.log('perky-cli setup\n');

  if (await pathExists(CONFIG_PATH)) {
    const shouldContinue = options.force || (await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `Config already exists at ${CONFIG_PATH}. Overwrite it?`,
        default: false,
      },
    ])).overwrite;

    if (!shouldContinue) {
      console.log('Canceled.');
      return;
    }
  }

  const providerAnswer = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: 'AI provider',
      choices: Object.entries(PROVIDERS).map(([value, provider]) => ({
        name: provider.label,
        value,
      })),
      default: 'gemini',
    },
  ]);

  const provider = PROVIDERS[providerAnswer.provider];
  const setupAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'model',
      message: 'Model',
      default: provider.model,
    },
    {
      type: 'password',
      name: 'apiKey',
      message: provider.envKey ? `${provider.envKey} (leave blank to use an existing environment variable)` : 'Ollama does not require an API key. Press enter.',
      mask: '*',
      when: () => Boolean(provider.envKey),
    },
    {
      type: 'input',
      name: 'editor',
      message: 'Default editor command',
      default: 'code',
    },
    {
      type: 'confirm',
      name: 'addProject',
      message: 'Register the current directory as a project?',
      default: true,
    },
    {
      type: 'input',
      name: 'projectName',
      message: 'Project name',
      default: path.basename(process.cwd()),
      when: (answers) => answers.addProject,
      validate: (value) => Boolean(value.trim()) || 'Enter a project name.',
    },
    {
      type: 'input',
      name: 'projectUrl',
      message: 'Project browser URL',
      default: '',
      when: (answers) => answers.addProject,
    },
  ]);

  const config = getDefaultConfig();
  config.ai.provider = providerAnswer.provider;
  config.ai.model = setupAnswers.model;
  config.defaults.editor = setupAnswers.editor;

  if (provider.envKey) {
    config.ai.apiKeyEnv = provider.envKey;
  }

  if (setupAnswers.addProject) {
    config.projects[setupAnswers.projectName] = {
      path: resolveUserPath(process.cwd()),
      browser: setupAnswers.projectUrl || undefined,
      editor: setupAnswers.editor,
    };
  }

  await saveGlobalConfig(config);

  if (provider.envKey && setupAnswers.apiKey) {
    await upsertEnvValue(path.join(process.cwd(), '.env'), provider.envKey, setupAnswers.apiKey);
  }

  console.log(`\nWrote ${CONFIG_PATH}`);
  if (provider.envKey && setupAnswers.apiKey) {
    console.log(`Updated .env with ${provider.envKey}.`);
  }
  console.log('Setup complete. Try: perky ask "What can you do?"');
}

async function upsertEnvValue(envPath, key, value) {
  let current = '';
  try {
    current = await fs.readFile(envPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm');
  const next = pattern.test(current)
    ? current.replace(pattern, line)
    : `${current.trimEnd()}${current.trim() ? '\n' : ''}${line}\n`;

  await fs.writeFile(envPath, next, 'utf8');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
