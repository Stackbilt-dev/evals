import { describe, expect, it } from 'vitest';
import {
  canonicalStringify,
  createEvaluationReceipt,
  createEvaluationReceiptFromNativeReport,
  sha256Canonical,
  toEvaluationAuditEvent,
  verifyEvaluationReceiptArtifact,
} from './receipt.js';
import type { EvalRunReport } from './types.js';

const digest = (character: string) => character.repeat(64);

function report(): EvalRunReport {
  return {
    run_id: '11111111-1111-4111-8111-111111111111',
    dataset: 'intent-classify',
    runner: 'tarotscript@1.0.0',
    started_at: '2026-08-23T12:00:00.000Z',
    finished_at: '2026-08-23T12:00:01.000Z',
    summary: {
      total: 10,
      passed: 10,
      failed: 0,
      accuracy: 1,
      pass_rate: 1,
      p50_latency_ms: 4,
      p90_latency_ms: 7,
      p95_latency_ms: 8,
    },
    failures: [],
  };
}

const options = {
  evaluation: { name: 'intent-classify', version: '1.0.0', datasetDigest: digest('a') },
  subject: { name: 'tarotscript/classify-cast', version: '1.42.0', artifactDigest: digest('b') },
  gate: { decision: 'allow' as const, policy: 'no-regressions', reasons: ['all cases passed'] },
  receiptId: '22222222-2222-4222-8222-222222222222',
  issuedAt: '2026-08-23T12:00:02.000Z',
};

describe('evaluation receipts', () => {
  it('canonicalizes object keys while preserving array order', () => {
    expect(canonicalStringify({ z: 1, a: { y: 2, b: 3 }, list: ['b', 'a'] }))
      .toBe('{"a":{"b":3,"y":2},"list":["b","a"],"z":1}');
  });

  it('creates a deterministic public-safe artifact', async () => {
    const first = await createEvaluationReceipt(report(), options);
    const second = await createEvaluationReceipt(report(), options);

    expect(first).toEqual(second);
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.receipt.report.summary.total).toBe(10);
    expect(first.receipt).not.toHaveProperty('failures');
    expect(first.receipt.report).not.toHaveProperty('failures');
    expect(await verifyEvaluationReceiptArtifact(first)).toBe(true);
  });

  it('detects receipt tampering', async () => {
    const artifact = await createEvaluationReceipt(report(), options);
    const tampered = structuredClone(artifact);
    tampered.receipt.gate.decision = 'block';

    expect(await verifyEvaluationReceiptArtifact(tampered)).toBe(false);
  });

  it('binds a framework-native report without publishing its private fields', async () => {
    const nativeReport = {
      evalName: 'intent-classify',
      timestamp: '2026-08-23T12:00:00.000Z',
      scores: [{ caseId: 'private-case', transcript: 'do not publish' }],
    };
    const artifact = await createEvaluationReceiptFromNativeReport(nativeReport, {
      runId: report().run_id,
      runner: 'tarotscript@1.0.0',
      startedAt: report().started_at,
      finishedAt: report().finished_at,
      summary: report().summary,
    }, options);

    expect(artifact.receipt.report.digest).toBe(await sha256Canonical(nativeReport));
    expect(JSON.stringify(artifact)).not.toContain('private-case');
    expect(JSON.stringify(artifact)).not.toContain('do not publish');

    const changed = await createEvaluationReceiptFromNativeReport(
      { ...nativeReport, timestamp: '2026-08-23T12:00:03.000Z' },
      {
        runId: report().run_id,
        runner: 'tarotscript@1.0.0',
        startedAt: report().started_at,
        finishedAt: report().finished_at,
        summary: report().summary,
      },
      options,
    );
    expect(changed.receipt.report.digest).not.toBe(artifact.receipt.report.digest);
  });

  it('keeps the deployment gate explicit rather than deriving it from pass rate', async () => {
    const blocked = await createEvaluationReceipt(report(), {
      ...options,
      gate: { decision: 'block', policy: 'human-approval-required', reasons: ['approval absent'] },
    });

    expect(blocked.receipt.report.summary.pass_rate).toBe(1);
    expect(blocked.receipt.gate.decision).toBe('block');
  });

  it('projects a shape-compatible audit-chain event without raw cases', async () => {
    const artifact = await createEvaluationReceipt(report(), options);
    const event = toEvaluationAuditEvent(artifact, {
      namespace: 'evaluation:intent-classify',
      actor: 'ci:tarotscript',
    });

    expect(event.event_type).toBe('evaluation.receipt.issued');
    expect(event.payload.receipt_digest).toBe(artifact.digest);
    expect(event.payload).not.toHaveProperty('failures');
    expect(await sha256Canonical(artifact.receipt)).toBe(artifact.digest);
  });
});
