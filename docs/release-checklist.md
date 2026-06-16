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
- `npm run eval`
- `npm run compare`
- `node scripts/validate-provider-reports.js`
- `node scripts/validate-examples.js`
- `node scripts/package-smoke.js`
- `node scripts/secret-scan.js`

## Package Smoke

Release checks run `npm pack`, install the generated tarball into a temporary project, and verify the packaged `openfusion` bin can run:

```bash
npm run check:package
```

This catches missing published files, broken shebangs, and CLI drift before tagging.

`npm publish` also runs `npm run check` through `prepublishOnly`.

## Manual Smoke

Start the local server in one terminal:

```bash
node src/cli.js serve --dry-run --port 8787
```

Probe it from another terminal:

```bash
node src/cli.js doctor --probe-url http://127.0.0.1:8787/v1
node src/cli.js doctor --probe-url http://127.0.0.1:8787/v1 --probe-timeout-ms 30000
```

The probe covers `/models`, regular chat completions, SSE-style streaming, and a tool-call round-trip.

Generate the Markdown report:

```bash
node src/cli.js doctor --probe-url http://127.0.0.1:8787/v1 --format markdown
```

Generate the provider matrix:

```bash
node src/cli.js compat --target "local|http://127.0.0.1:8787/v1|openfusion/fusion"
node src/cli.js compat --target "local|http://127.0.0.1:8787/v1|openfusion/fusion" --timeout-ms 30000
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
- `CHANGELOG.md` includes user-visible CLI, API, provider compatibility, and migration notes.
- Examples do not contain real credentials.
- Roadmap does not claim unimplemented features as complete.

## GitHub

- CI is green on `main`.
- OpenSSF Scorecard workflow is enabled and publishing results.
- Issues and PR templates are present.
- Release notes mention compatibility changes and migration notes.
