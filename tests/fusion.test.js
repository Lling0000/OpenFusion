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
  assert.equal(result.trace.budget.estimatedUpstreamCalls, result.panel.length + 2);
  assert.equal(result.trace.budget.maxUpstreamCalls, defaultConfig.fusion.maxUpstreamCalls);
  assert.equal(result.trace.budget.withinBudget, true);
  assert.equal(result.trace.budget.cost.available, false);
  assert.equal(result.trace.phases.length, result.panel.length + 2);
  assert.ok(result.trace.phases.some((phase) => phase.phase === "judge" && phase.role === defaultConfig.fusion.judgeRole));
  assert.ok(result.trace.phases.every((phase) => typeof phase.latencyMs === "number"));
});

test("rejects routes that exceed the configured upstream call budget before calling models", async () => {
  const calls = [];
  const config = structuredClone(defaultConfig);
  config.fusion.maxUpstreamCalls = 3;

  await assert.rejects(
    () => runFusion({
      question: "Compare and review this API architecture for security risks and test gaps",
      config,
      client: {
        async complete(request) {
          calls.push(request);
          return { model: request.model, content: "should not be called" };
        }
      }
    }),
    (error) => {
      assert.equal(error.code, "fusion_budget_exceeded");
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /exceeds fusion\.maxUpstreamCalls=3/);
      return true;
    }
  );

  assert.equal(calls.length, 0);
});

test("estimates cost when all selected roles define pricing", async () => {
  const config = pricedConfig();
  const result = await runFusion({
    question: "Review this API patch for tests",
    config,
    client: new MockChatClient()
  });

  assert.equal(result.trace.budget.cost.available, true);
  assert.equal(result.trace.budget.cost.withinBudget, true);
  assert.ok(result.trace.budget.cost.estimatedUsd > 0);
  assert.equal(result.trace.budget.cost.items.length, result.trace.budget.estimatedUpstreamCalls);
});

test("rejects routes that exceed the configured estimated cost before calling models", async () => {
  const calls = [];
  const config = pricedConfig();
  config.fusion.costEstimate.maxUsd = 0.000001;

  await assert.rejects(
    () => runFusion({
      question: "Review this API patch for tests",
      config,
      client: {
        async complete(request) {
          calls.push(request);
          return { model: request.model, content: "should not be called" };
        }
      }
    }),
    (error) => {
      assert.equal(error.code, "fusion_budget_exceeded");
      assert.equal(error.param, "fusion.costEstimate.maxUsd");
      assert.match(error.message, /estimated cost/);
      return true;
    }
  );

  assert.equal(calls.length, 0);
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

function pricedConfig() {
  const config = structuredClone(defaultConfig);
  for (const role of Object.keys(config.roles)) {
    config.roles[role].pricing = {
      inputUsdPer1M: 1,
      outputUsdPer1M: 2
    };
  }
  config.fusion.costEstimate = {
    inputTokensPerCall: 1000,
    outputTokensPerCall: 500,
    maxUsd: 1
  };
  return config;
}
