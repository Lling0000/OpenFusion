# Provider Compatibility Reports

This directory is for community-submitted OpenFusion compatibility reports.

The goal is to make OpenAI-compatible relay behavior visible and reproducible for coding-agent users. A provider may accept `/chat/completions` but still differ on streaming, tool calls, usage chunks, headers, or model aliases. OpenFusion reports those differences as a simple matrix.

## Reports

- [Local OpenFusion Dry Run](local-openfusion.md): verifies the local dry-run OpenFusion facade.
- [CodexAPI Space](codexapi-space.md): real OpenAI-compatible relay probe using `gpt-5.4-mini`.

## Generate A Report

Start OpenFusion locally or point at your relay, then run:

```bash
node src/cli.js compat \
  --target "openrouter|https://openrouter.ai/api/v1|openrouter/fusion|OPENROUTER_API_KEY" \
  --target "your-relay|https://your-relay.example.com/v1|your-default-model|YOUR_RELAY_API_KEY" \
  --timeout-ms 30000
```

Or use a config file:

```bash
node src/cli.js compat --compat-config examples/compat.config.example.json
```

## What The Matrix Checks

- `probe.models`: `GET /models` returns an OpenAI-compatible model list.
- `probe.chat`: non-streaming `POST /chat/completions` returns an assistant message.
- `probe.chat.stream`: `stream: true` returns SSE chunks and `[DONE]`.
- `probe.tool.roundtrip`: a tool-call request returns `tool_calls`, and a follow-up `role: "tool"` message completes successfully.

If a relay is slow, pass a larger `--timeout-ms` so the matrix does not fail purely because a probe was aborted early.

## Contributing A Report

1. Run the matrix command.
2. Remove secrets, private URLs, and private model names if needed.
3. Add a Markdown file under `docs/providers/`, for example `docs/providers/openrouter.md`.
4. Include date, OpenFusion commit, provider/relay version when known, command used, and matrix output.

Use this template. Keep the command fenced as text if you paste this whole template into another Markdown file.

~~~~md
# Provider Name

- Date: YYYY-MM-DD
- OpenFusion commit:
- Provider or relay version:
- Command:

~~~bash
node src/cli.js compat --target "provider|https://example.com/v1|model|API_KEY_ENV"
~~~

## Result

Paste matrix output here.

## Notes

- Any provider-specific caveats.
- Whether tool calls require a specific model.
- Whether streaming is token-by-token or buffered.
~~~~
