# Release Checklist

Use this checklist before tagging or publishing OpenFusion.

## Local Checks

```bash
npm run check
git status --short --branch
```

`npm run check` runs:

- `npm test`
- `npm run smoke`
- `npm run doctor`
- `node scripts/secret-scan.js`

## Manual Smoke

Start the local server:

```bash
node src/cli.js serve --dry-run --port 8787
```

Probe it:

```bash
node src/cli.js doctor --probe-url http://127.0.0.1:8787/v1
```

Test a tool-call passthrough request:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openfusion/fusion",
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "run_tests",
          "parameters": {}
        }
      }
    ],
    "tool_choice": {
      "type": "function",
      "function": {
        "name": "run_tests"
      }
    },
    "messages": [
      {
        "role": "user",
        "content": "Call the test tool"
      }
    ]
  }'
```

## Documentation

- README compatibility table matches current behavior.
- `docs/codex-relay.md` reflects the current Codex/API relay setup.
- Examples do not contain real credentials.
- Roadmap does not claim unimplemented features as complete.

## GitHub

- CI is green on `main`.
- Issues and PR templates are present.
- Release notes mention compatibility changes and migration notes.
