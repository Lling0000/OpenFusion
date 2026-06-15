# CodexAPI Space

- Date: 2026-06-15
- OpenFusion commit: 4a26de6
- Provider or relay version: codexapi.space OpenAI-compatible relay, version not disclosed
- Command:

```bash
CODEXAPI_API_KEY="..." node src/cli.js compat \
  --target "codexapi-space|https://codexapi.space/v1|gpt-5.4-mini|CODEXAPI_API_KEY"
```

## Result

# OpenFusion Provider Compatibility Matrix

| Target | Model | `probe.models` | `probe.chat` | `probe.chat.stream` | `probe.tool.roundtrip` |
| --- | --- | --- | --- | --- | --- |
| codexapi-space | `gpt-5.4-mini` | PASS | PASS | PASS | PASS |

Overall: **PASS**

## Notes

- The API key was supplied only through the `CODEXAPI_API_KEY` environment variable and is not stored in this report.
- The tested model was `gpt-5.4-mini`, which returned standard non-streaming chat completions, SSE streaming with `data: [DONE]`, and a forced tool-call round trip.
- Exploratory real-relay checks showed some other model slugs may be slower or unavailable on this relay. Re-run the matrix with the exact model you plan to use before relying on a role mapping.
- Slow relays may need a higher `fusion.timeoutMs` for `doctor --real` and real fusion runs.
