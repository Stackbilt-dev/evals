#!/usr/bin/env tsx
/**
 * run.ts — classify-cast eval runner
 *
 * Loads a .jsonl dataset, runs every case through the live classify-cast
 * endpoint, and prints an EvalRunReport.
 *
 * Usage:
 *   AEGIS_URL=https://... AEGIS_TOKEN=aegis_... \
 *     npx tsx adapters/classify-cast/run.ts --dataset datasets/classify-cast.jsonl
 *
 * Options:
 *   --dataset <path>     Path to .jsonl eval dataset (required)
 *   --concurrency <n>    Parallel requests (default: 5)
 *   --out <path>         Write JSON report to file (default: stdout)
 *   --failures-only      Only print failed cases in report
 */

import { loadDataset, runEval, exactMatch } from '../../src/index.js';
import { classifyCastTargetFromEnv } from './target.js';
import { writeFileSync } from 'fs';

const args = process.argv.slice(2);

function flag(name: string): string | null {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] ?? null : null;
}

const datasetPath = flag('--dataset');
const concurrency = parseInt(flag('--concurrency') ?? '5', 10);
const outPath = flag('--out');
const failuresOnly = args.includes('--failures-only');

if (!datasetPath) {
  console.error('Usage: run.ts --dataset <path> [--concurrency N] [--out <path>]');
  process.exit(1);
}

async function main() {
  console.error(`[eval] Loading dataset: ${datasetPath}`);
  const dataset = await loadDataset(datasetPath!);
  console.error(`[eval] ${dataset.length} cases loaded`);

  const target = classifyCastTargetFromEnv();
  let done = 0;

  const report = await runEval(dataset, target, datasetPath!, {
    runner: 'classify-cast (aegis/api/classify)',
    scorer: exactMatch,
    concurrency,
    onProgress: (d, total) => {
      done = d;
      process.stderr.write(`\r[eval] ${d}/${total} (${((d / total) * 100).toFixed(1)}%)`);
    },
  });

  process.stderr.write('\n');

  const output = failuresOnly
    ? { ...report, failures: report.failures }
    : report;

  const json = JSON.stringify(output, null, 2);

  if (outPath) {
    writeFileSync(outPath, json);
    console.error(`[eval] Report written to ${outPath}`);
  } else {
    console.log(json);
  }

  // Print summary to stderr for easy reading
  const { summary } = report;
  console.error('');
  console.error(`Accuracy : ${(summary.accuracy * 100).toFixed(2)}% (${summary.passed}/${summary.total})`);
  console.error(`p50      : ${summary.p50_latency_ms}ms`);
  console.error(`p90      : ${summary.p90_latency_ms}ms`);
  console.error(`p95      : ${summary.p95_latency_ms}ms`);
  console.error(`Failures : ${summary.failed}`);

  process.exit(summary.failed > 0 && args.includes('--strict') ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
