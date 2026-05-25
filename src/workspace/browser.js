import process from 'node:process';

import { CliError } from '../commands/shared.js';
import { launchDetached } from './process.js';

export function normalizeUrl(input) {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) {
    throw new CliError('Missing URL. Try: perky go example.com');
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
    const validProtocol = ['http:', 'https:'].includes(parsed.protocol);
    const validHost = parsed.hostname.includes('.')
      || parsed.hostname === 'localhost'
      || /^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname);

    if (!validProtocol || !validHost) {
      throw new Error('Invalid URL');
    }
  } catch (error) {
    throw new CliError("Doesn't look like a valid URL. Try: perky go example.com", { cause: error });
  }
}

export async function openTarget(target, browser = 'default') {
  const { command, args } = getOpenCommand(target, browser);
  await launchDetached(command, args);
}

export function getOpenCommand(target, browser = 'default') {
  const selectedBrowser = String(browser || 'default').toLowerCase();
  const useDefaultBrowser = selectedBrowser === 'default';

  if (process.platform === 'win32') {
    return useDefaultBrowser
      ? { command: 'cmd', args: ['/c', 'start', '', target] }
      : { command: 'cmd', args: ['/c', 'start', '', windowsBrowserCommand(selectedBrowser), target] };
  }

  if (process.platform === 'darwin') {
    return useDefaultBrowser
      ? { command: 'open', args: [target] }
      : { command: 'open', args: ['-a', macBrowserName(selectedBrowser), target] };
  }

  return useDefaultBrowser
    ? { command: 'xdg-open', args: [target] }
    : { command: linuxBrowserCommand(selectedBrowser), args: [target] };
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
