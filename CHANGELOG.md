# Changelog

All notable OpenFusion changes are documented here.

OpenFusion follows a pragmatic pre-1.0 changelog: breaking changes, compatibility changes, new CLI commands, provider behavior changes, and migration notes should be listed before every tag or package publish.

## Unreleased

### Added

- `openfusion compare` generates a single-model baseline vs multi-stage fusion comparison receipt for the built-in eval prompts.
- README and real OpenRouter relay examples now show the expected comparison receipt and Codex handoff path.

### Fixed

- `doctor --real` now respects `fusion.timeoutMs` instead of capping upstream calls at 30 seconds, which helps slower API relays complete real fusion checks.

### Compatibility Notes

- `compare --dry-run` proves orchestration only. Run `compare` without `--dry-run` against a configured relay for real provider evidence.
- Local streaming remains SSE-compatible but buffered after the full fusion result is ready; token-by-token streaming is still planned.

## 0.1.0 - Initial Prototype

### Added

- Local OpenAI-compatible chat gateway with `GET /v1/models`, `POST /v1/chat/completions`, and `POST /debug/route`.
- Role-based fusion pipeline: route, panel, judge, and final synthesis.
- Codex adapter guide for placing OpenFusion in front of a Codex API relay.
- Tool-call passthrough for Codex-style tool turns.
- Dry-run mode, doctor checks, provider compatibility matrix, eval receipts, and fusion receipts.
- Configurable routing rules, upstream call budget guard, and optional static cost estimates.

### Compatibility Notes

- OpenFusion is a transparent local pattern inspired by OpenRouter Fusion, not a clone of OpenRouter's private routing logic.
- Real answer-quality claims require real provider calls and task-specific grading.
