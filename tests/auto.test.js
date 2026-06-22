import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/defaultConfig.js";
import { createAutoSessionStore, planAuto, runAuto } from "../src/auto.js";

test("auto plans simple prompts as one fast model", () => {
  const plan = planAuto({
    question: "Say hello.",
    config: defaultConfig
  });

  assert.equal(plan.mode, "fast-single");
  assert.equal(plan.profile, "fast");
  assert.equal(plan.phases.length, 1);
  assert.equal(plan.phases[0].role, "fast");
  assert.equal(plan.budget.estimatedUpstreamCalls, 1);
  assert.equal(plan.budget.cost.available, true);
  assert.ok(plan.candidates.length >= Object.keys(defaultConfig.roles).length);
  assert.ok(plan.selected.some((candidate) => candidate.role === "fast"));
  assert.equal(plan.candidates[0].status.eligible, true);
  assert.equal(typeof plan.candidates[0].metrics.benchmark_percentile, "number");
  assert.equal(typeof plan.candidates[0].metrics.price_usd_per_1m, "number");
  assert.equal(typeof plan.candidates[0].metrics.throughput.p50, "number");
  assert.equal(typeof plan.candidates[0].metrics.latency.p90, "number");
  assert.equal(typeof plan.candidates[0].score_breakdown.weights.price, "number");
});

test("auto adds a verifier for important but not complex prompts", () => {
  const plan = planAuto({
    question: "Security risk review.",
    config: defaultConfig
  });

  assert.equal(plan.mode, "single-verify");
  assert.equal(plan.phases.length, 3);
  assert.deepEqual(plan.phases.map((phase) => phase.phase), ["primary", "judge", "synthesis"]);
  assert.ok(plan.selected.some((candidate) => candidate.role === "verifier"));
  assert.equal(plan.budget.estimatedUpstreamCalls, 3);
});

test("auto uses full fusion for complex high-risk prompts", () => {
  const plan = planAuto({
    question: "Compare two production API architectures for a critical auth migration, security risks, rollback, data loss, tests, and tradeoffs.",
    config: defaultConfig
  });

  assert.equal(plan.mode, "fusion-panel");
  assert.ok(plan.phases.filter((phase) => phase.phase === "panel").length >= 2);
  assert.ok(plan.phases.some((phase) => phase.phase === "judge"));
  assert.ok(plan.phases.some((phase) => phase.phase === "synthesis"));
  assert.ok(plan.budget.estimatedUpstreamCalls >= 4);
});

test("runAuto simple execution calls one upstream model and records trace", async () => {
  const client = new RecordingClient();
  const result = await runAuto({
    question: "Say hello.",
    config: defaultConfig,
    client
  });

  assert.equal(result.auto.mode, "fast-single");
  assert.equal(client.calls.length, 1);
  assert.equal(result.trace.phases.length, 1);
  assert.equal(result.trace.auto.mode, "fast-single");
  assert.equal(result.final.model, defaultConfig.roles.fast.model);
  assert.equal(client.calls[0].session_id, result.trace.auto.session.id);
  assert.deepEqual(client.calls[0].provider, defaultConfig.auto.candidates[0].upstream.provider);
  assert.ok(Array.isArray(client.calls[0].models));
  assert.equal(result.trace.phases[0].upstream.session_id, result.trace.auto.session.id);
  assert.ok(Array.isArray(result.trace.phases[0].upstream.models));
});

test("runAuto falls back to another candidate when the first model fails", async () => {
  const config = structuredClone(defaultConfig);
  config.auto.candidates = [
    {
      id: "bad-fast",
      role: "fast",
      model: "bad-fast-model",
      skills: { general: 0.9 },
      quality: 0.9,
      latency: 0.9,
      cost: 0.9,
      reliability: 0.9
    },
    {
      id: "good-fast",
      role: "fast",
      model: "good-fast-model",
      skills: { general: 0.8 },
      quality: 0.8,
      latency: 0.8,
      cost: 0.8,
      reliability: 0.8
    }
  ];
  const client = new RecordingClient({ failModels: ["bad-fast-model"] });
  const result = await runAuto({
    question: "Say hello.",
    config,
    client
  });

  assert.equal(result.final.model, "good-fast-model");
  assert.equal(client.calls.length, 2);
  assert.deepEqual(result.trace.phases[0].attempts.map((attempt) => attempt.status), ["error", "success"]);
  assert.equal(result.trace.phases[0].attempts[0].model, "bad-fast-model");
  assert.equal(result.trace.phases[0].attempts[1].model, "good-fast-model");
  assert.deepEqual(client.calls[0].models, ["good-fast-model"]);
});

test("auto applies hard availability filters before fallback ranking", () => {
  const config = structuredClone(defaultConfig);
  config.auto.candidates = [
    {
      id: "down-fast",
      role: "fast",
      model: "down-fast-model",
      skills: { general: 1 },
      benchmarks: { general: 100 },
      pricing: { inputUsdPer1M: 0.01, outputUsdPer1M: 0.01 },
      performance: { throughput: { p50: 200 }, latency: { p50: 0.2 } },
      availability: false
    },
    {
      id: "up-fast",
      role: "fast",
      model: "up-fast-model",
      skills: { general: 0.7 },
      benchmarks: { general: 70 },
      pricing: { inputUsdPer1M: 1, outputUsdPer1M: 2 },
      performance: { throughput: { p50: 70 }, latency: { p50: 1 } },
      availability: 0.8
    }
  ];

  const plan = planAuto({
    question: "Say hello.",
    config
  });

  assert.equal(plan.selected[0].model, "up-fast-model");
  assert.equal(plan.candidates.find((candidate) => candidate.model === "down-fast-model").status.eligible, false);
  assert.deepEqual(
    plan.candidates.find((candidate) => candidate.model === "down-fast-model").status.hardRejects,
    ["unavailable", "availability_below_floor"]
  );
});

test("auto keeps a successful model sticky within a session", async () => {
  const config = structuredClone(defaultConfig);
  config.auto.candidates = [
    {
      id: "sticky-fast-a",
      role: "fast",
      model: "sticky-fast-a",
      skills: { general: 0.9 },
      benchmarks: { general: 90 },
      pricing: { inputUsdPer1M: 1, outputUsdPer1M: 1 },
      performance: { throughput: { p50: 80 }, latency: { p50: 1 } },
      availability: 0.9
    },
    {
      id: "sticky-fast-b",
      role: "fast",
      model: "sticky-fast-b",
      skills: { general: 0.82 },
      benchmarks: { general: 82 },
      pricing: { inputUsdPer1M: 1, outputUsdPer1M: 1 },
      performance: { throughput: { p50: 80 }, latency: { p50: 1 } },
      availability: 0.9
    }
  ];
  const sessionStore = createAutoSessionStore();
  const client = new RecordingClient();

  const first = await runAuto({
    question: "Say hello.",
    config,
    client,
    sessionId: "sticky-session",
    sessionStore
  });
  assert.equal(first.final.model, "sticky-fast-a");

  config.auto.candidates[0].skills.general = 0.78;
  config.auto.candidates[0].benchmarks.general = 78;
  config.auto.candidates[1].skills.general = 0.86;
  config.auto.candidates[1].benchmarks.general = 86;

  const second = await runAuto({
    question: "Say hello.",
    config,
    client,
    sessionId: "sticky-session",
    sessionStore
  });

  assert.equal(second.trace.auto.session.hit, true);
  assert.equal(second.trace.auto.selected[0].model, "sticky-fast-a");
  assert.equal(second.trace.auto.selected[0].sticky.pinned, true);
  assert.equal(second.final.model, "sticky-fast-a");
});

class RecordingClient {
  constructor({ failModels = [] } = {}) {
    this.failModels = new Set(failModels);
    this.calls = [];
  }

  async complete(request) {
    this.calls.push(request);
    if (this.failModels.has(request.model)) {
      throw new Error(`planned failure for ${request.model}`);
    }

    return {
      model: request.model,
      content: `[${request.metadata?.role}] response from ${request.model}`,
      raw: {
        id: `chatcmpl-${request.model}`,
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      }
    };
  }
}
