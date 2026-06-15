# Quickstart Example

This example proves the local fusion pipeline without sending prompts upstream.

## 1. Preview Routing Without Model Calls

```bash
openfusion route --json "Review this patch for security risks and missing tests"
```

Expected shape:

```json
{
  "object": "openfusion.route_preview",
  "route": {
    "selectedRoles": ["coder", "fast", "verifier"]
  },
  "budget": {
    "estimatedUpstreamCalls": 5,
    "withinBudget": true
  }
}
```

## 2. Run A Dry-Run Fusion Call

```bash
openfusion --dry-run --json "Review this patch for security risks and missing tests"
```

Expected shape:

```json
{
  "route": {
    "selectedRoles": ["coder", "fast", "verifier"]
  },
  "panel": [
    { "role": "coder" },
    { "role": "fast" },
    { "role": "verifier" }
  ],
  "judge": { "role": "verifier" },
  "final": { "role": "writer" }
}
```

The exact role order can vary as routing improves, but a coding/review prompt should include more than one specialist.

## 3. Start The Local Server

```bash
openfusion serve --dry-run --port 8787
```

## 4. Call The OpenAI-Compatible Endpoint

In another terminal:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d @examples/quickstart/chat-request.json
```

The response is a normal chat completion plus an extra `openfusion` trace with the route, panel, judge, and synthesizer metadata.

## 5. Inspect Routing Over HTTP

```bash
curl http://127.0.0.1:8787/debug/route \
  -H "Content-Type: application/json" \
  -d @examples/quickstart/route-request.json
```

## 6. Probe Compatibility

```bash
openfusion doctor --probe-url http://127.0.0.1:8787/v1 --probe-model openfusion/fusion
```

The probe covers models, chat, streaming, and tool-call round-trip behavior.
