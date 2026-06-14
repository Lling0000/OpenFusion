# OpenFusion

The local AI gateway for coding agents.

Use Codex, OpenCode, Aider, custom scripts, and OpenAI SDK clients through one OpenAI-compatible router. OpenFusion can route tasks by intent, ask a small specialist panel, judge disagreements, and synthesize one final answer while keeping the orchestration transparent.

It is inspired by OpenRouter's public `openrouter/fusion` idea, but designed to be local-first, inspectable, and easy to adapt to your own API relay.

```bash
npm test
node src/cli.js --dry-run "Debug this flaky React test and propose a patch" --json
```

Example dry-run route:

```json
{
  "selectedRoles": ["coder", "verifier", "fast"],
  "rationale": "Selected coder, verifier, fast because the prompt contains coding/debugging signals."
}
```

## Why

One model is rarely best at everything. Coding, planning, verification, and writing reward different strengths. OpenRouter's Fusion router shows a productized version of this idea: multi-model deliberation behind a single model slug. OpenFusion makes a small open-source version you can run locally in front of your own API relay.

This is especially useful when your Codex or editor setup already talks to an API relay. Instead of hard-coding one model for every task, OpenFusion can expose one local OpenAI-compatible endpoint and decide which upstream model roles should collaborate for each question.

LiteLLM routes LLM API calls. OpenFusion focuses on routing coding-agent work: debugging, review, architecture tradeoffs, tests, and final answer synthesis.

## Features

- OpenAI-compatible local endpoint: `POST /v1/chat/completions`.
- Model listing endpoint: `GET /v1/models`.
- Debug route endpoint: `POST /debug/route`.
- Zero-dependency Node.js CLI and server.
- Transparent `route -> panel -> judge -> synthesize` pipeline.
- Works with OpenRouter or any OpenAI-compatible API relay.
- Dry-run mode for local testing without API keys.
- JSON trace showing selected model roles and orchestration metadata.
- Configurable role-to-model mapping.

## Quickstart

```bash
git clone https://github.com/Lling0000/OpenFusion.git
cd OpenFusion
npm test
npm run smoke
```

Run the CLI without sending data upstream:

```bash
node src/cli.js --dry-run "Compare two architectures for a Codex API relay" --json
```

Run as a local OpenAI-compatible server:

```bash
node src/cli.js --server --dry-run --port 8787
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
        "content": "Review this API relay design for security risks and test gaps"
      }
    ]
  }'
```

Inspect routing without calling upstream:

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

## Use With A Real Relay

Copy the example config:

```bash
cp examples/openfusion.config.example.json openfusion.config.json
```

Set your API key:

```bash
export OPENROUTER_API_KEY="..."
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

Run a real upstream fusion call:

```bash
node src/cli.js --config openfusion.config.json "Debug this failing test and propose a minimal patch"
```

## How It Works

OpenFusion is deliberately small:

1. `src/router.js` scores the prompt for coding, reasoning, verification, and writing signals.
2. `src/fusion.js` runs the selected specialist panel concurrently.
3. `src/prompts.js` creates independent panel prompts, judge prompts, and final synthesis prompts.
4. `src/openaiClient.js` calls an OpenAI-compatible `/chat/completions` upstream.
5. `src/server.js` exposes a local `/v1/chat/completions` endpoint.

The response includes normal OpenAI-compatible fields plus an `openfusion` trace. Strict clients can ignore this unknown field; debugging tools can use it to show which roles and upstream models were involved.

```json
{
  "model": "openfusion/fusion",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "..."
      }
    }
  ],
  "openfusion": {
    "route": "...",
    "panel": [
      { "role": "coder", "model": "deepseek/deepseek-chat-v3-0324" }
    ]
  }
}
```

## OpenRouter Fusion Notes

OpenRouter documents Fusion as `openrouter/fusion`, a model slug that performs multi-model deliberation in a single API call. Their docs describe a panel, a judge, and a final answer. See:

- <https://openrouter.ai/docs/guides/routing/routers/fusion-router>
- <https://openrouter.ai/openrouter/fusion>

OpenFusion does not claim to reproduce OpenRouter's private routing logic. It is a transparent local pattern you can inspect, test, and adapt.

## Roadmap

- Streaming responses from the local server.
- Better prompt classification with examples and custom rules.
- Budget-aware routing by cost, latency, and context window.
- Eval receipts comparing single-model vs fusion answers.
- Adapter presets for Codex, OpenCode, Continue, Cline, Aider, and LiteLLM.
- Compatibility doctor for provider quirks: tool calls, streaming, usage chunks, and headers.
- Worktree fanout mode for trying multiple coding agents and letting tests judge the winner.
- Web trace viewer for panel answers and judge decisions.

## Privacy And Limits

- Dry-run mode sends no prompt data upstream.
- Real mode sends your prompt to each selected upstream model role.
- Do not put secrets in prompts or config files.
- OpenFusion is an orchestration layer, not a guarantee that a fused answer is correct. Keep tests, review, and domain-specific validation in the loop.

## Development

```bash
npm test
npm run smoke
```

## License

MIT
