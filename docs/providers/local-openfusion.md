# Local OpenFusion Dry Run

- Date: 2026-06-14
- OpenFusion commit: 3f631ee
- Provider or relay version: local dry-run server
- Command:

```bash
node src/cli.js compat --target "local|http://127.0.0.1:8789/v1|openfusion/fusion"
```

## Result

# OpenFusion Provider Compatibility Matrix

| Target | Model | `probe.models` | `probe.chat` | `probe.chat.stream` | `probe.tool.roundtrip` |
| --- | --- | --- | --- | --- | --- |
| local | `openfusion/fusion` | PASS | PASS | PASS | PASS |

Overall: **PASS**

## Notes

- This report uses OpenFusion's built-in dry-run mock client, so it does not prove a real upstream relay's quality.
- It proves the local OpenFusion OpenAI-compatible facade supports the expected compatibility surface.
- The dry-run server buffers Fusion output before emitting SSE-compatible chunks; it is not token-by-token streaming.
