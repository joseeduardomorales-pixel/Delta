// Delta — Anthropic Claude API wrapper.
// One central place that constructs the client, applies the
// model/timeout/retry policy, and surfaces structured logging.
// Service used by /api/chat and /api/inference/ping.

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../logger.js';

export const MODEL = 'claude-sonnet-4-5';
export const MAX_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 30_000;

let _client = null;

export function getClient() {
  if (_client) return _client;
  if (!config.anthropic.apiKey) {
    throw new Error('anthropic: ANTHROPIC_API_KEY missing');
  }
  _client = new Anthropic({
    apiKey: config.anthropic.apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1, // SDK already does some retries; cap it at 1 extra
  });
  return _client;
}

// Convenience wrapper around messages.create that:
//   - injects model + max_tokens
//   - logs latency + token usage
//   - surfaces errors cleanly
export async function createMessage({ system, messages, tools, tool_choice }) {
  const client = getClient();
  const t0 = Date.now();
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
      ...(tools?.length ? { tools } : {}),
      ...(tool_choice ? { tool_choice } : {}),
    });
    const ms = Date.now() - t0;
    logger.info(
      {
        model: res.model,
        stop_reason: res.stop_reason,
        input_tokens: res.usage?.input_tokens,
        output_tokens: res.usage?.output_tokens,
        latency_ms: ms,
        tool_calls: res.content?.filter((c) => c.type === 'tool_use').length || 0,
      },
      'anthropic: messages.create ok',
    );
    return res;
  } catch (e) {
    const ms = Date.now() - t0;
    logger.error(
      { err: e.message, status: e.status, latency_ms: ms },
      'anthropic: messages.create failed',
    );
    throw e;
  }
}
