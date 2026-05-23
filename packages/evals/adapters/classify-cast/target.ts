/**
 * classify-cast Target adapter for @stackbilt/evals.
 *
 * Calls POST /api/classify on a deployed AEGIS worker and returns the
 * intent_class string. Compatible with the Target type in runner.ts.
 *
 * Required env:
 *   AEGIS_URL   — e.g. https://aegis-web.blue-pine-edf6.workers.dev
 *   AEGIS_TOKEN — Bearer token matching the worker's AEGIS_TOKEN secret
 */

import type { Target } from '../../src/runner.js';

export interface ClassifyAdapterOptions {
  baseUrl: string;
  token: string;
  /** Timeout per request in ms. Default: 10000. */
  timeoutMs?: number;
}

export interface ClassifyResponse {
  intent_class: string;
  classifier_source: 'classify-cast' | 'llm-fallback' | 'unavailable';
  confidence: number;
  latency_ms: number;
}

export function makeClassifyCastTarget(opts: ClassifyAdapterOptions): Target {
  const { baseUrl, token, timeoutMs = 10_000 } = opts;
  const url = `${baseUrl.replace(/\/$/, '')}/api/classify`;

  return async (input: string): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: input }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`/api/classify returned ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as ClassifyResponse;
      return data.intent_class;
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Load adapter config from environment variables. */
export function classifyCastTargetFromEnv(): Target {
  const baseUrl = process.env.AEGIS_URL;
  const token = process.env.AEGIS_TOKEN;
  if (!baseUrl) throw new Error('AEGIS_URL env var required');
  if (!token) throw new Error('AEGIS_TOKEN env var required');
  return makeClassifyCastTarget({ baseUrl, token });
}
