import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { MockChatClient } from "./mockClient.js";
import { OpenAICompatibleClient } from "./openaiClient.js";
import { runFusion } from "./fusion.js";
import { routeQuestion } from "./router.js";

export async function startServer({ configPath, dryRun = false, port = Number(process.env.PORT || 8787) } = {}) {
  const config = await loadConfig(configPath);
  const client = dryRun ? new MockChatClient() : new OpenAICompatibleClient({
    baseURL: config.upstream.baseURL,
    apiKey: process.env[config.upstream.apiKeyEnv],
    appName: config.upstream.appName,
    siteURL: config.upstream.siteURL,
    timeoutMs: config.fusion.timeoutMs
  });

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        return sendJson(response, 200, { ok: true, name: "openfusion" });
      }

      if (request.method === "GET" && request.url === "/v1/models") {
        return sendJson(response, 200, modelsResponse(config));
      }

      if (request.method === "POST" && request.url === "/debug/route") {
        const body = await readJson(request);
        const question = extractQuestion(body.messages);
        return sendJson(response, 200, {
          object: "openfusion.route",
          requested_model: body.model ?? "openfusion/auto",
          route: routeQuestion(question, config)
        });
      }

      if (request.method === "POST" && request.url === "/v1/chat/completions") {
        const body = await readJson(request);
        const question = extractQuestion(body.messages);
        const result = await runFusion({ question, config, client });
        return sendJson(response, 200, toOpenAIResponse(result, Boolean(body.stream)));
      }

      sendJson(response, 404, { error: { message: "Not found" } });
    } catch (error) {
      sendJson(response, 500, { error: { message: error.message } });
    }
  });

  await new Promise((resolve) => server.listen(port, resolve));
  console.log(`OpenFusion listening on http://localhost:${port}`);
  return server;
}

function modelsResponse(config) {
  const created = Math.floor(Date.now() / 1000);
  const virtualModels = ["openfusion/auto", "openfusion/fusion"];
  const roleModels = Object.keys(config.roles).map((role) => `openfusion/${role}`);

  return {
    object: "list",
    data: [...virtualModels, ...roleModels].map((id) => ({
      id,
      object: "model",
      created,
      owned_by: "openfusion"
    }))
  };
}

function extractQuestion(messages = []) {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUser) {
    throw new Error("OpenFusion requires at least one user message.");
  }

  if (typeof lastUser.content === "string") {
    return lastUser.content;
  }

  if (Array.isArray(lastUser.content)) {
    return lastUser.content
      .map((part) => part.text ?? "")
      .filter(Boolean)
      .join("\n");
  }

  throw new Error("Unsupported message content format.");
}

function toOpenAIResponse(result) {
  return {
    id: `chatcmpl-openfusion-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "openfusion/fusion",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: result.final.content
        }
      }
    ],
    openfusion: {
      route: result.route,
      panel: result.panel.map(({ role, model }) => ({ role, model })),
      judge: { role: result.judge.role, model: result.judge.model },
      synthesizer: { role: result.final.role, model: result.final.model }
    }
  };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        request.destroy(new Error("Request body too large."));
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error.message}`));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startServer({ dryRun: process.argv.includes("--dry-run") });
}
