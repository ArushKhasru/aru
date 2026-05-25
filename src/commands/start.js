import {
  CliError,
  handleCommandError,
  loadGlobalConfig,
} from './shared.js';
import { getProjectServices, resolveProject } from '../workspace/resolver.js';
import { startServices } from '../workspace/starter.js';

export function registerStartCommand(program) {
  program
    .command('start [projectName]')
    .description('Start configured project services concurrently')
    .option('--only <service>', 'Start only one configured service')
    .option('--detach', 'Start services in the background')
    .addHelpText('after', `

Examples:
  $ perky start myapp
  $ perky start myapp --only frontend
  $ perky start myapp --detach
`)
    .action(async (projectName, options) => {
      try {
        await startProject(projectName, options);
      } catch (error) {
        handleCommandError(error);
      }
    });
}

export async function startProject(projectName, options = {}) {
  const config = await loadGlobalConfig();
  const { name, project } = await resolveProject(config, projectName);
  let services = getProjectServices(project);

  if (options.only) {
    services = services.filter((service) => service.name === options.only);
    if (!services.length) {
      throw new CliError(`Service not found: ${options.only}`);
    }
  }

  if (!services.length) {
    throw new CliError(`No start commands configured for "${name}". Add services with "perky config add-project" or edit ${project.path}.`);
  }

  console.log(`Starting project: ${name}\n`);
  for (const service of services) {
    const port = service.port ? ` (${service.port})` : '';
    console.log(`${service.name}${port} -> ${service.cmd}`);
  }
  console.log('');

  if (options.detach) {
    await startServices(services, { detach: true });
    console.log('Services started in the background.');
    return;
  }

  await startServices(services);
}
