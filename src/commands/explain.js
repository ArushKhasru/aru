import { buildExplainPrompt } from '../ai/prompt.js';
import { completeWithAi } from '../ai/provider.js';
import { CliError, detectLanguage, handleCommandError, loadGlobalConfig, readTextFileWithLimits, runWithSpinner } from './shared.js';

const VALID_DETAIL_LEVELS = new Set(['low', 'medium', 'high']);

export function registerExplainCommand(program) {
  program
    .command('explain <filepath>')
    .description('Explain a source, config, or text file with AI')
    .option('--detail <level>', 'Depth of explanation: low, medium, or high', 'medium')
    .option('--section <name>', 'Explain only a named section or topic')
    .option('--model <model>', 'Override the configured model')
    .addHelpText('after', `

Examples:
  $ perky explain docker-compose.yml
  $ perky explain package.json --detail high
  $ perky explain src/app.js --section middleware
`)
    .action(async (filepath, options) => {
      try {
        await explain(filepath, options);
      } catch (error) {
        handleCommandError(error);
      }
    });
}

export async function explain(filepath, options = {}) {
  const detail = String(options.detail ?? 'medium').toLowerCase();
  if (!VALID_DETAIL_LEVELS.has(detail)) {
    throw new CliError('Invalid detail level. Use one of: low, medium, high.');
  }

  const file = await readTextFileWithLimits(filepath);

  if (!file.content.trim()) {
    throw new CliError(`File is empty: ${filepath}`);
  }

  if (file.warned) {
    console.warn(`Large file: ${file.displayPath} (${file.size} bytes).`);
  }

  if (file.truncated) {
    console.warn('File exceeds 500KB, so only the first 500KB will be explained.');
  }

  const config = await loadGlobalConfig();
  const language = detectLanguage(file.absolutePath);

  const { systemPrompt, userPrompt } = buildExplainPrompt(file, {
    language,
    detail,
    section: options.section,
  });

  const explanation = await runWithSpinner(`Reading ${file.displayPath}...`, () => completeWithAi({
    systemPrompt,
    userPrompt,
    config,
    model: options.model,
  }));

  console.log(`\nFile Explanation: ${file.displayPath}\n`);
  console.log(`${explanation}\n`);
}
