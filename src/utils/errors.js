/**
 * Base error class for all CLI errors.
 * Extracted to its own module to avoid circular dependency issues between
 * shared.js and the ai/ layer.
 */
export class CliError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'CliError';
    this.exitCode = options.exitCode ?? 1;
    this.cause = options.cause;
  }
}
