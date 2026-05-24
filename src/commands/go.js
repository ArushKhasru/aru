import {
  assertValidUrl,
  copyToClipboard,
  handleCommandError,
  normalizeUrl,
  openTarget,
} from './shared.js';

export function registerGoCommand(program) {
  program
    .command('go <url>')
    .description('Normalize and open a URL quickly')
    .option('--browser <name>', 'Browser override: chrome, firefox, edge, or default', 'default')
    .option('--copy', 'Copy the normalized URL instead of opening it')
    .option('--print', 'Print the normalized URL instead of opening it')
    .addHelpText('after', `

Examples:
  $ kaks go github.com
  $ kaks go github.com/kaksKhasru/kaks
  $ kaks go localhost:3000
  $ kaks go docs.google.com --copy
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
