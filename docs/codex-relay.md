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

## What Happens In Codex

| Request type | OpenFusion behavior |
| --- | --- |
| Ordinary assistant answers | Routes to a role panel, judges disagreements, and synthesizes one answer. |
| Tool-call turns | Uses single-model passthrough so Codex's tool protocol stays stable. |
| `stream: true` | Returns SSE-compatible chunks after the response is ready; token-by-token streaming is not implemented yet. |

## 1. Prove The Local Gateway First

Start a dry-run server with no upstream calls:

```bash
openfusion serve --dry-run --port 8787
```

In another terminal, verify the local OpenAI-compatible surface:

```bash
openfusion doctor --probe-url http://127.0.0.1:8787/v1 --probe-model openfusion/fusion
```

You can also inspect the exact Codex settings:

```bash
openfusion adapter codex
```

## 2. Configure Codex

Codex reads user-level configuration from `~/.codex/config.toml`. Provider auth and `model_providers` belong in user-level config, not a project `.codex/config.toml`.

Add this snippet:

```toml
model = "openfusion/fusion"
model_provider = "openfusion"

[model_providers.openfusion]
name = "OpenFusion local"
base_url = "http://127.0.0.1:8787/v1"
env_key = "OPENFUSION_API_KEY"
```

Set a local placeholder key for Codex:

```bash
export OPENFUSION_API_KEY="openfusion-local-placeholder"
```

Keep your real relay key in the environment variable used by OpenFusion, such as `OPENROUTER_API_KEY` or `YOUR_RELAY_API_KEY`.

## 3. Create A Real Relay Config

Installed usage:

```bash
openfusion init
```

Before the first npm release, you can run the same commands through GitHub:

```bash
npx github:Lling0000/OpenFusion init
```

From a git checkout:

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
  },
  "routing": {
    "rules": [
      {
        "role": "verifier",
        "keywords": ["incident", "postmortem"],
        "score": 3,
        "reason": "incident-review signal"
      }
    ]
  },
  "fusion": {
    "maxUpstreamCalls": 6,
    "toolRole": "writer"
  }
}
```

The upstream must expose an OpenAI-compatible `POST /chat/completions` endpoint.
Custom routing rules add role-specific signals before OpenFusion selects the panel.
`maxUpstreamCalls` is checked before any upstream model call. A route needs `selected panel roles + judge + synthesis` calls, so the default `6` allows up to four panel models plus judge and synthesis.

## 4. Run Doctor

Dry-run doctor does not call upstream:

```bash
openfusion doctor
```

Doctor output includes a compact Fusion Receipt Summary proving the local pipeline reached the selected panel roles, judge, synthesis, and phase trace.

Real doctor runs the fusion pipeline against the configured upstream:

```bash
YOUR_RELAY_API_KEY="..." openfusion doctor --real --config openfusion.config.json
```

Endpoint probe checks OpenAI-compatible HTTP behavior:

```bash
YOUR_RELAY_API_KEY="..." openfusion doctor \
  --config openfusion.config.json \
  --probe-url https://your-relay.example.com/v1 \
  --probe-model your-default-model
```

Generate a Markdown report you can paste into issues or docs:

```bash
YOUR_RELAY_API_KEY="..." openfusion doctor \
  --config openfusion.config.json \
  --probe-url https://your-relay.example.com/v1 \
  --probe-model your-default-model \
  --format markdown
```

Compare several relays at once:

```bash
openfusion compat --compat-config examples/compat.config.example.json
```

Or pass targets inline:

```bash
openfusion compat \
  --target "local|http://127.0.0.1:8787/v1|openfusion/fusion" \
  --target "your-relay|https://your-relay.example.com/v1|your-default-model|YOUR_RELAY_API_KEY"
```

The probe checks:

- `GET /models`
- `POST /chat/completions`
- `POST /chat/completions` with `stream: true`
- Tool-call round-trip: first assistant `tool_calls`, then follow-up `role: "tool"` message

## 5. Start OpenFusion With The Real Relay

```bash
YOUR_RELAY_API_KEY="..." openfusion serve \
  --config openfusion.config.json \
  --port 8787
```

## 6. Point Any Generic OpenAI-Compatible Client At OpenFusion

Use these values in any client that supports an OpenAI-compatible base URL:

```text
base_url = http://127.0.0.1:8787/v1
api_key = any-local-placeholder
model = openfusion/fusion
```

Or print the same values directly from the CLI:

```bash
openfusion adapter codex
```

From a git checkout, use `node src/cli.js adapter codex`.

If your Codex installation already points at an API relay, replace that relay URL with the local OpenFusion URL, and put the original relay URL in `openfusion.config.json`.

## Compatibility Notes

OpenFusion currently preserves the full chat `messages` transcript and supports normal JSON responses plus SSE-style `stream: true` responses.

Tool calls use a basic passthrough path. If a request includes `tools`, `tool_choice`, `parallel_tool_calls`, `role: "tool"`, or an assistant message with `tool_calls`, OpenFusion bypasses multi-model fusion and sends the request to one upstream model.

This is intentional: coding agents often depend on a strict tool-call protocol, and mixing multiple panel responses into one tool-call turn would be unsafe. Fusion still applies to ordinary assistant-answer requests that use `openfusion/fusion` or `openfusion/auto`; explicit role models use one upstream role model.

Selection rules:

- `model: "openfusion/fusion"` or `model: "openfusion/auto"` runs the route -> panel -> judge -> synthesis pipeline for normal assistant answers.
- `model: "openfusion/<role>"` uses that role's configured upstream model directly for normal assistant answers.
- Tool-call requests always use single-model passthrough. Explicit role models use that role; virtual fusion models use `fusion.toolRole`.
- The default `fusion.toolRole` is `writer`; configure it to a model that your upstream relay has verified for tool/function calling.

OpenFusion forwards the upstream response shape through the local OpenAI-compatible response and adds `openfusion.mode = "tool-passthrough"` trace metadata. OpenFusion does not execute tools; the client remains responsible for running tools and sending follow-up `role: "tool"` messages.

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
