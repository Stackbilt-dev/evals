# Datasets

Eval datasets live here as `.jsonl` files — one JSON object per line.

Each line must conform to the `EvalCase` schema:

```json
{
  "id": "uuid-v4",
  "input": "the raw prompt or user message",
  "expected": "ground-truth label",
  "metadata": {}
}
```

## Seeding from production

Use the export script in `aegis-daemon`:

```bash
cd /path/to/aegis-daemon
npx tsx scripts/export-eval-dataset.ts --out /path/to/evals/packages/evals/datasets/classify-cast.jsonl
```

Datasets are gitignored — they may contain production message content. Synthetic or sanitized datasets intended for public release go in `datasets/public/`.
