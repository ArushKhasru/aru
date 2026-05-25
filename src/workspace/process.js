import { spawn } from 'node:child_process';
import process from 'node:process';

export function launchDetached(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: true,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      stdio: 'ignore',
      windowsHide: options.windowsHide ?? false,
    });

    let settled = false;
    const cleanup = () => {
      child.off('spawn', onSpawn);
      child.off('error', onError);
    };
    const settle = (handler, value) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      handler(value);
    };
    const onSpawn = () => {
      child.unref();
      settle(resolve);
    };
    const onError = (error) => {
      settle(reject, error);
    };

    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}
