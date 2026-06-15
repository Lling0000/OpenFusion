import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/defaultConfig.js";
import { MockChatClient } from "../src/mockClient.js";
import { runFusion, transcriptFromMessages } from "../src/fusion.js";

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
  assert.match(result.trace.id, /^of_/);
  assert.equal(result.trace.phases.length, result.panel.length + 2);
  assert.ok(result.trace.phases.some((phase) => phase.phase === "judge" && phase.role === defaultConfig.fusion.judgeRole));
  assert.ok(result.trace.phases.every((phase) => typeof phase.latencyMs === "number"));
});

test("preserves multi-message transcript for routing and panel prompts", async () => {
  const transcript = transcriptFromMessages([
    { role: "system", content: "Always preserve project constraints." },
    { role: "assistant", content: "Earlier answer context." },
    { role: "user", content: "Now debug this failing test." }
  ]);

  assert.match(transcript, /### system/);
  assert.match(transcript, /project constraints/);
  assert.match(transcript, /### assistant/);
  assert.match(transcript, /### user/);

  const result = await runFusion({
    messages: [
      { role: "system", content: "Always preserve project constraints." },
      { role: "assistant", content: "Earlier answer context." },
      { role: "user", content: "Now debug this failing test." }
    ],
    config: defaultConfig,
    client: new MockChatClient()
  });

  assert.match(result.question, /project constraints/);
  assert.match(result.question, /Earlier answer context/);
  assert.match(result.question, /Now debug this failing test/);
});
