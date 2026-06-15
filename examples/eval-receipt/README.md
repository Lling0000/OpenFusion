# Eval Receipt Example

OpenFusion receipts are lightweight evidence artifacts for routing and orchestration. They do not claim answer quality; they prove which roles were selected, which phases ran, and provide hashes/excerpts for panel, judge, and synthesis outputs.

## Built-In Eval Suite

```bash
openfusion eval --dry-run
openfusion eval --dry-run --json
```

The built-in suite checks prompts for coding review, architecture tradeoffs, and documentation polish. Each case records:

- Expected roles.
- Selected roles.
- Panel, judge, and synthesizer models.
- Trace id and phase count.
- Content hashes and short excerpts for auditability.

It also reports routing diversity across the built-in prompts:

- Unique panel count.
- Covered roles.
- Whether different prompts selected distinct role/model panels.
- A per-case panel signature table.

## Single Prompt Receipt

```bash
openfusion receipt --dry-run "Review this Codex relay patch for security risks and missing tests"
```

Expected shape:

```json
{
  "object": "openfusion.fusion_receipt",
  "schema": "openfusion.fusion_receipt.v1",
  "mode": "dry-run",
  "route": {
    "selectedRoles": ["coder", "verifier", "fast"]
  },
  "verdict": {
    "hasMultiplePanelRoles": true,
    "hasJudgeNotes": true,
    "hasSynthesis": true,
    "hasPhaseTrace": true
  }
}
```

## What Receipts Are Good For

- CI artifacts that prove routing behavior did not regress.
- Issue attachments when comparing relay/provider behavior.
- Local debugging when a prompt routes to an unexpected role panel.

## What Receipts Do Not Prove

- They do not prove that a fused answer is better than a single model.
- They do not replace task-specific evals, human review, or real provider testing.
- Dry-run receipts use a mock client and do not measure upstream model quality.
