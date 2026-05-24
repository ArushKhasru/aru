import {
  getProjectOpenUrls,
  handleCommandError,
  launchEditor,
  launchExplorer,
  loadGlobalConfig,
  normalizeUrl,
  openTarget,
  resolveProject,
} from './shared.js';

export function registerOpenCommand(program) {
  program
    .command('open [projectName]')
    .description('Open a configured project in editor, browser, and file explorer')
    .option('--no-browser', 'Skip opening browser URLs')
    .option('--no-editor', 'Skip opening the editor')
    .option('--no-explorer', 'Skip opening the file explorer')
    .addHelpText('after', `

Examples:
  $ kaks open myapp
  $ kaks open myapp --no-explorer
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

  if (options.editor !== false) {
    await launchEditor(project.editor, project.path);
    console.log(`OK Editor       -> ${project.path}`);
  }

  if (options.browser !== false) {
    const urls = getProjectOpenUrls(project);
    for (const url of urls) {
      const normalizedUrl = normalizeUrl(url);
      await openTarget(normalizedUrl, project.browserCommand);
      console.log(`OK Browser      -> ${normalizedUrl}`);
    }
  }

  if (options.explorer !== false) {
    await launchExplorer(project.path);
    console.log(`OK File Explorer -> ${project.path}`);
  }

  console.log(`\nProject "${name}" is ready.`);
}
