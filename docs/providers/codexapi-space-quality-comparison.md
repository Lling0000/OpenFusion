# CodexAPI Space Quality Comparison

- Date: 2026-06-16
- OpenFusion commit: 6b80cfc
- Provider or relay version: codexapi.space OpenAI-compatible relay, version not disclosed
- Command:

```bash
CODEXAPI_API_KEY="..." node src/cli.js compare \
  --config /private/tmp/openfusion-codexapi-quality.config.json \
  --baseline-role fast \
  --grade \
  --grader-role verifier
```

## Result

# OpenFusion Quality Comparison Receipt

Mode: `real`
Started: `2026-06-16T08:35:46.663Z`
Baseline: `fast:gpt-5.4-mini`
Grader: `verifier:gpt-5.4`
Fusion wins: **3**
Baseline wins: **0**
Ties: **0**

| Case | Winner | Baseline | Fusion Panel | Grader |
| --- | --- | --- | --- | --- |
| `coding-review` | FUSION | `fast:gpt-5.4-mini-2026-03-17` | `verifier` + `coder` + `fast` | `verifier:gpt-5.4` |
| `architecture-tradeoff` | FUSION | `fast:gpt-5.4-mini-2026-03-17` | `coder` + `reasoner` + `fast` + `verifier` | `verifier:gpt-5.4` |
| `docs-polish` | FUSION | `fast:gpt-5.4-mini-2026-03-17` | `writer` + `fast` + `verifier` | `verifier:gpt-5.4` |

This receipt adds model-graded quality evidence on top of orchestration evidence. Treat the grader as another model judgment, not as ground truth.

## Notes

- The API key should be provided only through the `CODEXAPI_API_KEY` environment variable and should not be committed.
- The live run used a relay-specific config with `fast=gpt-5.4-mini`, `reasoner=gpt-5.4`, `coder=gpt-5.4-mini`, `verifier=gpt-5.4`, and `writer=gpt-5.4-mini` because these slugs were responsive on this relay.
- The built-in prompts produced three fusion wins in this run, but that should be treated as task-scoped evidence rather than a general claim that fusion always wins.
- This report is model-judged evidence on the built-in prompts, not a universal quality guarantee.
