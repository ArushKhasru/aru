import inquirer from 'inquirer';

import { buildAskPrompt } from '../ai/prompt.js';
import { completeWithAi } from '../ai/provider.js';
import { printStream, streamWithAi } from '../ai/stream.js';
import {
  copyToClipboard,
  handleCommandError,
  loadGlobalConfig,
  loadLocalConfig,
  runWithSpinner,
} from './shared.js';

export function registerAskCommand(program) {
  program
    .command('ask [question...]')
    .description('Ask an AI-powered developer question')
    .option('--model <model>', 'Override the configured model')
    .option('--no-stream', 'Disable streaming output')
    .option('--copy', 'Copy the answer to the clipboard')
    .addHelpText('after', `

Examples:
  $ perky ask "How do I read a file async in Node.js?"
  $ perky ask --model gpt-4o-mini "Explain Promise.allSettled"
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

  const projectContext = localConfig?.ai?.context ?? '';
  const { systemPrompt, userPrompt } = buildAskPrompt(question, projectContext);

  let answer;

  if (options.stream === false) {
    // Non-streaming: show spinner, get complete response
    answer = await runWithSpinner('Reading...', () => completeWithAi({
      systemPrompt,
      userPrompt,
      config,
      model: options.model,
    }));

    console.log(`\n${answer}\n`);
  } else {
    // Streaming: print tokens in real-time
    console.log('');
    const stream = streamWithAi({
      systemPrompt,
      userPrompt,
      config,
      model: options.model,
    });
    answer = await printStream(stream);
    console.log('');
  }

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
