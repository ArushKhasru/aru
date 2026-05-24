import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import axios from 'axios';
import chalk from 'chalk';
import { execa } from 'execa';
import inquirer from 'inquirer';
import ora from 'ora';

export const CONFIG_DIR = path.join(os.homedir(), '.kaks');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
export const LOCAL_CONFIG_NAME = '.kaks.json';

const AI_PROVIDER_DEFAULTS = {
  gemini: { model: 'gemini-2.0-flash', envKey: 'GEMINI_API_KEY' },
  openai: { model: 'gpt-4o-mini', envKey: 'OPENAI_API_KEY' },
  ollama: { model: 'llama3.1', envKey: 'LLAMA_API_KEY' },
};

export class CliError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'CliError';
    this.exitCode = options.exitCode ?? 1;
    this.cause = options.cause;
  }
}

export class AiConfigError extends CliError {
  constructor(provider) {
    const envKey = AI_PROVIDER_DEFAULTS[provider]?.envKey;
    const suffix = envKey ? ` Set ${envKey} or run "kaks init".` : ' Run "kaks init" to configure AI.';
    super(`API key not found for ${provider}.${suffix}`);
    this.name = 'AiConfigError';
  }
}

export function getDefaultConfig() {
  return {
    ai: {
      provider: 'gemini',
      model: AI_PROVIDER_DEFAULTS.gemini.model,
      temperature: 0.7,
      maxTokens: 2048,
    },
    projects: {},
    defaults: {
      editor: 'code',
      browser: 'default',
      shell: process.platform === 'win32' ? 'powershell' : path.basename(process.env.SHELL ?? 'bash'),
    },
  };
}

export async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    if (error instanceof SyntaxError) {
      throw new CliError(`Invalid JSON in ${filePath}: ${error.message}`, { cause: error });
    }

    throw error;
  }
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(`${filePath}.tmp`, filePath);

  if (process.platform !== 'win32') {
    await fs.chmod(filePath, 0o600).catch(() => undefined);
  }
}

export async function loadGlobalConfig() {
  const stored = await readJson(CONFIG_PATH);
  return mergeConfig(getDefaultConfig(), stored ?? {});
}

export async function saveGlobalConfig(config) {
  await writeJson(CONFIG_PATH, mergeConfig(getDefaultConfig(), config));
}

export async function loadLocalConfig(cwd = process.cwd()) {
  return readJson(path.join(cwd, LOCAL_CONFIG_NAME));
}

export function mergeConfig(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }

  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    output[key] = isPlainObject(value) && isPlainObject(base[key])
      ? mergeConfig(base[key], value)
      : value;
  }
  return output;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getByPath(object, keyPath) {
  return keyPath.split('.').reduce((current, key) => current?.[key], object);
}

export function setByPath(object, keyPath, value) {
  const keys = keyPath.split('.');
  let cursor = object;

  for (const key of keys.slice(0, -1)) {
    if (!isPlainObject(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }

  cursor[keys.at(-1)] = value;
}

export function deleteByPath(object, keyPath) {
  const keys = keyPath.split('.');
  const finalKey = keys.pop();
  const parent = keys.reduce((current, key) => current?.[key], object);

  if (parent && Object.hasOwn(parent, finalKey)) {
    delete parent[finalKey];
    return true;
  }

  return false;
}

export function parseConfigValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  if (/^[{[]/.test(value)) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

export function validateConfigValue(key, value) {
  if (key === 'ai.provider' && !Object.hasOwn(AI_PROVIDER_DEFAULTS, value)) {
    throw new CliError('Unsupported provider. Use one of: gemini, openai, ollama.');
  }
}

export function resolveUserPath(inputPath, basePath = process.cwd()) {
  if (!inputPath) {
    return basePath;
  }

  const expanded = inputPath.startsWith('~')
    ? path.join(os.homedir(), inputPath.slice(1))
    : inputPath;

  return path.resolve(basePath, expanded);
}

export async function resolveProject(config, requestedName) {
  const projects = config.projects ?? {};
  const names = Object.keys(projects);

  if (!names.length) {
    throw new CliError('No projects configured. Add one with: kaks config add-project <name> --path <path>');
  }

  const name = requestedName ?? await promptForProjectName(names);

  if (!Object.hasOwn(projects, name)) {
    const suggestion = getClosestMatch(name, names);
    const hint = suggestion ? ` Did you mean "${suggestion}"?` : '';
    throw new CliError(`Unknown project "${name}".${hint}`);
  }

  const project = normalizeProject(name, projects[name], config.defaults ?? {});
  return { name, project };
}

async function promptForProjectName(projectNames) {
  const { name } = await inquirer.prompt([
    {
      type: 'list',
      name: 'name',
      message: 'Choose a project',
      choices: projectNames,
    },
  ]);
  return name;
}

function normalizeProject(name, project, defaults) {
  const projectPath = resolveUserPath(project.path ?? process.cwd());

  return {
    ...project,
    name,
    path: projectPath,
    editor: project.editor ?? defaults.editor ?? 'code',
    browserCommand: project.browserCommand ?? project.browserName ?? defaults.browser ?? 'default',
  };
}

export function getProjectOpenUrls(project) {
  if (Array.isArray(project.openUrls)) {
    return project.openUrls;
  }

  if (typeof project.browser === 'string' && looksLikeUrl(project.browser)) {
    return [project.browser];
  }

  if (typeof project.url === 'string') {
    return [project.url];
  }

  return [];
}

export function getProjectServices(project) {
  const services = [];

  if (Array.isArray(project.services)) {
    services.push(...project.services);
  }

  for (const name of ['frontend', 'backend']) {
    const service = project[name];
    if (service?.startCmd || service?.cmd) {
      services.push({ name, ...service, cmd: service.cmd ?? service.startCmd });
    }
  }

  if (project.startCmd || project.cmd) {
    services.push({
      name: project.name ?? 'app',
      cmd: project.cmd ?? project.startCmd,
      cwd: project.path,
    });
  }

  return services.map((service) => ({
    name: service.name ?? 'service',
    cmd: service.cmd ?? service.startCmd,
    cwd: resolveUserPath(service.cwd ?? service.path ?? project.path, project.path),
    port: service.port,
  })).filter((service) => Boolean(service.cmd));
}

export function normalizeUrl(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) {
    throw new CliError('Missing URL. Try: kaks go example.com');
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(trimmed)) {
    return `http://${trimmed}`;
  }

  return `https://${trimmed}`;
}

export function assertValidUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')
      && parsed.hostname !== 'localhost'
      && !/^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname)) {
      throw new Error('Invalid host');
    }
  } catch (error) {
    throw new CliError("Doesn't look like a valid URL. Try: kaks go example.com", { cause: error });
  }
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(value) || /^[\w.-]+\.[a-z]{2,}/i.test(value) || /^localhost:/i.test(value);
}

export async function openTarget(target, browser = 'default') {
  const { command, args } = getOpenCommand(target, browser);
  const child = execa(command, args, { detached: true, stdio: 'ignore' });
  child.unref?.();
  await child;
}

function getOpenCommand(target, browser) {
  const selectedBrowser = String(browser ?? 'default').toLowerCase();
  const defaultBrowser = !selectedBrowser || selectedBrowser === 'default';

  if (process.platform === 'win32') {
    if (defaultBrowser) {
      return { command: 'cmd', args: ['/c', 'start', '', target] };
    }
    return { command: 'cmd', args: ['/c', 'start', '', windowsBrowserCommand(selectedBrowser), target] };
  }

  if (process.platform === 'darwin') {
    if (defaultBrowser) {
      return { command: 'open', args: [target] };
    }
    return { command: 'open', args: ['-a', macBrowserName(selectedBrowser), target] };
  }

  if (defaultBrowser) {
    return { command: 'xdg-open', args: [target] };
  }

  return { command: linuxBrowserCommand(selectedBrowser), args: [target] };
}

function windowsBrowserCommand(browser) {
  return {
    chrome: 'chrome',
    firefox: 'firefox',
    edge: 'msedge',
  }[browser] ?? browser;
}

function macBrowserName(browser) {
  return {
    chrome: 'Google Chrome',
    firefox: 'Firefox',
    edge: 'Microsoft Edge',
  }[browser] ?? browser;
}

function linuxBrowserCommand(browser) {
  return {
    chrome: 'google-chrome',
    firefox: 'firefox',
    edge: 'microsoft-edge',
  }[browser] ?? browser;
}

export async function launchEditor(editor, targetPath) {
  try {
    const child = execa(editor, [targetPath], { detached: true, stdio: 'ignore' });
    child.unref?.();
    await child;
  } catch (error) {
    throw new CliError(`Editor not found: ${editor}. Set your editor with: kaks config set defaults.editor <path>`, {
      cause: error,
    });
  }
}

export async function launchExplorer(targetPath) {
  const commands = {
    win32: { command: 'explorer', args: [targetPath] },
    darwin: { command: 'open', args: [targetPath] },
    linux: { command: 'xdg-open', args: [targetPath] },
  };
  const launcher = commands[process.platform] ?? commands.linux;

  try {
    const child = execa(launcher.command, launcher.args, { detached: true, stdio: 'ignore' });
    child.unref?.();
    await child;
  } catch (error) {
    throw new CliError(`Could not open file explorer for ${targetPath}.`, { cause: error });
  }
}

export async function copyToClipboard(text) {
  const candidates = process.platform === 'win32'
    ? [{ command: 'clip', args: [] }]
    : process.platform === 'darwin'
      ? [{ command: 'pbcopy', args: [] }]
      : [
        { command: 'wl-copy', args: [] },
        { command: 'xclip', args: ['-selection', 'clipboard'] },
        { command: 'xsel', args: ['--clipboard', '--input'] },
      ];

  for (const candidate of candidates) {
    try {
      await execa(candidate.command, candidate.args, { input: text });
      return;
    } catch {
      // Try the next platform clipboard command.
    }
  }

  throw new CliError('Clipboard command not found on this system.');
}

export async function readStdin() {
  if (process.stdin.isTTY) {
    return '';
  }

  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return input;
}

export async function readTextFileWithLimits(filePath, options = {}) {
  const warnSize = options.warnSize ?? 100 * 1024;
  const maxSize = options.maxSize ?? 500 * 1024;
  const absolutePath = resolveUserPath(filePath);

  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      const suggestion = await suggestSimilarFile(absolutePath);
      const hint = suggestion ? ` Did you mean "${suggestion}"?` : '';
      throw new CliError(`File not found: ${filePath}.${hint}`, { cause: error });
    }
    throw error;
  }

  if (!stat.isFile()) {
    throw new CliError(`Not a file: ${filePath}`);
  }

  const bytesToRead = Math.min(stat.size, maxSize);
  const handle = await fs.open(absolutePath, 'r');
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    const contentBuffer = buffer.subarray(0, bytesRead);

    if (contentBuffer.includes(0)) {
      throw new CliError(`Binary file rejected: ${filePath}`);
    }

    return {
      absolutePath,
      displayPath: path.relative(process.cwd(), absolutePath) || absolutePath,
      content: contentBuffer.toString('utf8'),
      size: stat.size,
      warned: stat.size > warnSize,
      truncated: stat.size > maxSize,
    };
  } finally {
    await handle.close();
  }
}

async function suggestSimilarFile(absolutePath) {
  const directory = path.dirname(absolutePath);
  const basename = path.basename(absolutePath).toLowerCase();

  try {
    const entries = await fs.readdir(directory);
    return entries.find((entry) => entry.toLowerCase().includes(basename.slice(0, 4))) ?? null;
  } catch {
    return null;
  }
}

export function detectLanguage(filePath) {
  const basename = path.basename(filePath).toLowerCase();
  const extension = path.extname(filePath).slice(1).toLowerCase();

  if (basename === 'dockerfile') return 'dockerfile';
  if (['yml', 'yaml'].includes(extension)) return 'yaml';
  if (extension === 'js' || extension === 'mjs' || extension === 'cjs') return 'javascript';
  if (extension === 'ts' || extension === 'tsx') return 'typescript';
  if (extension === 'json') return 'json';
  if (extension === 'md') return 'markdown';
  if (extension === 'py') return 'python';
  if (extension === 'log') return 'log';
  return extension || 'text';
}

export function tailLines(text, count) {
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - count)).join('\n');
}

export function parsePositiveInteger(value, fallback = undefined) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`Expected a positive integer, received: ${value}`);
  }
  return parsed ?? fallback;
}

export function hasAiCredentials(config, provider = config.ai?.provider ?? 'gemini') {
  const normalizedProvider = provider.toLowerCase();
  if (normalizedProvider === 'ollama') {
    return true;
  }

  const envKey = AI_PROVIDER_DEFAULTS[normalizedProvider]?.envKey;
  return Boolean((envKey && process.env[envKey]) || config.ai?.apiKey);
}

export async function completeWithAi({ systemPrompt, userPrompt, config, model }) {
  const provider = String(config.ai?.provider ?? 'gemini').toLowerCase();
  const aiDefaults = AI_PROVIDER_DEFAULTS[provider];

  if (!aiDefaults) {
    throw new CliError(`Unsupported AI provider: ${provider}`);
  }

  const selectedModel = model ?? config.ai?.model ?? aiDefaults.model;
  const temperature = Number(config.ai?.temperature ?? 0.7);
  const maxTokens = Number(config.ai?.maxTokens ?? 2048);

  try {
    if (provider === 'openai') {
      return await completeWithOpenAi({ systemPrompt, userPrompt, model: selectedModel, temperature, maxTokens, config });
    }

    if (provider === 'ollama') {
      return await completeWithOllama({ systemPrompt, userPrompt, model: selectedModel, temperature, maxTokens });
    }

    return await completeWithGemini({ systemPrompt, userPrompt, model: selectedModel, temperature, maxTokens, config });
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw normalizeAiError(error, provider);
  }
}

async function completeWithOpenAi({ systemPrompt, userPrompt, model, temperature, maxTokens, config }) {
  const apiKey = process.env.OPENAI_API_KEY ?? config.ai?.apiKey;
  if (!apiKey) {
    throw new AiConfigError('openai');
  }

  const { data } = await axios.post('https://api.openai.com/v1/chat/completions', {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature,
    max_tokens: maxTokens,
  }, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 60_000,
  });

  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

async function completeWithGemini({ systemPrompt, userPrompt, model, temperature, maxTokens, config }) {
  const apiKey = process.env.GEMINI_API_KEY ?? config.ai?.apiKey;
  if (!apiKey) {
    throw new AiConfigError('gemini');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const { data } = await axios.post(`${endpoint}?key=${apiKey}`, {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  }, {
    timeout: 60_000,
  });

  return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim() ?? '';
}

async function completeWithOllama({ systemPrompt, userPrompt, model, temperature, maxTokens }) {
  const { data } = await axios.post('http://localhost:11434/api/generate', {
    model,
    prompt: `${systemPrompt}\n\n${userPrompt}`,
    stream: false,
    options: {
      temperature,
      num_predict: maxTokens,
    },
  }, {
    timeout: 120_000,
  });

  return data.response?.trim() ?? '';
}

function normalizeAiError(error, provider) {
  if (error.response?.status === 401 || error.response?.status === 403) {
    return new CliError(`Authentication failed for ${provider}. Check your API key.`, { cause: error });
  }

  if (error.response?.status === 429) {
    const retryAfter = error.response.headers?.['retry-after'];
    const suffix = retryAfter ? ` Try again after ${retryAfter} seconds.` : ' Try again later.';
    return new CliError(`Rate limited by ${provider}.${suffix}`, { cause: error });
  }

  if (error.code === 'ECONNABORTED') {
    return new CliError(`Request to ${provider} timed out.`, { cause: error });
  }

  if (!error.response) {
    return new CliError(`Could not reach ${provider}. Check your internet connection or provider service.`, { cause: error });
  }

  return new CliError(`AI request failed: ${error.response.status} ${error.response.statusText ?? ''}`.trim(), {
    cause: error,
  });
}

export async function runWithSpinner(message, task) {
  const spinner = ora(message).start();
  try {
    const result = await task();
    spinner.stop();
    return result;
  } catch (error) {
    spinner.stop();
    throw error;
  }
}

export function handleCommandError(error) {
  const message = error instanceof CliError
    ? error.message
    : `Something went wrong. Error: ${error.message}`;

  const color = error instanceof AiConfigError ? chalk.yellow : chalk.red;
  console.error(color(message));

  if (!(error instanceof CliError) && error.stack && process.env.kaks_DEBUG) {
    console.error(chalk.dim(error.stack));
  }

  process.exitCode = error.exitCode ?? 1;
}

