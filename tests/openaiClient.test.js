import test from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatibleClient } from "../src/openaiClient.js";

test("OpenAICompatibleClient passes OpenRouter routing fields through", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    return {
      ok: true,
      async json() {
        return {
          id: "chatcmpl-test",
          model: requests[0].body.model,
          choices: [
            {
              message: {
                role: "assistant",
                content: "ok"
              }
            }
          ]
        };
      }
    };
  };

  try {
    const client = new OpenAICompatibleClient({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: "test-key"
    });
    const response = await client.complete({
      model: "primary-model",
      models: ["fallback-a", "fallback-b"],
      provider: {
        sort: { by: "price", partition: "none" },
        preferred_min_throughput: { p90: 40 }
      },
      plugins: [{ id: "pareto-router", min_coding_score: 0.66 }],
      session_id: "client-session",
      messages: [{ role: "user", content: "hello" }]
    });

    assert.equal(response.content, "ok");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.model, "primary-model");
    assert.deepEqual(requests[0].body.models, ["fallback-a", "fallback-b"]);
    assert.deepEqual(requests[0].body.provider, {
      sort: { by: "price", partition: "none" },
      preferred_min_throughput: { p90: 40 }
    });
    assert.deepEqual(requests[0].body.plugins, [{ id: "pareto-router", min_coding_score: 0.66 }]);
    assert.equal(requests[0].body.session_id, "client-session");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
