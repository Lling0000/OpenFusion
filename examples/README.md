# OpenFusion Examples

These examples are copy-paste paths for the most important OpenFusion workflows.

## Start Here

- [quickstart](quickstart/README.md): preview routing without model calls, run the dry-run fusion pipeline, start a local OpenAI-compatible server, and inspect the `openfusion` trace.
- [codex-local-adapter](codex-local-adapter/README.md): copy a Codex `~/.codex/config.toml` provider snippet and verify the local gateway.
- [eval-receipt](eval-receipt/README.md): generate routing/orchestration receipts for built-in cases or one prompt.
- [tool-passthrough](tool-passthrough/README.md): see why Codex-style tool calls bypass multi-model fusion and stay on one upstream model.
- [provider-compat](provider-compat/README.md): generate provider compatibility matrices and turn them into reports under `docs/providers/`.
- [real-relay-openrouter](real-relay-openrouter/README.md): move from dry-run to a real OpenRouter upstream config.

## Config Files

- [openfusion.config.example.json](openfusion.config.example.json): OpenRouter-oriented role mapping.
- [api-relay.config.example.json](api-relay.config.example.json): generic OpenAI-compatible relay template.
- [compat.config.example.json](compat.config.example.json): compare local OpenFusion, OpenRouter, and a custom relay.

From a git checkout, replace `openfusion` with `node src/cli.js` in command examples.
