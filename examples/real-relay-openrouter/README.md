# Real Relay OpenRouter Example

This example shows the real upstream path. Real mode sends your prompt to each selected upstream role model, so start with dry-run first.

## 1. Dry-Run First

```bash
openfusion doctor
openfusion compare --dry-run
openfusion --dry-run --json "Review this Codex relay patch"
```

`compare --dry-run` should print a `Single-vs-Fusion Comparison Receipt` with one baseline role and multiple fusion panels. It does not call OpenRouter.

## 2. Configure OpenRouter

Copy [env.example](env.example) into your shell and set a real key:

```bash
export OPENROUTER_API_KEY="..."
```

Use [openfusion.config.example.json](openfusion.config.example.json) as the starting config:

```bash
cp examples/real-relay-openrouter/openfusion.config.example.json openfusion.config.json
openfusion doctor --real --config openfusion.config.json
```

Generate a real baseline-vs-fusion receipt against OpenRouter:

```bash
openfusion compare --config openfusion.config.json --baseline-role fast
openfusion compare --config openfusion.config.json --baseline-role fast --grade --grader-role verifier
```

If this fails, first check that each role model in `openfusion.config.json` is available to your OpenRouter account. You can temporarily switch a role to a model you know works, then rerun `doctor --real`.

Or run the end-to-end verification script from a git checkout:

```bash
OPENFUSION_BIN="node src/cli.js" \
OPENFUSION_CONFIG="examples/real-relay-openrouter/openfusion.config.example.json" \
examples/real-relay-openrouter/verify.sh
```

The script runs `doctor --real`, `compare`, `compare --grade`, prints the Codex adapter snippet, starts a local OpenFusion server, probes `http://127.0.0.1:8787/v1`, and then shuts the server down.

## 3. Start The Local Gateway

```bash
OPENROUTER_API_KEY="..." openfusion serve \
  --config openfusion.config.json \
  --port 8787
```

## 4. Probe OpenFusion's Local Surface

In another terminal:

```bash
openfusion doctor --probe-url http://127.0.0.1:8787/v1 --probe-model openfusion/fusion
```

## 5. Point Codex At OpenFusion

Set a local placeholder key for Codex. This is not your OpenRouter key:

```bash
export OPENFUSION_API_KEY="openfusion-local-placeholder"
```

Print the Codex adapter snippet:

```bash
openfusion adapter codex --config openfusion.config.json --port 8787
```

Add the printed provider block to `~/.codex/config.toml`:

```toml
model = "openfusion/fusion"
model_provider = "openfusion"

[model_providers.openfusion]
name = "OpenFusion local"
base_url = "http://127.0.0.1:8787/v1"
env_key = "OPENFUSION_API_KEY"
```

Keep `OPENROUTER_API_KEY` only in the terminal that starts OpenFusion. Codex should only know the local placeholder key and the local `base_url`.

## 6. Send A Chat Request

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d @examples/quickstart/chat-request.json
```

## 7. Save A Provider Report

When the local and real checks pass, generate a sanitized report for `docs/providers/`:

```bash
openfusion compat \
  --target "openrouter|https://openrouter.ai/api/v1|openrouter/fusion|OPENROUTER_API_KEY" \
  --target "local-openfusion|http://127.0.0.1:8787/v1|openfusion/fusion"
```

Copy the output into a Markdown file using the template in [../../docs/providers/README.md](../../docs/providers/README.md). Do not include API keys, private relay URLs, or private model aliases.

For task-quality evidence, also save the Markdown output of:

```bash
openfusion compare --config openfusion.config.json --baseline-role fast --grade --grader-role verifier
```

Keep that report separate from the compatibility matrix. The matrix proves protocol compatibility; the graded comparison receipt is model-judged evidence about answer quality on the built-in prompts.

## Notes

- Real mode fans ordinary requests out to multiple upstream role models.
- Tool-call requests bypass fusion and go to one upstream model.
- Keep `OPENROUTER_API_KEY` out of config files and committed logs.
- OpenFusion's local streaming is SSE-compatible but buffered after the full fusion result is ready; it is not token-by-token yet.
- `verify.sh` makes real upstream calls and may spend OpenRouter credits.
