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
