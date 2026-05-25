/**
 * Prompt templates and builders for each AI command.
 *
 * Each builder returns { systemPrompt, userPrompt } — clean inputs for
 * provider.complete() or stream functions.
 */

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const ASK_SYSTEM_PROMPT = [
  'You are a senior developer assistant.',
  'Answer concisely, use markdown when helpful, and include code examples for coding questions.',
  'Prefer practical, directly usable guidance.',
].join(' ');

const EXPLAIN_SYSTEM_PROMPT = [
  'You are a code and configuration file explainer.',
  'Explain the file in plain English for a developer.',
  'Cover purpose, structure, important sections, and any risks or noteworthy details.',
].join(' ');

const SUMMARIZE_SYSTEM_PROMPT = [
  'You are a log analysis expert.',
  'Summarize errors, warnings, key events, likely root causes, and concrete next steps.',
  'Be structured and concise.',
].join(' ');

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/**
 * Build the prompt pair for `perky ask`.
 *
 * @param {string} question - The user's question
 * @param {string} [projectContext] - Optional project context from .perky.json
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
export function buildAskPrompt(question, projectContext = '') {
  const context = projectContext ? `\n\nProject context:\n${projectContext}` : '';

  return {
    systemPrompt: ASK_SYSTEM_PROMPT,
    userPrompt: `${question}${context}`,
  };
}

/**
 * Build the prompt pair for `perky explain`.
 *
 * @param {object} file - File metadata from readTextFileWithLimits
 * @param {string} file.displayPath - Relative display path
 * @param {string} file.content - File content (may be truncated)
 * @param {object} options
 * @param {string} options.language - Detected language/format
 * @param {string} [options.detail='medium'] - Detail level: low, medium, high
 * @param {string} [options.section] - Optional section focus
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
export function buildExplainPrompt(file, options = {}) {
  const detail = options.detail ?? 'medium';
  const section = options.section ? `\nFocus only on this section or topic: ${options.section}` : '';

  const userPrompt = [
    `File: ${file.displayPath}`,
    `Detected format: ${options.language}`,
    `Detail level: ${detail}`,
    section,
    '',
    'Content:',
    `\`\`\`${options.language}`,
    file.content,
    '```',
  ].filter(Boolean).join('\n');

  return {
    systemPrompt: EXPLAIN_SYSTEM_PROMPT,
    userPrompt,
  };
}

/**
 * Build the prompt pair for `perky summarize`.
 *
 * @param {string} content - Log content to summarize
 * @param {object} metadata
 * @param {string} metadata.label - Source label (filename or "stdin")
 * @param {number} metadata.lines - Total line count
 * @param {number} metadata.errors - Error count from local analysis
 * @param {number} metadata.warnings - Warning count from local analysis
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
export function buildSummarizePrompt(content, metadata = {}) {
  const userPrompt = [
    `Log source: ${metadata.label}`,
    `Line count: ${metadata.lines}`,
    `Errors: ${metadata.errors}`,
    `Warnings: ${metadata.warnings}`,
    '',
    'Log content:',
    '```log',
    content,
    '```',
  ].join('\n');

  return {
    systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
    userPrompt,
  };
}
