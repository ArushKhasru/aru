import process from 'node:process';

import {
  handleCommandError,
  loadGlobalConfig,
} from './shared.js';
import { openWorkspace } from '../workspace/opener.js';
import { resolveProject } from '../workspace/resolver.js';

export function registerOpenCommand(program) {
  program
    .command('open [projectName]')
    .description('Open a configured project in editor, browser, terminal, and file explorer')
    .option('--no-browser', 'Skip opening browser URLs')
    .option('--no-editor', 'Skip opening the editor')
    .option('--no-explorer', 'Skip opening the file explorer')
    .option('--no-terminal', 'Skip opening a terminal in the project directory')
    .addHelpText('after', `

Examples:
  $ perky open myapp
  $ perky open myapp --no-explorer
`)
    .action(async (projectName, options) => {
      try {
        await openProject(projectName, options);
      } catch (error) {
        handleCommandError(error);
      }
    });
}

export async function openProject(projectName, options = {}) {
  const config = await loadGlobalConfig();
  const resolved = await resolveProject(config, projectName);
  const { name, project } = resolved;

  console.log(`Opening project: ${name}`);

  const { results, failures } = await openWorkspace(project, options);
  for (const result of results) {
    console.log(`OK ${result.label.padEnd(13)} -> ${result.target}`);
  }

  for (const failure of failures) {
    console.error(`FAILED ${failure.label.padEnd(9)} -> ${failure.target}: ${failure.message}`);
  }

  if (failures.length) {
    process.exitCode = 1;
    console.log(`\nProject "${name}" opened with ${failures.length} failure${failures.length === 1 ? '' : 's'}.`);
    return;
  }

  console.log(`\nProject "${name}" is ready.`);
}
