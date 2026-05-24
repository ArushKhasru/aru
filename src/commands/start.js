import process from 'node:process';

import chalk from 'chalk';
import { execaCommand } from 'execa';

import {
  CliError,
  getProjectServices,
  handleCommandError,
  loadGlobalConfig,
  resolveProject,
} from './shared.js';

const SERVICE_COLORS = [chalk.cyan, chalk.green, chalk.magenta, chalk.yellow, chalk.blue];

export function registerStartCommand(program) {
  program
    .command('start [projectName]')
    .description('Start configured project services concurrently')
    .option('--only <service>', 'Start only one configured service')
    .option('--detach', 'Start services in the background')
    .addHelpText('after', `

Examples:
  $ kaks start myapp
  $ kaks start myapp --only frontend
  $ kaks start myapp --detach
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
    throw new CliError(`No start commands configured for "${name}". Add services with "kaks config add-project" or edit ${project.path}.`);
  }

  console.log(`Starting project: ${name}\n`);
  for (const service of services) {
    const port = service.port ? ` (${service.port})` : '';
    console.log(`${service.name}${port} -> ${service.cmd}`);
  }
  console.log('');

  if (options.detach) {
    await startDetached(services);
    console.log('Services started in the background.');
    return;
  }

  await startAttached(services);
}

async function startDetached(services) {
  for (const service of services) {
    const child = execaCommand(service.cmd, {
      cwd: service.cwd,
      detached: true,
      reject: false,
      shell: true,
      stdio: 'ignore',
    });
    child.unref?.();
  }
}

async function startAttached(services) {
  const children = services.map((service, index) => {
    const color = SERVICE_COLORS[index % SERVICE_COLORS.length];
    const child = execaCommand(service.cmd, {
      cwd: service.cwd,
      shell: true,
      all: true,
      reject: false,
      env: process.env,
    });

    child.all?.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
        console.log(`${color(`[${service.name}]`)} ${line}`);
      }
    });

    return { service, child };
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log('\nStopping services...');
    for (const { child } of children) {
      child.kill('SIGTERM', { forceKillAfterDelay: 5000 });
    }
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  const results = await Promise.all(children.map(({ child }) => child));
  process.removeListener('SIGINT', shutdown);
  process.removeListener('SIGTERM', shutdown);

  const failed = results
    .map((result, index) => ({ result, service: children[index].service }))
    .filter(({ result }) => result.exitCode && result.exitCode !== 0);

  if (failed.length) {
    const names = failed.map(({ service }) => service.name).join(', ');
    throw new CliError(`Service exited with an error: ${names}`);
  }
}
