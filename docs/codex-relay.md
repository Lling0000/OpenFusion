# Use OpenFusion With Codex And API Relays

OpenFusion is designed to sit between a coding agent and an OpenAI-compatible upstream relay.

```text
Codex / OpenAI SDK client
        |
        v
http://127.0.0.1:8787/v1
        |
        v
OpenFusion route -> panel -> judge -> synthesize
        |
        v
Your OpenAI-compatible relay / OpenRouter / LiteLLM / vLLM gateway
```

## 1. Create A Config

```bash
node src/cli.js init
```

Edit `openfusion.config.json`:

```json
{
  "upstream": {
    "baseURL": "https://your-relay.example.com/v1",
    "apiKeyEnv": "YOUR_RELAY_API_KEY",
    "appName": "OpenFusion",
    "siteURL": "https://github.com/Lling0000/OpenFusion"
  }
}
```

The upstream must expose an OpenAI-compatible `POST /chat/completions` endpoint.

## 2. Run Doctor

Dry-run doctor does not call upstream:

```bash
node src/cli.js doctor
```

Real doctor runs the fusion pipeline against the configured upstream:

```bash
YOUR_RELAY_API_KEY="..." node src/cli.js doctor --real --config openfusion.config.json
```

Endpoint probe checks OpenAI-compatible HTTP behavior:

```bash
YOUR_RELAY_API_KEY="..." node src/cli.js doctor \
  --config openfusion.config.json \
  --probe-url https://your-relay.example.com/v1 \
  --probe-model your-default-model
```

The probe checks:

- `GET /models`
- `POST /chat/completions`
- `POST /chat/completions` with `stream: true`

## 3. Start OpenFusion

```bash
YOUR_RELAY_API_KEY="..." node src/cli.js serve \
  --config openfusion.config.json \
  --port 8787
```

## 4. Point Codex Or Another Client At OpenFusion

Use these values in any client that supports an OpenAI-compatible base URL:

```text
base_url = http://127.0.0.1:8787/v1
api_key = any-local-placeholder
model = openfusion/fusion
```

If your Codex installation already points at an API relay, replace that relay URL with the local OpenFusion URL, and put the original relay URL in `openfusion.config.json`.

## Compatibility Notes

OpenFusion currently preserves the full chat `messages` transcript and supports normal JSON responses plus SSE-style `stream: true` responses.

Tool calls are intentionally rejected with a clear `501 tool_calls_unsupported` error until passthrough support is implemented. This is safer than silently dropping `tools` or `tool_choice`, because coding agents often depend on those fields for correct behavior.

## Debug A Route

```bash
curl http://127.0.0.1:8787/debug/route \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openfusion/auto",
    "messages": [
      {
        "role": "user",
        "content": "Review this patch for security risks and missing tests"
      }
    ]
  }'
```

This returns selected roles, route scores, and a rationale without running the full panel.
