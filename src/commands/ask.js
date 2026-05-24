import inquirer from 'inquirer';

import {
  completeWithAi,
  copyToClipboard,
  handleCommandError,
  loadGlobalConfig,
  loadLocalConfig,
  runWithSpinner,
} from './shared.js';

const SYSTEM_PROMPT = [
  'You are a senior developer assistant.',
  'Answer concisely, use markdown when helpful, and include code examples for coding questions.',
  'Prefer practical, directly usable guidance.',
].join(' ');

export function registerAskCommand(program) {
  program
    .command('ask [question...]')
    .description('Ask an AI-powered developer question')
    .option('--model <model>', 'Override the configured model')
    .option('--no-stream', 'Disable streaming output')
    .option('--copy', 'Copy the answer to the clipboard')
    .addHelpText('after', `

Examples:
  $ kaks ask "How do I read a file async in Node.js?"
  $ kaks ask --model gpt-4o-mini "Explain Promise.allSettled"
`)
    .action(async (questionParts = [], options) => {
      try {
        await ask(questionParts, options);
      } catch (error) {
        handleCommandError(error);
      }
    });
}

export async function ask(questionParts = [], options = {}) {
  const question = await resolveQuestion(questionParts);
  const config = await loadGlobalConfig();
  const localConfig = await loadLocalConfig();

  const context = localConfig?.ai?.context
    ? `\n\nProject context:\n${localConfig.ai.context}`
    : '';

  const answer = await runWithSpinner('Reading...', () => completeWithAi({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `${question}${context}`,
    config,
    model: options.model,
  }));

  console.log(`\n${answer}\n`);

  if (options.copy) {
    await copyToClipboard(answer);
    console.log('Copied answer to clipboard.');
  }
}

async function resolveQuestion(questionParts) {
  const question = Array.isArray(questionParts) ? questionParts.join(' ').trim() : String(questionParts ?? '').trim();

  if (question) {
    return question;
  }

  const answer = await inquirer.prompt([
    {
      type: 'input',
      name: 'question',
      message: 'Question',
      validate: (value) => Boolean(value.trim()) || 'Enter a question.',
    },
  ]);

  return answer.question.trim();
}
