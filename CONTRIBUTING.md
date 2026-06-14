# Contributing To OpenFusion

Thanks for helping make OpenFusion a better local gateway for coding agents.

## Development

OpenFusion intentionally has no runtime dependencies. You only need Node.js 20 or newer.

```bash
git clone https://github.com/Lling0000/OpenFusion.git
cd OpenFusion
npm run check
```

Useful commands:

```bash
npm test
npm run smoke
npm run doctor
npm run check:providers
node src/cli.js serve --dry-run --port 8787
```

## Good First Areas

- Provider compatibility probes for OpenRouter, LiteLLM, vLLM, and custom relays.
- Sanitized provider compatibility reports under `docs/providers/`.
- Tool-call round-trip fixtures for Codex-style agent loops.
- Better routing rules for coding, review, docs, and architecture prompts.
- Token-by-token streaming.
- Trace viewer experiments.

## Pull Request Guidelines

- Keep changes focused.
- Add tests for behavior changes.
- Update README or docs when CLI/API behavior changes.
- Do not commit real API keys, relay URLs with credentials, private prompts, or logs containing secrets.
- Prefer clear compatibility behavior over silent fallback. If OpenFusion cannot support a field safely, make that visible.

## Design Principles

- Preserve OpenAI-compatible request semantics wherever possible.
- Keep Fusion inspectable: selected roles, judge, synthesizer, and passthrough decisions should be explainable.
- Prefer local dry-run tests before requiring real upstream API keys.
- Do not claim quality improvements without reproducible evidence.
