# OpenRouter Fusion Notes

OpenRouter describes Fusion as a multi-model deliberation router exposed through the `openrouter/fusion` model slug.

Useful official references:

- <https://openrouter.ai/docs/guides/routing/routers/fusion-router>
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
