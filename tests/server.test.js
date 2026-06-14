import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../src/server.js";

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

    const completion = await fetchJson(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openfusion/fusion",
        messages: [{ role: "user", content: "Debug this failing API test" }]
      })
    });
    assert.equal(completion.object, "chat.completion");
    assert.equal(completion.choices[0].message.role, "assistant");
    assert.match(completion.choices[0].message.content, /OpenFusion/);
    assert.ok(completion.openfusion.panel.length >= 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  assert.equal(response.ok, true);
  return response.json();
}
