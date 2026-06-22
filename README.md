# OpenFusion

> A local, inspectable multi-model fusion router for coding agents.

[![CI](https://github.com/Lling0000/OpenFusion/actions/workflows/ci.yml/badge.svg)](https://github.com/Lling0000/OpenFusion/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Lling0000/OpenFusion/badge)](https://securityscorecards.dev/viewer/?uri=github.com/Lling0000/OpenFusion)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

OpenFusion exposes one OpenAI-compatible endpoint and turns "pick a suitable model" into a transparent routing decision. `openfusion/auto` scores a candidate pool by task fit, benchmark percentile, price, throughput, latency, availability, fallback order, and session stickiness. Simple requests use one model, important requests add a verifier, and only complex or high-risk requests run the full fusion panel.

Use it when you want Codex, OpenCode, Aider, editor agents, or custom scripts to talk to a single local gateway instead of hard-coding one upstream model for every task.

- Local-first gateway: run it in front of OpenRouter or any OpenAI-compatible relay.
- Real SSE streaming: passthrough requests stream directly, and fusion streams incrementally once synthesis begins.
- Transparent routing: inspect Auto candidate scores, fallbacks, sticky session pins, selected roles, judge, and synthesizer.
- Coding-agent focused: debugging, review, architecture tradeoffs, tests, and docs.
- Dry-run friendly: try routing and orchestration without an API key.
- Small by design: zero runtime dependencies, plain Node.js, easy to fork.

LiteLLM routes LLM API calls. OpenFusion focuses on routing coding-agent work.

## Try It In 30 Seconds

Run directly from GitHub with `npx`:

```bash
npx github:Lling0000/OpenFusion doctor
npx github:Lling0000/OpenFusion --dry-run "Review this patch for security risks and missing tests" --json
npx github:Lling0000/OpenFusion compare --dry-run
npx github:Lling0000/OpenFusion adapter codex
npx github:Lling0000/OpenFusion adapter aider
```

After the first npm release, the same flow becomes:

```bash
npx openfusion@latest doctor
npx openfusion@latest adapter codex
npx openfusion@latest adapter aider
```

Dry-run mode does not send prompts upstream. It uses a mock client so you can inspect routing and orchestration locally.

What you should see from `compare --dry-run`:

```text
# OpenFusion Single-vs-Fusion Comparison Receipt

Mode: `dry-run`
Baseline: `fast:openai/gpt-4.1-mini`
Overall: **PASS** (3/3)

| Case | Status | Baseline | Fusion Panel | Judge | Synthesizer |
| --- | --- | --- | --- | --- | --- |
| `coding-review` | PASS | `fast:openai/gpt-4.1-mini` | `verifier` + `coder` + `fast` | `verifier:google/gemini-2.5-pro` | `writer:openai/gpt-4.1` |
| `architecture-tradeoff` | PASS | `fast:openai/gpt-4.1-mini` | `coder` + `reasoner` + `fast` + `verifier` | `verifier:google/gemini-2.5-pro` | `writer:openai/gpt-4.1` |
| `docs-polish` | PASS | `fast:openai/gpt-4.1-mini` | `writer` + `fast` + `verifier` | `verifier:google/gemini-2.5-pro` | `writer:openai/gpt-4.1` |
```

That receipt proves the same prompts were exercised through one baseline role and the multi-stage fusion route. In dry-run mode it proves orchestration, not answer quality; run the same command without `--dry-run` after configuring a real relay to collect real provider evidence.

When you want explicit task-quality evidence instead of orchestration-only evidence, add `--grade` to `compare`. That runs a grader role over the baseline answer and fused answer for the same prompts and emits a separate `Quality Comparison Receipt`.

From a git checkout:

```bash
git clone https://github.com/Lling0000/OpenFusion.git
cd OpenFusion
node src/cli.js doctor
node src/cli.js --dry-run "Review this patch for security risks and missing tests" --json
node src/cli.js compare --dry-run
```

Start a local OpenAI-compatible server:

```bash
npx github:Lling0000/OpenFusion serve --dry-run --port 8787
```

Call it like a normal chat completions endpoint:

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openfusion/auto",
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

For Codex, the recommended entry point is `openfusion/auto` in the model selector. Codex does not currently expose a public plugin UI slot for pinning a third-party toggle to the bottom-right of the composer, so the closest native-feeling setup is to make `openfusion/auto` the model you pick when Auto is on. Auto scores a candidate pool and may choose one model, a primary model plus verifier, or the full fusion panel depending on task risk and complexity.

## Features

- OpenAI-compatible local endpoint: `POST /v1/chat/completions`.
- Model listing endpoint: `GET /v1/models`.
- Debug route endpoint: `POST /debug/route`.
- CLI commands: `init`, `models`, `route`, `doctor`, `compat`, `adapter`, `codex`, `eval`, `compare`, `receipt`, `serve`, and `chat`.
- Adapter guides: `adapter codex` and `adapter aider` print local connection settings and verification commands.
- Transparent Auto policy with benchmark/price/performance/availability scoring, fallback, and session stickiness.
- Explicit `route -> panel -> judge -> synthesize` fusion pipeline when you request `openfusion/fusion` or Auto selects full fusion.
- Works with OpenRouter or any OpenAI-compatible API relay.
- Dry-run mode for local testing without API keys.
- JSON trace showing selected model roles and orchestration metadata.
- Eval receipts for routing and orchestration checks: `openfusion eval --dry-run`.
- Configurable role-to-model mapping.

## CLI

Installed or `npx` usage:

```bash
openfusion init
openfusion models
openfusion route "Review this API design for security and tests"
openfusion doctor
openfusion eval --dry-run
openfusion compare --dry-run
openfusion chat --dry-run "Compare two architectures for a Codex API relay" --json
openfusion serve --dry-run --port 8787
openfusion codex status
openfusion codex enable-auto
```

From a git checkout, replace `openfusion` with `node src/cli.js`:

```bash
node src/cli.js init
node src/cli.js models
node src/cli.js route "Review this API design for security and tests"
node src/cli.js doctor
node src/cli.js eval --dry-run
node src/cli.js compare --dry-run
node src/cli.js chat --dry-run "Compare two architectures for a Codex API relay" --json
node src/cli.js serve --dry-run --port 8787
node src/cli.js codex status
node src/cli.js codex enable-auto
```

`route` previews the selected panel, judge, synthesizer, and upstream call budget without calling any model. `doctor` checks configuration, role mappings, judge/synthesizer settings, and the dry-run fusion pipeline. It also includes a compact Fusion Receipt Summary with the selected panel roles, judge, synthesizer, trace id, phase count, and latency. Pass `--real` after setting your upstream key to test a real relay.

```bash
export OPENROUTER_API_KEY="..."
openfusion doctor --real
```

Use `--probe-url` to verify an OpenAI-compatible endpoint, including chat, basic streaming, and tool-call round-trip behavior:

```bash
openfusion doctor --probe-url http://127.0.0.1:8787/v1
openfusion doctor --probe-url http://127.0.0.1:8787/v1 --probe-timeout-ms 30000
```

Generate a Markdown compatibility report:

```bash
openfusion doctor --probe-url http://127.0.0.1:8787/v1 --format markdown
```

The Markdown report is designed to be pasted into issues or provider reports. Use `eval` or `receipt` when you need fuller routing/orchestration evidence with content hashes and excerpts.

Compare multiple providers or relays:

```bash
openfusion compat \
  --target "local|http://127.0.0.1:8787/v1|openfusion/fusion" \
  --target "openrouter|https://openrouter.ai/api/v1|openrouter/fusion|OPENROUTER_API_KEY" \
  --timeout-ms 30000
```

If a relay is slow to start streaming or complete tool-call turns, raise `--probe-timeout-ms` or `--timeout-ms` instead of assuming the compatibility surface is broken.

Print a local adapter guide:

```bash
openfusion adapter codex
openfusion adapter aider
```

Inspect or switch the Codex-facing Auto state:

```bash
openfusion codex status
openfusion codex enable-auto
openfusion codex enable-fusion
```

Generate a dry-run eval receipt for routing/orchestration evidence. The receipt includes a Routing Diversity section that shows whether different prompts selected different role/model panels:

```bash
openfusion eval --dry-run
openfusion eval --dry-run --json
openfusion receipt --dry-run "Review this Codex relay patch"
```

Generate a single-model baseline vs fusion receipt for the built-in eval prompts:

```bash
openfusion compare --dry-run
openfusion compare --dry-run --json
openfusion compare --dry-run --baseline-role coder
openfusion compare --dry-run --grade
openfusion compare --dry-run --grade --grader-role verifier
```

Without `--dry-run`, `compare` calls your configured upstream relay once through the baseline role and once through the fusion pipeline for each case. Treat the result as reproducible orchestration evidence; use task-specific grading before claiming one answer is better.

Add `--grade` when you want a second pass where one grader role compares the baseline answer with the fused answer and returns a structured winner/score/rationale/risks receipt. This is still model judgment rather than ground truth, but it gives you explicit quality evidence on top of the orchestration receipt.

## Use With Codex Or An API Relay

Create a config file:

```bash
openfusion init
```

Edit `openfusion.config.json` if your relay uses a different base URL or environment variable:

```json
{
  "upstream": {
    "baseURL": "https://your-relay.example.com/v1",
    "apiKeyEnv": "YOUR_RELAY_API_KEY"
  },
  "roles": {
    "coder": {
      "model": "your-code-model",
      "pricing": {
        "inputUsdPer1M": 0.5,
        "outputUsdPer1M": 1.5
      }
    }
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
  "auto": {
    "scoring": {
      "costQualityTradeoff": 7,
      "preferences": {
        "minAvailability": 0.4,
        "preferredMinThroughput": { "p90": 40 },
        "preferredMaxLatency": { "p90": 5 }
      }
    },
    "stickiness": {
      "enabled": true,
      "implicit": true,
      "ttlMs": 300000
    },
    "upstreamFallbacks": {
      "enabled": true,
      "maxModels": 2
    },
    "candidates": [
      {
        "id": "code-router",
        "role": "coder",
        "model": "openrouter/pareto-code",
        "skills": { "coding": 0.9, "reasoning": 0.75 },
        "benchmarks": { "coding": 86 },
        "pricing": {
          "inputUsdPer1M": 0.5,
          "outputUsdPer1M": 1.5
        },
        "performance": {
          "throughput": { "p50": 90, "p90": 50 },
          "latency": { "p50": 1.2, "p90": 3.5 }
        },
        "availability": 0.85,
        "upstream": {
          "provider": {
            "sort": { "by": "price", "partition": "none" },
            "preferred_min_throughput": { "p90": 40 },
            "allow_fallbacks": true
          },
          "plugins": [
            { "id": "pareto-router", "min_coding_score": 0.66 }
          ]
        }
      }
    ]
  },
  "fusion": {
    "maxUpstreamCalls": 6,
    "costEstimate": {
      "inputTokensPerCall": 2000,
      "outputTokensPerCall": 1000,
      "maxUsd": 0.1
    }
  }
}
```

Custom routing rules add to the built-in coding, reasoning, verification, and writing signals. Use `keywords` for simple matches or `patterns` for JavaScript regular expressions.

`maxUpstreamCalls` is a pre-flight safety guard. OpenFusion estimates `selected panel roles + judge + synthesis` and rejects the request before any upstream call if the route would exceed the limit.

Auto cost estimates come from `auto.candidates[].pricing`; explicit fusion cost estimates come from `roles.*.pricing`. Keep those numbers and performance metrics in sync with your relay; OpenFusion does not fetch live provider prices or live benchmark data.

If you override `auto.candidates`, provide the full candidate pool you want Auto to choose from. The generated default config includes candidates for `fast`, `reasoner`, `coder`, `verifier`, and `writer`.

Start OpenFusion:

```bash
YOUR_RELAY_API_KEY="..." openfusion serve --config openfusion.config.json --port 8787
```

Point Codex or another OpenAI-compatible client at:

```toml
# ~/.codex/config.toml
model = "openfusion/auto"
model_provider = "openfusion"

[model_providers.openfusion]
name = "OpenFusion local"
base_url = "http://127.0.0.1:8787/v1"
env_key = "OPENFUSION_API_KEY"
```

Set `OPENFUSION_API_KEY` to any local placeholder value. Keep your real relay key in the environment variable used by OpenFusion, such as `YOUR_RELAY_API_KEY` or `OPENROUTER_API_KEY`.

When Codex shows `openfusion/auto` in its model selector, that is the clearest sign that Auto is enabled. If Codex still shows a direct upstream model such as `gpt-5.5`, you are not routing through OpenFusion.

Generic OpenAI-compatible clients can use:

```text
base_url = http://127.0.0.1:8787/v1
api_key = any-local-placeholder
model = openfusion/auto
```

OpenFusion will receive the local request, score the Auto candidate pool, choose a single-model, verified, or full-fusion strategy, call your upstream relay, and return a normal chat completion.

`openfusion/fusion` remains available as the explicit manual model label when you want to force the full panel -> judge -> synthesis route instead of letting Auto choose.

See [docs/codex-relay.md](docs/codex-relay.md) for a more complete Codex/API relay setup guide, including `doctor --probe-url`.
See [docs/providers](docs/providers) for compatibility report templates and community provider matrix guidance. Provider reports are validated by `npm run check`.
See [examples](examples) for copy-paste quickstart, tool passthrough, provider compatibility scenarios, and the real OpenRouter `verify.sh` Codex gateway smoke.
Run `openfusion adapter codex` to print the exact local `base_url`, placeholder API key, startup commands, and verification steps for a Codex-style client. From a git checkout, use `node src/cli.js adapter codex`.

## What The Trace Shows

OpenFusion returns a normal chat completion response plus an `openfusion` trace:

```json
{
  "model": "openfusion/auto",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "Final synthesized answer..."
      }
    }
  ],
  "openfusion": {
    "mode": "auto",
    "auto": {
      "mode": "single-verify",
      "profile": "balanced",
      "selected": [
        {
          "role": "coder",
          "model": "deepseek/deepseek-chat-v3-0324",
          "score": 0.847,
          "metrics": {
            "benchmark_percentile": 86,
            "price_usd_per_1m": 0.55,
            "availability": 0.82
          },
          "upstream": {
            "provider": {
              "sort": { "by": "price", "partition": "none" }
            }
          }
        },
        { "role": "verifier", "model": "google/gemini-2.5-pro", "score": 0.781 }
      ],
      "session": {
        "source": "explicit",
        "id": "codex-workspace-123",
        "hit": true,
        "pins": { "roles": { "coder": "deepseek/deepseek-chat-v3-0324" } }
      }
    },
    "route": {
      "selectedRoles": ["coder", "verifier", "fast"],
      "rationale": "Selected coder, verifier, fast because the prompt contains coding/debugging and verification signals."
    },
    "panel": [
      { "role": "coder", "model": "deepseek/deepseek-chat-v3-0324" },
      { "role": "verifier", "model": "google/gemini-2.5-pro" }
    ],
    "judge": { "role": "verifier", "model": "google/gemini-2.5-pro" },
    "synthesizer": { "role": "writer", "model": "openai/gpt-4.1" },
    "trace": {
      "phase_count": 3,
      "phases": [
        {
          "phase": "primary",
          "role": "coder",
          "model": "deepseek/deepseek-chat-v3-0324",
          "upstream": {
            "models": ["openai/gpt-4.1-mini", "openai/gpt-4.1"],
            "session_id": "codex-workspace-123"
          },
          "attempts": [
            { "model": "deepseek/deepseek-chat-v3-0324", "status": "success" }
          ]
        }
      ]
    }
  }
}
```

Strict OpenAI SDK clients can ignore the extra `openfusion` field. Debugging tools can use it to explain why Auto chose a specific strategy or why explicit fusion routed to a specific panel.
For `openfusion/auto`, inspect `openfusion.auto` and `openfusion.trace.auto` to see the selected strategy, candidate scores, and fallbacks. For `openfusion/fusion`, inspect the panel, judge, synthesizer, and phase trace.

## How It Works

OpenFusion is deliberately small:

1. `src/router.js` scores the prompt for coding, reasoning, verification, and writing signals.
2. `src/auto.js` analyzes task risk and complexity, then scores candidate models by skill fit, benchmark percentile, configured price, throughput, latency, availability, role fit, and sticky session pins.
3. `src/auto.js` chooses `fast-single`, `smart-single`, `single-verify`, or `fusion-panel`, builds ordered fallbacks, and records every selection in trace metadata.
4. `src/auto.js` and `src/fusion.js` estimate upstream calls and enforce `fusion.maxUpstreamCalls` before any model call.
5. `src/fusion.js` runs the explicit full-fusion panel concurrently when `openfusion/fusion` is requested or Auto selects `fusion-panel`.
6. `src/prompts.js` creates independent panel prompts, judge prompts, and final synthesis prompts when the selected strategy needs them.
7. `src/openaiClient.js` calls an OpenAI-compatible `/chat/completions` upstream and preserves OpenRouter-style `models`, `provider`, `plugins`, and `session_id` fields.
8. `src/server.js` exposes a local `/v1/chat/completions` endpoint.

## Compatibility

OpenFusion implements a small OpenAI-compatible surface for local routing.

| Capability | Status | Notes |
| --- | --- | --- |
| `POST /v1/chat/completions` | Supported | Non-streaming chat completions. |
| `GET /v1/models` | Supported | Lists virtual OpenFusion models and role models. |
| `POST /debug/route` | Supported | Shows selected roles, Auto strategy/candidate scores when `openfusion/auto` is requested, and estimated upstream call budget without running models. |
| Streaming responses | Basic support | Role/tool passthrough streams directly. Explicit fusion streams once synthesis starts. Auto single/verified responses currently return an SSE-compatible completion chunk after the selected strategy finishes. |
| Tool calls / function calling | Basic passthrough | Requests with `tools`, `tool_choice`, `parallel_tool_calls`, `role: "tool"`, or assistant `tool_calls` bypass fusion and go to one upstream model so the tool-call protocol is preserved. |
| Embeddings, images, audio | Not supported | OpenFusion currently focuses on coding-agent chat workflows. |

## OpenRouter Fusion Notes

OpenRouter documents Fusion as `openrouter/fusion`, a model slug that performs multi-model deliberation in a single API call. Their docs describe a panel, a judge, and a final answer. See:

- <https://openrouter.ai/docs/guides/routing/routers/fusion-router>
- <https://openrouter.ai/docs/guides/features/server-tools/fusion>
- <https://openrouter.ai/docs/guides/features/plugins/fusion>
- <https://openrouter.ai/openrouter/fusion>

OpenFusion does not claim to reproduce OpenRouter's private routing logic. It is a transparent local pattern you can inspect, test, and adapt.

The official OpenRouter docs currently describe Fusion as a router that exposes a model slug, can be invoked through server-tool style Fusion integrations, runs a panel plus judge flow, and returns a final answer. See [docs/openrouter-fusion-notes.md](docs/openrouter-fusion-notes.md) for the local mapping and source links.

## Project Status

OpenFusion is an early, working prototype for local multi-model orchestration.

It is useful today for experimenting with role-based routing, Auto candidate scoring, fallback traces, sticky sessions, dry-run traces, eval receipts, graded comparison receipts, incremental synthesis streaming, basic upstream call budgets, and OpenAI-compatible relay integration. It is not yet a production gateway: full fan-out token multiplexing, live provider telemetry ingestion, provider-specific quirks, and fusion-aware tool orchestration are still on the roadmap. Basic tool-call passthrough already exists so coding-agent tool turns stay on one upstream model.

If you adopt it, keep tests, code review, and domain-specific validation in the loop. Fusion improves coverage of perspectives; it does not guarantee correctness.

## Roadmap

- Token-by-token streaming from the local server.
- Better prompt classification with examples and custom rules.
- Optional live telemetry import for provider prices, latency, throughput, availability, and context windows.
- Real-provider eval receipts comparing single-model vs fusion answers with task-specific grading.
- Single-model vs fusion comparison receipts with `openfusion compare`.
- Adapter presets for Codex, OpenCode, Continue, Cline, Aider, and LiteLLM.
- Deeper compatibility doctor checks for provider quirks: tool calls, usage chunks, and headers.
- Fusion-aware tool orchestration after the single-model passthrough path is stable.
- Worktree fanout mode for trying multiple coding agents and letting tests judge the winner.
- Web trace viewer for panel answers and judge decisions.

## Good First Contributions

OpenFusion is intentionally small, so focused contributions are welcome.

- Add more adapter presets for OpenCode, Continue, Cline, and LiteLLM.
- Add provider compatibility tests for OpenRouter and other OpenAI-compatible relays.
- Add sanitized provider compatibility reports under `docs/providers/`.
- Add token-by-token streaming support for `/v1/chat/completions`.
- Improve tool-call passthrough and add tool-call round-trip fixtures.
- Add real-provider eval receipts comparing single-model and fused answers.
- Add a trace viewer for panel answers, judge notes, and final synthesis.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development commands and pull request guidelines.
See [CHANGELOG.md](CHANGELOG.md) for release notes, compatibility changes, and migration notes.

## Privacy And Limits

- Dry-run mode sends no prompt data upstream.
- Real mode sends your prompt to each selected upstream model role.
- Explicit role models such as `openfusion/coder` send normal chat requests to one configured upstream model.
- Tool-call passthrough sends a tool turn to one upstream model only, using `fusion.toolRole` by default for virtual models.
- Do not put secrets in prompts or config files.
- OpenFusion is an orchestration layer, not a guarantee that a fused answer is correct. Keep tests, review, and domain-specific validation in the loop.

## Development

```bash
npm test
npm run smoke
npm run doctor
npm run compare
npm run check:providers
npm run check:examples
npm run check:package
npm run check
```

See [docs/release-checklist.md](docs/release-checklist.md) for the local release checklist and manual smoke commands. See [SECURITY.md](SECURITY.md) for secret-handling and vulnerability reporting guidance.

## License

MIT
