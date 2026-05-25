import {
  copyToClipboard,
  handleCommandError,
} from './shared.js';
import { assertValidUrl, normalizeUrl, openTarget } from '../workspace/browser.js';

export function registerGoCommand(program) {
  program
    .command('go <url>')
    .description('Normalize and open a URL quickly')
    .option('--browser <name>', 'Browser override: chrome, firefox, edge, or default', 'default')
    .option('--copy', 'Copy the normalized URL instead of opening it')
    .option('--print', 'Print the normalized URL instead of opening it')
    .addHelpText('after', `

Examples:
  $ perky go github.com
  $ perky go github.com/ArushKhasru/perky
  $ perky go localhost:3000
  $ perky go docs.google.com --copy
`)
    .action(async (url, options) => {
      try {
        await go(url, options);
      } catch (error) {
        handleCommandError(error);
      }
    });
}

export async function go(url, options = {}) {
  const normalizedUrl = normalizeUrl(url);
  assertValidUrl(normalizedUrl);

  if (options.print) {
    console.log(normalizedUrl);
    return;
  }

  if (options.copy) {
    await copyToClipboard(normalizedUrl);
    console.log(`Copied to clipboard: ${normalizedUrl}`);
    return;
  }

  await openTarget(normalizedUrl, options.browser);
  const suffix = options.browser && options.browser !== 'default' ? ` (${options.browser})` : '';
  console.log(`Opening ${normalizedUrl}${suffix}`);
}
