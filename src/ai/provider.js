import process from 'node:process';

import axios from 'axios';

import { CliError } from '../utils/errors.js';

/**
 * Default settings for each supported AI provider.
 */
export const AI_PROVIDER_DEFAULTS = {
  gemini: { model: 'gemini-2.0-flash', envKey: 'GEMINI_API_KEY' },
  openai: { model: 'gpt-4o-mini', envKey: 'OPENAI_API_KEY' },
  ollama: { model: 'llama3.1', envKey: 'LLAMA_API_KEY' },
};

/**
 * Error thrown when AI provider credentials are missing.
 */
export class AiConfigError extends CliError {
  constructor(provider) {
    const envKey = AI_PROVIDER_DEFAULTS[provider]?.envKey;
    const suffix = envKey ? ` Set ${envKey} or run "perky init".` : ' Run "perky init" to configure AI.';
    super(`API key not found for ${provider}.${suffix}`);
    this.name = 'AiConfigError';
  }
}

/**
 * Check whether the current environment has credentials for the given provider.
 */
export function hasAiCredentials(config, provider = config.ai?.provider ?? 'gemini') {
  const normalizedProvider = provider.toLowerCase();
  if (normalizedProvider === 'ollama') {
    return true;
  }

  const envKey = AI_PROVIDER_DEFAULTS[normalizedProvider]?.envKey;
  return Boolean((envKey && process.env[envKey]) || config.ai?.apiKey);
}

/**
 * Send a prompt and receive a complete response from the configured AI provider.
 *
 * @param {object} params
 * @param {string} params.systemPrompt - System instructions
 * @param {string} params.userPrompt - User's message
 * @param {object} params.config - Global config (with ai.provider, ai.model, etc.)
 * @param {string} [params.model] - Model override
 * @returns {Promise<string>} AI response text
 */
export async function completeWithAi({ systemPrompt, userPrompt, config, model }) {
  const provider = String(config.ai?.provider ?? 'gemini').toLowerCase();
  const aiDefaults = AI_PROVIDER_DEFAULTS[provider];

  if (!aiDefaults) {
    throw new CliError(`Unsupported AI provider: ${provider}`);
  }

  const selectedModel = model ?? config.ai?.model ?? aiDefaults.model;
  const temperature = Number(config.ai?.temperature ?? 0.7);
  const maxTokens = Number(config.ai?.maxTokens ?? 2048);

  try {
    if (provider === 'openai') {
      return await completeWithOpenAi({ systemPrompt, userPrompt, model: selectedModel, temperature, maxTokens, config });
    }

    if (provider === 'ollama') {
      return await completeWithOllama({ systemPrompt, userPrompt, model: selectedModel, temperature, maxTokens });
    }

    return await completeWithGemini({ systemPrompt, userPrompt, model: selectedModel, temperature, maxTokens, config });
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw normalizeAiError(error, provider);
  }
}

// ---------------------------------------------------------------------------
// Provider-specific completion implementations
// ---------------------------------------------------------------------------

async function completeWithOpenAi({ systemPrompt, userPrompt, model, temperature, maxTokens, config }) {
  const apiKey = process.env.OPENAI_API_KEY ?? config.ai?.apiKey;
  if (!apiKey) {
    throw new AiConfigError('openai');
  }

  const { data } = await axios.post('https://api.openai.com/v1/chat/completions', {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature,
    max_tokens: maxTokens,
  }, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 60_000,
  });

  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

async function completeWithGemini({ systemPrompt, userPrompt, model, temperature, maxTokens, config }) {
  const apiKey = process.env.GEMINI_API_KEY ?? config.ai?.apiKey;
  if (!apiKey) {
    throw new AiConfigError('gemini');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const { data } = await axios.post(`${endpoint}?key=${apiKey}`, {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  }, {
    timeout: 60_000,
  });

  return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim() ?? '';
}

async function completeWithOllama({ systemPrompt, userPrompt, model, temperature, maxTokens }) {
  const { data } = await axios.post('http://localhost:11434/api/generate', {
    model,
    prompt: `${systemPrompt}\n\n${userPrompt}`,
    stream: false,
    options: {
      temperature,
      num_predict: maxTokens,
    },
  }, {
    timeout: 120_000,
  });

  return data.response?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// Error normalization
// ---------------------------------------------------------------------------

/**
 * Convert raw HTTP/network errors into user-friendly CliError messages.
 */
export function normalizeAiError(error, provider) {
  if (error.response?.status === 401 || error.response?.status === 403) {
    return new CliError(`Authentication failed for ${provider}. Check your API key.`, { cause: error });
  }

  if (error.response?.status === 429) {
    const retryAfter = error.response.headers?.['retry-after'];
    const suffix = retryAfter ? ` Try again after ${retryAfter} seconds.` : ' Try again later.';
    return new CliError(`Rate limited by ${provider}.${suffix}`, { cause: error });
  }

  if (error.code === 'ECONNABORTED') {
    return new CliError(`Request to ${provider} timed out.`, { cause: error });
  }

  if (!error.response) {
    return new CliError(`Could not reach ${provider}. Check your internet connection or provider service.`, { cause: error });
  }

  return new CliError(`AI request failed: ${error.response.status} ${error.response.statusText ?? ''}`.trim(), {
    cause: error,
  });
}
