import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  CliError,
  completeWithAi,
  handleCommandError,
  hasAiCredentials,
  loadGlobalConfig,
  parsePositiveInteger,
  readStdin,
  resolveUserPath,
  runWithSpinner,
  tailLines,
} from './shared.js';

const ONE_MEGABYTE = 1024 * 1024;
const LARGE_FILE_TAIL_LINES = 500;

const SYSTEM_PROMPT = [
  'You are a log analysis expert.',
  'Summarize errors, warnings, key events, likely root causes, and concrete next steps.',
  'Be structured and concise.',
].join(' ');

export function registerSummarizeCommand(program) {
  program
    .command('summarize <logfile>')
    .description('Summarize a log file or stdin')
    .option('--tail <n>', 'Only read the last N lines', parsePositiveInteger)
    .option('--errors-only', 'Analyze only error, exception, fatal, and warning lines')
    .option('--json', 'Print a local JSON summary')
    .option('--model <model>', 'Override the configured model')
    .addHelpText('after', `

Examples:
  $ kaks summarize logs/server-error.log
  $ kaks summarize app.log --tail 200
  $ Get-Content app.log | kaks summarize -
`)
    .action(async (logfile, options) => {
      try {
        await summarize(logfile, options);
      } catch (error) {
        handleCommandError(error);
      }
    });
}

export async function summarize(logfile, options = {}) {
  const input = await readLogInput(logfile, options.tail);
  let content = input.content;

  if (options.errorsOnly) {
    content = content
      .split(/\r?\n/)
      .filter((line) => /(error|exception|fatal|fail|warn|econn|enoent|timeout|unhandled)/i.test(line))
      .join('\n');
  }

  if (!content.trim()) {
    throw new CliError(options.errorsOnly ? 'No errors or warnings found.' : 'Nothing to summarize.');
  }

  const localSummary = buildLocalSummary(content, input.label);

  if (options.json) {
    console.log(JSON.stringify(localSummary, null, 2));
    return;
  }

  if (input.autoTailed) {
    console.warn(`Large file detected. Analyzing the last ${LARGE_FILE_TAIL_LINES} lines.`);
  }

  const config = await loadGlobalConfig();

  if (!hasAiCredentials(config)) {
    printLocalSummary(localSummary);
    console.warn('\nAI insight skipped because no provider credentials are configured. Run "kaks init" to set them up.');
    return;
  }

  const prompt = [
    `Log source: ${input.label}`,
    `Line count: ${localSummary.lines}`,
    `Errors: ${localSummary.errors}`,
    `Warnings: ${localSummary.warnings}`,
    '',
    'Log content:',
    '```log',
    content,
    '```',
  ].join('\n');

  const summary = await runWithSpinner(`Analyzing ${localSummary.lines} lines...`, () => completeWithAi({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: prompt,
    config,
    model: options.model,
  }));

  console.log(`\nLog Summary: ${input.label}\n`);
  console.log(`${summary}\n`);
}

async function readLogInput(logfile, requestedTail) {
  if (logfile === '-') {
    const content = await readStdin();
    return {
      label: 'stdin',
      content: requestedTail ? tailLines(content, requestedTail) : content,
      autoTailed: false,
    };
  }

  const absolutePath = resolveUserPath(logfile);
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new CliError(`File not found: ${logfile}`, { cause: error });
    }
    throw error;
  }

  if (!stat.isFile()) {
    throw new CliError(`Not a file: ${logfile}`);
  }

  let content;
  let autoTailed = false;

  if (stat.size > ONE_MEGABYTE && !requestedTail) {
    content = await readLastBytes(absolutePath, Math.min(stat.size, 512 * 1024));
    content = tailLines(content, LARGE_FILE_TAIL_LINES);
    autoTailed = true;
  } else {
    content = await fs.readFile(absolutePath, 'utf8');
  }

  if (requestedTail) {
    content = tailLines(content, requestedTail);
  }

  return {
    label: path.relative(process.cwd(), absolutePath) || absolutePath,
    content,
    autoTailed,
  };
}

async function readLastBytes(filePath, bytesToRead) {
  const stat = await fs.stat(filePath);
  const start = Math.max(0, stat.size - bytesToRead);
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, start);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function buildLocalSummary(content, source) {
  const lines = content.split(/\r?\n/).filter(Boolean);
  const errorLines = lines.filter((line) => /(error|exception|fatal|fail|econn|enoent|timeout|unhandled)/i.test(line));
  const warningLines = lines.filter((line) => /\b(warn|warning)\b/i.test(line));
  const infoLines = Math.max(0, lines.length - errorLines.length - warningLines.length);

  return {
    source,
    lines: lines.length,
    errors: errorLines.length,
    warnings: warningLines.length,
    info: infoLines,
    criticalIssues: summarizeIssues(errorLines),
  };
}

function summarizeIssues(errorLines) {
  const counts = new Map();

  for (const line of errorLines) {
    const key = classifyIssue(line);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([message, count]) => ({ message, count }));
}

function classifyIssue(line) {
  const patterns = [
    'ECONNREFUSED',
    'EADDRINUSE',
    'ENOENT',
    'ENOMEM',
    'JWT_SECRET',
    'TypeError',
    'ReferenceError',
    'SyntaxError',
    'timeout',
  ];

  return patterns.find((pattern) => new RegExp(pattern, 'i').test(line))
    ?? line.replace(/\d{2,4}[-:/]\d{1,2}[-:/]\d{1,2}[\sT]?\d{0,2}:?\d{0,2}:?\d{0,2}/g, '').trim().slice(0, 120)
    ?? 'Unclassified error';
}

function printLocalSummary(summary) {
  console.log(`\nLog Summary: ${summary.source}\n`);
  console.log(`Errors:   ${summary.errors}`);
  console.log(`Warnings: ${summary.warnings}`);
  console.log(`Info:     ${summary.info}`);

  if (!summary.criticalIssues.length) {
    console.log('\nLog looks clean.');
    return;
  }

  console.log('\nCritical Issues:');
  summary.criticalIssues.forEach((issue, index) => {
    console.log(`${index + 1}. ${issue.message} (x${issue.count})`);
  });
}
