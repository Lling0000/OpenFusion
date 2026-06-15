import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server.js";
import { defaultConfig } from "../src/defaultConfig.js";

test("serves OpenAI-compatible models and chat completions", async () => {
  const server = await startServer({ dryRun: true, port: 0 });
  const { port } = server.address();

  try {
    const models = await fetchJson(`http://127.0.0.1:${port}/v1/models`);
    assert.equal(models.object, "list");
    assert.ok(models.data.some((model) => model.id === "openfusion/fusion"));

    const route = await fetchJson(`http://127.0.0.1:${port}/debug/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openfusion/auto",
        messages: [{ role: "user", content: "Review this patch for test risks" }]
      })
    });
    assert.equal(route.object, "openfusion.route");
    assert.ok(route.route.selectedRoles.includes("verifier"));
    assert.equal(route.budget.withinBudget, true);
    assert.equal(route.budget.maxUpstreamCalls, defaultConfig.fusion.maxUpstreamCalls);

    const completion = await fetchJson(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openfusion/fusion",
        messages: [{ role: "user", content: "Debug this failing API test" }]
      })
    });
    assert.equal(completion.object, "chat.completion");
    assert.equal(completion.model, "openfusion/fusion");
    assert.equal(completion.choices[0].message.role, "assistant");
    assert.match(completion.choices[0].message.content, /OpenFusion/);
    assert.ok(completion.openfusion.panel.length >= 2);
    assert.match(completion.openfusion.trace.id, /^of_/);
    assert.equal(completion.openfusion.trace.budget.withinBudget, true);
    assert.equal(completion.openfusion.trace.phase_count, completion.openfusion.panel.length + 2);
    assert.equal(typeof completion.usage.total_tokens, "number");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("returns a budget error before fusion exceeds configured upstream calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openfusion-budget-"));
  const configPath = join(dir, "openfusion.config.json");
  const config = structuredClone(defaultConfig);
  config.fusion.maxUpstreamCalls = 3;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const server = await startServer({ configPath, dryRun: true, port: 0 });
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openfusion/fusion",
        messages: [{ role: "user", content: "Compare and review this API architecture for security risks and test gaps" }]
      })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error.code, "fusion_budget_exceeded");
    assert.equal(body.error.param, "fusion.maxUpstreamCalls");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("passes explicit role model chats through one upstream model", async () => {
  const server = await startServer({ dryRun: true, port: 0 });
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openfusion/coder",
        messages: [{ role: "user", content: "Debug this failing API test" }]
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.object, "chat.completion");
    assert.equal(body.model, "openfusion/coder");
    assert.equal(body.openfusion.mode, "role-passthrough");
    assert.equal(body.openfusion.upstream_model, defaultConfig.roles.coder.model);
    assert.equal(body.choices[0].message.content, "OpenFusion mock passthrough response.");
    assert.equal(body.openfusion.panel, undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("streams explicit role model passthrough responses as SSE chunks", async () => {
  const server = await startServer({ dryRun: true, port: 0 });
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openfusion/writer",
        stream: true,
        messages: [{ role: "user", content: "Rewrite this README section" }]
      })
    });

    assert.equal(response.ok, true);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const body = await response.text();
    assert.match(body, /role-passthrough/);
    assert.match(body, /openfusion\/writer/);
    assert.match(body, /data: \[DONE\]/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("returns SSE chunks for stream requests", async () => {
  const server = await startServer({ dryRun: true, port: 0 });
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openfusion/fusion",
        stream: true,
        messages: [{ role: "user", content: "Review this test failure" }]
      })
    });

    assert.equal(response.ok, true);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const body = await response.text();
    assert.match(body, /chat\.completion\.chunk/);
    assert.match(body, /data: \[DONE\]/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("passes tool calls through one upstream model instead of fusion", async () => {
  const server = await startServer({ dryRun: true, port: 0 });
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openfusion/fusion",
        tools: [{ type: "function", function: { name: "run_tests", parameters: {} } }],
        tool_choice: { type: "function", function: { name: "run_tests" } },
        messages: [{ role: "user", content: "Call a tool" }]
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.object, "chat.completion");
    assert.equal(body.openfusion.mode, "tool-passthrough");
    assert.equal(body.openfusion.requested_model, "openfusion/fusion");
    assert.equal(body.openfusion.upstream_model, defaultConfig.roles[defaultConfig.fusion.toolRole].model);
    assert.equal(body.choices[0].finish_reason, "tool_calls");
    assert.equal(body.choices[0].message.tool_calls[0].function.name, "run_tests");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("honors explicit role models for tool passthrough", async () => {
  const server = await startServer({ dryRun: true, port: 0 });
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openfusion/coder",
        tools: [{ type: "function", function: { name: "run_tests", parameters: {} } }],
        tool_choice: { type: "function", function: { name: "run_tests" } },
        messages: [{ role: "user", content: "Call a tool" }]
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.openfusion.upstream_model, defaultConfig.roles.coder.model);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("bypasses fusion for tool result follow-up messages", async () => {
  const server = await startServer({ dryRun: true, port: 0 });
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openfusion/fusion",
        messages: [
          { role: "user", content: "Inspect a file" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "inspect_file", arguments: "{}" }
              }
            ]
          },
          {
            role: "tool",
            tool_call_id: "call_1",
            content: "file contents"
          }
        ]
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.openfusion.mode, "tool-passthrough");
    assert.equal(body.choices[0].message.content, "OpenFusion mock passthrough response.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("streams tool passthrough responses as SSE chunks", async () => {
  const server = await startServer({ dryRun: true, port: 0 });
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openfusion/coder",
        stream: true,
        tools: [{ type: "function", function: { name: "inspect_file", parameters: {} } }],
        tool_choice: { type: "function", function: { name: "inspect_file" } },
        messages: [{ role: "user", content: "Inspect a file" }]
      })
    });

    assert.equal(response.ok, true);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const body = await response.text();
    assert.match(body, /tool-passthrough/);
    assert.match(body, /data: \[DONE\]/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("handles OPTIONS and query strings", async () => {
  const server = await startServer({ dryRun: true, port: 0 });
  const { port } = server.address();

  try {
    const options = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "OPTIONS"
    });
    assert.equal(options.status, 204);
    assert.equal(options.headers.get("access-control-allow-origin"), "*");

    const models = await fetchJson(`http://127.0.0.1:${port}/v1/models?foo=bar`);
    assert.equal(models.object, "list");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  assert.equal(response.ok, true);
  return response.json();
}
