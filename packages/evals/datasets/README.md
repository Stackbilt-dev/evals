# Datasets

Eval datasets live here as `.jsonl` files — one JSON object per line.

Each line must conform to the `EvalCase` schema:

```json
{
  "id": "uuid-v4",
  "input": "the raw prompt or user message",
  "expected": "ground-truth label or structured JSON output",
  "metadata": {}
}
```

`expected` can be any JSON value. Classification evals usually use a string
label. Structured-output evals should use sanitized or synthetic objects and a
custom scorer in the consuming repo.

## Seeding from production

Use the export script in `aegis-daemon`:

```bash
cd /path/to/aegis-daemon
npx tsx scripts/export-eval-dataset.ts --out /path/to/evals/packages/evals/datasets/classify-cast.jsonl
```

Datasets are gitignored — they may contain production message content. Synthetic or sanitized datasets intended for public release go in `datasets/public/`.

Do not commit product prompts, recipe corpora, private golden cases, benchmark
evidence, competitive outputs, or product-specific scoring weights to this OSS
repo.
