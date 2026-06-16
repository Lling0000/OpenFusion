# OpenFusion Examples

These examples are copy-paste paths for the most important OpenFusion workflows.

If you only try one command first, run:

```bash
openfusion compare --dry-run
```

Expected result: a `Single-vs-Fusion Comparison Receipt` where the same built-in prompts run through one baseline role and through different fusion panels. This proves local routing/orchestration before you spend provider credits.

## Start Here

- [quickstart](quickstart/README.md): preview routing without model calls, run the dry-run fusion pipeline, start a local OpenAI-compatible server, and inspect the `openfusion` trace.
- [codex-local-adapter](codex-local-adapter/README.md): copy a Codex `~/.codex/config.toml` provider snippet and verify the local gateway.
- [aider-local-adapter](aider-local-adapter/README.md): point Aider at the local OpenFusion base URL and verify the gateway before using a real relay.
- [eval-receipt](eval-receipt/README.md): generate routing/orchestration receipts for built-in cases or one prompt.
- [tool-passthrough](tool-passthrough/README.md): see why Codex-style tool calls bypass multi-model fusion and stay on one upstream model.
- [provider-compat](provider-compat/README.md): generate provider compatibility matrices and turn them into reports under `docs/providers/`.
- [real-relay-openrouter](real-relay-openrouter/README.md): move from dry-run to a real OpenRouter upstream config, then run `verify.sh` for an end-to-end Codex gateway smoke.

## Config Files

- [openfusion.config.example.json](openfusion.config.example.json): OpenRouter-oriented role mapping.
- [api-relay.config.example.json](api-relay.config.example.json): generic OpenAI-compatible relay template.
- [compat.config.example.json](compat.config.example.json): compare local OpenFusion, OpenRouter, and a custom relay.

From a git checkout, replace `openfusion` with `node src/cli.js` in command examples.
