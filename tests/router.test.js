import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/defaultConfig.js";
import { routeQuestion } from "../src/router.js";

test("routes coding questions to coder plus verification panel", () => {
  const route = routeQuestion("Debug this Node API test failure and propose a patch", defaultConfig);

  assert.ok(route.selectedRoles.includes("coder"));
  assert.ok(route.selectedRoles.includes("verifier"));
  assert.ok(route.selectedRoles.length >= defaultConfig.fusion.minPanel);
});

test("routes architecture tradeoff questions to reasoner", () => {
  const route = routeQuestion("Compare two architectures and explain the tradeoffs", defaultConfig);

  assert.ok(route.selectedRoles.includes("reasoner"));
});

test("applies custom routing rules from config", () => {
  const config = structuredClone(defaultConfig);
  config.routing.rules = [
    {
      role: "writer",
      keywords: ["changelog"],
      score: 5,
      reason: "release-note signal"
    }
  ];

  const route = routeQuestion("Draft a changelog for this API relay release", config);

  assert.equal(route.selectedRoles[0], "writer");
  assert.equal(route.scores.writer, 5);
  assert.match(route.rationale, /release-note signal/);
});

test("ignores custom rules for unknown roles and invalid regex patterns", () => {
  const config = structuredClone(defaultConfig);
  config.routing.rules = [
    { role: "missing", keywords: ["force"], score: 10 },
    { role: "reasoner", patterns: ["["], score: 10 }
  ];

  const route = routeQuestion("force this custom route", config);

  assert.equal(route.scores.missing, undefined);
  assert.equal(route.scores.reasoner, 0);
  assert.ok(route.selectedRoles.includes("fast"));
});
