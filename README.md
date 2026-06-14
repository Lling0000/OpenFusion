# OpenFusion

> A local, inspectable multi-model fusion router for coding agents.

[![CI](https://github.com/Lling0000/OpenFusion/actions/workflows/ci.yml/badge.svg)](https://github.com/Lling0000/OpenFusion/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

OpenFusion exposes one OpenAI-compatible endpoint and fans each request out to a small role-based panel, such as `coder`, `reasoner`, `verifier`, and `writer`. It then judges disagreements and synthesizes one final answer, while returning a trace you can inspect.

Use it when you want Codex, OpenCode, Aider, editor agents, or custom scripts to talk to a single local gateway instead of hard-coding one upstream model for every task.

- Local-first gateway: run it in front of OpenRouter or any OpenAI-compatible relay.
- Transparent fusion: inspect route scores, selected roles, judge, and synthesizer.
- Coding-agent focused: debugging, review, architecture tradeoffs, tests, and docs.
- Dry-run friendly: try routing and orchestration without an API key.
- Small by design: zero runtime dependencies, plain Node.js, easy to fork.

LiteLLM routes LLM API calls. OpenFusion focuses on routing coding-agent work.

## Try It In 30 Seconds

```bash
git clone https://github.com/Lling0000/OpenFusion.git
cd OpenFusion
node src/cli.js doctor
node src/cli.js --dry-run "Review this patch for security risks and missing tests" --json
```

Dry-run mode does not send prompts upstream. It uses a mock client so you can inspect routing and orchestration locally.

Start a local OpenAI-compatible server:

```bash
node src/cli.js serve --dry-run --port 8787
```

Call it like a normal chat completions endpoint:

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openfusion/fusion",
    "messages": [
      {
        "role": "user",
        "content": "Debug this flaky API test and propose a minimal patch"
      }
    ]
  }'
```

Inspect routing without running the full pipeline:

```bash
curl http://localhost:8787/debug/route \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openfusion/auto",
    "messages": [
      {
        "role": "user",
        "content": "Review this patch for security and test risks"
      }
    ]
  }'
```

## Why

One model is rarely best at everything. Coding, planning, verification, and writing reward different strengths. OpenRouter's Fusion router shows a productized version of this idea: multi-model deliberation behind a single model slug. OpenFusion makes a small open-source version you can run locally in front of your own API relay.

This is especially useful when your Codex or editor setup already talks to an API relay. Instead of hard-coding one model for every task, OpenFusion can expose one local OpenAI-compatible endpoint and decide which upstream model roles should collaborate for each question.

## Features

- OpenAI-compatible local endpoint: `POST /v1/chat/completions`.
- Model listing endpoint: `GET /v1/models`.
- Debug route endpoint: `POST /debug/route`.
- CLI commands: `init`, `models`, `doctor`, `serve`, and `chat`.
- Transparent `route -> panel -> judge -> synthesize` pipeline.
- Works with OpenRouter or any OpenAI-compatible API relay.
- Dry-run mode for local testing without API keys.
- JSON trace showing selected model roles and orchestration metadata.
- Configurable role-to-model mapping.

## CLI

```bash
node src/cli.js init
node src/cli.js models
node src/cli.js doctor
node src/cli.js chat --dry-run "Compare two architectures for a Codex API relay" --json
node src/cli.js serve --dry-run --port 8787
```

`doctor` checks configuration, role mappings, judge/synthesizer settings, and the dry-run fusion pipeline. Pass `--real` after setting your upstream key to test a real relay.

```bash
export OPENROUTER_API_KEY="..."
node src/cli.js doctor --real
```

Use `--probe-url` to verify an OpenAI-compatible endpoint, including chat, basic streaming, and tool-call round-trip behavior:

```bash
node src/cli.js doctor --probe-url http://127.0.0.1:8787/v1
```

Generate a Markdown compatibility report:

```bash
node src/cli.js doctor --probe-url http://127.0.0.1:8787/v1 --format markdown
```

## Use With Codex Or An API Relay

Create a config file:

```bash
node src/cli.js init
```

Edit `openfusion.config.json` if your relay uses a different base URL or environment variable:

```json
{
  "upstream": {
    "baseURL": "https://your-relay.example.com/v1",
    "apiKeyEnv": "YOUR_RELAY_API_KEY"
  }
}
```

Start OpenFusion:

```bash
YOUR_RELAY_API_KEY="..." node src/cli.js serve --config openfusion.config.json --port 8787
```

Point Codex or another OpenAI-compatible client at:

```text
base_url = http://127.0.0.1:8787/v1
api_key = any-local-placeholder
model = openfusion/fusion
```

OpenFusion will receive the local request, choose a role panel, call your upstream relay, and return a normal chat completion.

See [docs/codex-relay.md](docs/codex-relay.md) for a more complete Codex/API relay setup guide, including `doctor --probe-url`.

## What The Trace Shows

OpenFusion returns a normal chat completion response plus an `openfusion` trace:

```json
{
  "model": "openfusion/fusion",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "Final synthesized answer..."
      }
    }
  ],
  "openfusion": {
    "route": {
      "selectedRoles": ["coder", "verifier", "fast"],
      "rationale": "Selected coder, verifier, fast because the prompt contains coding/debugging and verification signals."
    },
    "panel": [
      { "role": "coder", "model": "deepseek/deepseek-chat-v3-0324" },
      { "role": "verifier", "model": "google/gemini-2.5-pro" }
    ],
    "judge": { "role": "verifier", "model": "google/gemini-2.5-pro" },
    "synthesizer": { "role": "writer", "model": "openai/gpt-4.1" }
  }
}
```

Strict OpenAI SDK clients can ignore the extra `openfusion` field. Debugging tools can use it to explain why a request was routed to a specific panel.

## How It Works

OpenFusion is deliberately small:

1. `src/router.js` scores the prompt for coding, reasoning, verification, and writing signals.
2. `src/fusion.js` runs the selected specialist panel concurrently.
3. `src/prompts.js` creates independent panel prompts, judge prompts, and final synthesis prompts.
4. `src/openaiClient.js` calls an OpenAI-compatible `/chat/completions` upstream.
5. `src/server.js` exposes a local `/v1/chat/completions` endpoint.

## Compatibility

OpenFusion implements a small OpenAI-compatible surface for local routing.

| Capability | Status | Notes |
| --- | --- | --- |
| `POST /v1/chat/completions` | Supported | Non-streaming chat completions. |
| `GET /v1/models` | Supported | Lists virtual OpenFusion models and role models. |
| `POST /debug/route` | Supported | Shows selected roles and routing rationale without running the full pipeline. |
| Streaming responses | Basic support | Returns SSE-compatible chunks after the fusion result is ready. Token-by-token streaming is planned. |
| Tool calls / function calling | Basic passthrough | Requests with `tools`, `tool_choice`, `parallel_tool_calls`, `role: "tool"`, or assistant `tool_calls` bypass fusion and go to one upstream model so the tool-call protocol is preserved. |
| Embeddings, images, audio | Not supported | OpenFusion currently focuses on coding-agent chat workflows. |

## OpenRouter Fusion Notes

OpenRouter documents Fusion as `openrouter/fusion`, a model slug that performs multi-model deliberation in a single API call. Their docs describe a panel, a judge, and a final answer. See:

- <https://openrouter.ai/docs/guides/routing/routers/fusion-router>
- <https://openrouter.ai/docs/guides/features/server-tools/fusion>
- <https://openrouter.ai/docs/guides/features/plugins/fusion>
- <https://openrouter.ai/openrouter/fusion>

OpenFusion does not claim to reproduce OpenRouter's private routing logic. It is a transparent local pattern you can inspect, test, and adapt.

## Project Status

OpenFusion is an early, working prototype for local multi-model orchestration.

It is useful today for experimenting with role-based routing, dry-run traces, and OpenAI-compatible relay integration. It is not yet a production gateway: streaming, tool-call passthrough, provider-specific quirks, budget controls, and eval receipts are still on the roadmap.

If you adopt it, keep tests, code review, and domain-specific validation in the loop. Fusion improves coverage of perspectives; it does not guarantee correctness.

## Roadmap

- Token-by-token streaming from the local server.
- Better prompt classification with examples and custom rules.
- Budget-aware routing by cost, latency, and context window.
- Eval receipts comparing single-model vs fusion answers.
- Adapter presets for Codex, OpenCode, Continue, Cline, Aider, and LiteLLM.
- Deeper compatibility doctor checks for provider quirks: tool calls, usage chunks, and headers.
- Fusion-aware tool orchestration after the single-model passthrough path is stable.
- Worktree fanout mode for trying multiple coding agents and letting tests judge the winner.
- Web trace viewer for panel answers and judge decisions.

## Good First Contributions

OpenFusion is intentionally small, so focused contributions are welcome.

- Add adapter presets for Codex, Aider, OpenCode, Continue, Cline, and LiteLLM.
- Add provider compatibility tests for OpenRouter and other OpenAI-compatible relays.
- Add token-by-token streaming support for `/v1/chat/completions`.
- Improve tool-call passthrough and add tool-call round-trip fixtures.
- Add eval receipts comparing single-model and fused answers.
- Add a trace viewer for panel answers, judge notes, and final synthesis.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development commands and pull request guidelines.

## Privacy And Limits

- Dry-run mode sends no prompt data upstream.
- Real mode sends your prompt to each selected upstream model role.
- Tool-call passthrough sends a tool turn to one upstream model only, using `fusion.toolRole` by default for virtual models.
- Do not put secrets in prompts or config files.
- OpenFusion is an orchestration layer, not a guarantee that a fused answer is correct. Keep tests, review, and domain-specific validation in the loop.

## Development

```bash
npm test
npm run smoke
npm run doctor
npm run check
```

See [docs/release-checklist.md](docs/release-checklist.md) for the local release checklist and manual smoke commands. See [SECURITY.md](SECURITY.md) for secret-handling and vulnerability reporting guidance.

## License

MIT
