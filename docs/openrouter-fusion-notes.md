# OpenRouter Fusion Notes

OpenRouter describes Fusion as a multi-model deliberation router exposed through the `openrouter/fusion` model slug.

Useful official references:

- <https://openrouter.ai/docs/guides/routing/routers/fusion-router>
- <https://openrouter.ai/docs/guides/routing/routers/auto-router>
- <https://openrouter.ai/docs/guides/routing/routers/pareto-router>
- <https://openrouter.ai/docs/guides/routing/provider-selection>
- <https://openrouter.ai/docs/guides/routing/model-fallbacks>
- <https://openrouter.ai/openrouter/fusion>
- <https://openrouter.ai/docs/features/tools/server-tools>

## What OpenRouter Fusion appears to do

Based on the official documentation and model page:

- The caller can request `model: "openrouter/fusion"` through the normal OpenRouter chat completions API.
- OpenRouter treats Fusion as a router rather than a single provider model.
- Fusion creates a small multi-model deliberation: a panel of models responds, a judge compares the panel, and a final answer is produced.
- OpenRouter also documents a server-tool style usage with `openrouter:fusion` for eligible requests.
- The public model page currently presents Fusion as having a 128k context window and zero listed input/output token price. Always re-check the live page before making cost claims.

## How OpenFusion maps the idea locally

OpenFusion intentionally does not clone OpenRouter internals. It implements a transparent local version for OpenAI-compatible relays:

1. Route the prompt to role-based model slots.
2. Run selected panelists concurrently.
3. Ask a judge role to compare agreement, conflicts, risks, and missing evidence.
4. Ask a synthesizer role for the final answer.
5. Return an OpenAI-compatible `/v1/chat/completions` response with an extra `openfusion` trace.

This keeps the project understandable, testable without secrets, and adaptable to any API relay that exposes OpenAI-compatible chat completions.

## How OpenFusion maps OpenRouter-style routing

OpenFusion's `openfusion/auto` is closer to an inspectable local policy than a private hosted router:

1. Score configured candidates by task fit, benchmark percentile, price, throughput, latency, availability, role fit, and sticky session pins.
2. Choose a strategy: one model for simple work, one primary plus verifier for important work, or full fusion for complex/high-risk work.
3. Build ordered local fallbacks for each phase.
4. Forward OpenRouter-style request fields (`models`, `provider`, `plugins`, `session_id`) to the upstream relay when the relay supports them.
5. Record candidate scores, upstream options, selected phases, and fallback attempts in `openfusion.trace`.

OpenRouter's provider routing supports provider sorting, soft throughput/latency preferences, hard price caps, and provider fallbacks. OpenFusion does not fetch OpenRouter's live provider telemetry; it lets you provide the metrics in `auto.candidates` and forwards provider preferences to the upstream.

OpenRouter's model fallback shape uses a `models` array. OpenFusion has two layers:

- Local fallback: `src/auto.js` retries the next configured candidate when a candidate call fails.
- Upstream fallback: `auto.upstreamFallbacks.enabled` adds a `models` array to the upstream request so OpenRouter-compatible relays can also cascade inside one upstream call.

OpenRouter Auto/Pareto session stickiness pins selected model/provider choices inside a conversation. OpenFusion implements a local version for Auto candidates: `session_id` or `x-session-id` creates an explicit sticky key, and implicit stickiness can derive a key from the first system/user messages. Successful Auto phases pin role -> model choices for a five-minute default TTL.
