# Tool Passthrough Example

Codex and other coding agents depend on a strict tool-call protocol:

1. The assistant emits a `tool_calls` message.
2. The client executes the tool.
3. The client sends a follow-up `role: "tool"` message.
4. The assistant continues from the same tool-call thread.

OpenFusion preserves that protocol by bypassing multi-model fusion whenever a request includes `tools`, `tool_choice`, `parallel_tool_calls`, a `role: "tool"` message, or assistant `tool_calls`.

## 1. Start OpenFusion

```bash
openfusion serve --dry-run --port 8787
```

## 2. Force A Tool Call

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d @examples/tool-passthrough/tool-request.json
```

Expected trace:

```json
{
  "openfusion": {
    "mode": "tool-passthrough",
    "reason": "Tool calls bypass fusion so the client can continue the tool-call protocol with one upstream model."
  }
}
```

## 3. Send The Tool Result Follow-Up

Use the returned `tool_call_id` in the follow-up request:

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d @examples/tool-passthrough/tool-follow-up.json
```

This request also stays in passthrough mode because it contains `role: "tool"`.

## Notes

- `model: "openfusion/coder"` sends normal chat and tool turns to the configured `coder` model.
- `model: "openfusion/fusion"` uses the full fusion pipeline for normal chat and `fusion.toolRole` for tool turns.
- Multi-model tool orchestration is intentionally not enabled yet; it is a roadmap item after passthrough compatibility is stable.
