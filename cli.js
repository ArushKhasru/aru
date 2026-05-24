#!/usr/bin/env node

import 'dotenv/config';
import process from 'node:process';

import { Command } from 'commander';

import { registerAskCommand } from './src/commands/ask.js';
import { registerConfigCommand } from './src/commands/config.js';
import { registerExplainCommand } from './src/commands/explain.js';
import { registerGoCommand } from './src/commands/go.js';
import { registerInitCommand } from './src/commands/init.js';
import { registerOpenCommand } from './src/commands/open.js';
import { registerStartCommand } from './src/commands/start.js';
import { registerSummarizeCommand } from './src/commands/summarize.js';
import { CONFIG_PATH, pathExists } from './src/commands/shared.js';

const program = new Command();

program
  .name('kaks')
  .description('AI-powered developer assistant and workspace launcher')
  .version('1.0.0')
  .showHelpAfterError()
  .showSuggestionAfterError()
  .addHelpText('after', `

Examples:
  $ kaks init
  $ kaks ask "How do I read a file async in Node.js?"
  $ kaks explain package.json
  $ kaks summarize app.log --tail 200
  $ kaks open myapp
  $ kaks start myapp
  $ kaks go github.com
`);

registerAskCommand(program);
registerExplainCommand(program);
registerSummarizeCommand(program);
registerOpenCommand(program);
registerStartCommand(program);
registerGoCommand(program);
registerConfigCommand(program);
registerInitCommand(program);

if (process.argv.length <= 2) {
  if (!(await pathExists(CONFIG_PATH))) {
    console.log('Welcome to kaks-cli.');
    console.log('It looks like this is your first time. Run: kaks init\n');
  }

  program.outputHelp();
} else {
  await program.parseAsync(process.argv);
}
