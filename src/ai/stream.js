import process from 'node:process';

import axios from 'axios';

import { CliError } from '../utils/errors.js';
import { AI_PROVIDER_DEFAULTS, AiConfigError } from './provider.js';

/**
 * Stream an AI response as an async iterable of text chunks.
 *
 * Normalizes the streaming protocols of all supported providers (Gemini SSE,
 * OpenAI SSE, Ollama native streaming) into a single AsyncIterable<string>
 * interface.
 *
 * @param {object} params
 * @param {string} params.systemPrompt - System instructions
 * @param {string} params.userPrompt - User's message
 * @param {object} params.config - Global config
 * @param {string} [params.model] - Model override
 * @returns {AsyncIterable<string>} Stream of text chunks
 */
export async function* streamWithAi({ systemPrompt, userPrompt, config, model }) {
  const provider = String(config.ai?.provider ?? 'gemini').toLowerCase();
  const aiDefaults = AI_PROVIDER_DEFAULTS[provider];

  if (!aiDefaults) {
    throw new CliError(`Unsupported AI provider: ${provider}`);
  }

  const selectedModel = model ?? config.ai?.model ?? aiDefaults.model;
  const temperature = Number(config.ai?.temperature ?? 0.7);
  const maxTokens = Number(config.ai?.maxTokens ?? 2048);

  if (provider === 'openai') {
    yield* streamOpenAi({ systemPrompt, userPrompt, model: selectedModel, temperature, maxTokens, config });
    return;
  }

  if (provider === 'ollama') {
    yield* streamOllama({ systemPrompt, userPrompt, model: selectedModel, temperature, maxTokens });
    return;
  }

  yield* streamGemini({ systemPrompt, userPrompt, model: selectedModel, temperature, maxTokens, config });
}

/**
 * Print streamed text chunks to stdout in real-time.
 *
 * @param {AsyncIterable<string>} stream - Async iterable of text chunks
 * @returns {Promise<string>} The full concatenated response
 */
export async function printStream(stream) {
  let full = '';

  for await (const chunk of stream) {
    process.stdout.write(chunk);
    full += chunk;
  }

  // Ensure a trailing newline after streaming
  if (full && !full.endsWith('\n')) {
    process.stdout.write('\n');
  }

  return full;
}

// ---------------------------------------------------------------------------
// Provider-specific streaming implementations
// ---------------------------------------------------------------------------

async function* streamOpenAi({ systemPrompt, userPrompt, model, temperature, maxTokens, config }) {
  const apiKey = process.env.OPENAI_API_KEY ?? config.ai?.apiKey;
  if (!apiKey) {
    throw new AiConfigError('openai');
  }

  const response = await axios.post('https://api.openai.com/v1/chat/completions', {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature,
    max_tokens: maxTokens,
    stream: true,
  }, {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 60_000,
    responseType: 'stream',
  });

  for await (const rawChunk of response.data) {
    const lines = rawChunk.toString().split('\n').filter((line) => line.startsWith('data: '));

    for (const line of lines) {
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') {
        return;
      }

      try {
        const parsed = JSON.parse(payload);
        const text = parsed.choices?.[0]?.delta?.content;
        if (text) {
          yield text;
        }
      } catch {
        // Skip malformed SSE chunks
      }
    }
  }
}

async function* streamGemini({ systemPrompt, userPrompt, model, temperature, maxTokens, config }) {
  const apiKey = process.env.GEMINI_API_KEY ?? config.ai?.apiKey;
  if (!apiKey) {
    throw new AiConfigError('gemini');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent`;
  const response = await axios.post(`${endpoint}?alt=sse&key=${apiKey}`, {
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
    responseType: 'stream',
  });

  for await (const rawChunk of response.data) {
    const lines = rawChunk.toString().split('\n').filter((line) => line.startsWith('data: '));

    for (const line of lines) {
      const payload = line.slice(6).trim();
      if (!payload) {
        continue;
      }

      try {
        const parsed = JSON.parse(payload);
        const parts = parsed.candidates?.[0]?.content?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.text) {
              yield part.text;
            }
          }
        }
      } catch {
        // Skip malformed SSE chunks
      }
    }
  }
}

async function* streamOllama({ systemPrompt, userPrompt, model, temperature, maxTokens }) {
  const response = await axios.post('http://localhost:11434/api/generate', {
    model,
    prompt: `${systemPrompt}\n\n${userPrompt}`,
    stream: true,
    options: {
      temperature,
      num_predict: maxTokens,
    },
  }, {
    timeout: 120_000,
    responseType: 'stream',
  });

  for await (const rawChunk of response.data) {
    const lines = rawChunk.toString().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.done) {
          return;
        }
        if (parsed.response) {
          yield parsed.response;
        }
      } catch {
        // Skip malformed NDJSON lines
      }
    }
  }
}
