# Real Relay OpenRouter Example

This example shows the real upstream path. Real mode sends your prompt to each selected upstream role model, so start with dry-run first.

## 1. Dry-Run First

```bash
openfusion doctor
openfusion --dry-run --json "Review this Codex relay patch"
```

## 2. Configure OpenRouter

Copy [env.example](env.example) into your shell and set a real key:

```bash
export OPENROUTER_API_KEY="..."
```

Use [openfusion.config.json](openfusion.config.json) as the starting config:

```bash
openfusion doctor --real --config examples/real-relay-openrouter/openfusion.config.json
```

## 3. Start The Local Gateway

```bash
OPENROUTER_API_KEY="..." openfusion serve \
  --config examples/real-relay-openrouter/openfusion.config.json \
  --port 8787
```

## 4. Probe OpenFusion's Local Surface

In another terminal:

```bash
openfusion doctor --probe-url http://127.0.0.1:8787/v1 --probe-model openfusion/fusion
```

## 5. Send A Chat Request

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d @examples/quickstart/chat-request.json
```

## Notes

- Real mode fans ordinary requests out to multiple upstream role models.
- Tool-call requests bypass fusion and go to one upstream model.
- Keep `OPENROUTER_API_KEY` out of config files and committed logs.
