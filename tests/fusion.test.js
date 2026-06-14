import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/defaultConfig.js";
import { MockChatClient } from "../src/mockClient.js";
import { runFusion } from "../src/fusion.js";

test("runs a complete dry-run fusion pipeline", async () => {
  const result = await runFusion({
    question: "Review this Codex API relay design for bugs, risks, and README clarity",
    config: defaultConfig,
    client: new MockChatClient()
  });

  assert.equal(result.final.role, defaultConfig.fusion.synthesizerRole);
  assert.equal(result.judge.role, defaultConfig.fusion.judgeRole);
  assert.ok(result.panel.length >= 2);
  assert.ok(result.panel.some((item) => item.role === "coder"));
  assert.match(result.final.content, /OpenFusion/);
});
