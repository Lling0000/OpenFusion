import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { MockChatClient } from "./mockClient.js";
import { OpenAICompatibleClient } from "./openaiClient.js";
import { runFusion } from "./fusion.js";
import { routeQuestion } from "./router.js";
import { listModels } from "./models.js";

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
      const url = new URL(request.url, "http://localhost");
      setCorsHeaders(response);

      if (request.method === "OPTIONS") {
        response.writeHead(204);
        return response.end();
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, { ok: true, name: "openfusion" });
      }

      if (request.method === "GET" && url.pathname === "/v1/models") {
        return sendJson(response, 200, modelsResponse(config));
      }

      if (request.method === "POST" && url.pathname === "/debug/route") {
        const body = await readJson(request);
        validateChatRequest(body);
        const question = transcriptFromChatBody(body);
        return sendJson(response, 200, {
          object: "openfusion.route",
          requested_model: body.model ?? "openfusion/auto",
          route: routeQuestion(question, config)
        });
      }

      if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
        const body = await readJson(request);
        validateChatRequest(body);
        const result = await runFusion({ messages: body.messages, config, client });
        const payload = toOpenAIResponse(result, body.model ?? "openfusion/fusion");

        if (body.stream) {
          return sendSseCompletion(response, payload);
        }

        return sendJson(response, 200, payload);
      }

      sendError(response, 404, "not_found", "Not found.", "not_found");
    } catch (error) {
      sendError(
        response,
        error.statusCode ?? 500,
        error.type ?? "server_error",
        error.message,
        error.code ?? "openfusion_error",
        error.param
      );
    }
  });

  await new Promise((resolve) => server.listen(port, resolve));
  console.log(`OpenFusion listening on http://localhost:${port}`);
  return server;
}

function modelsResponse(config) {
  const created = Math.floor(Date.now() / 1000);

  return {
    object: "list",
    data: listModels(config).map((model) => ({
      id: model.id,
      object: "model",
      created,
      owned_by: "openfusion",
      openfusion: model
    }))
  };
}

function validateChatRequest(body) {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw httpError(400, "invalid_request_error", "Expected a non-empty messages array.", "invalid_messages", "messages");
  }

  if (body.tools || body.tool_choice || body.parallel_tool_calls) {
    throw httpError(501, "unsupported_feature", "Tool calls are not supported yet. Remove tools/tool_choice or follow the roadmap issue for passthrough support.", "tool_calls_unsupported", "tools");
  }
}

function transcriptFromChatBody(body) {
  return body.messages.map((message, index) => {
    const role = message.role ?? `message_${index}`;
    return `### ${role}\n${contentToText(message.content)}`;
  }).join("\n\n");
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (part.type === "text" && typeof part.text === "string") return part.text;
      if (typeof part.text === "string") return part.text;
      return `[unsupported content part: ${part.type ?? "unknown"}]`;
    }).join("\n");
  }
  if (content == null) return "";
  return JSON.stringify(content);
}

function toOpenAIResponse(result, requestedModel) {
  return {
    id: `chatcmpl-openfusion-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
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
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    },
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
        reject(httpError(400, "invalid_request_error", `Invalid JSON: ${error.message}`, "invalid_json"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload, null, 2));
}

function sendError(response, statusCode, type, message, code, param) {
  sendJson(response, statusCode, {
    error: {
      message,
      type,
      param: param ?? null,
      code
    }
  });
}

function sendSseCompletion(response, payload) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });

  const chunk = {
    id: payload.id,
    object: "chat.completion.chunk",
    created: payload.created,
    model: payload.model,
    choices: [
      {
        index: 0,
        delta: {
          role: "assistant",
          content: payload.choices[0].message.content
        },
        finish_reason: null
      }
    ],
    openfusion: payload.openfusion
  };

  const finalChunk = {
    id: payload.id,
    object: "chat.completion.chunk",
    created: payload.created,
    model: payload.model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop"
      }
    ],
    usage: payload.usage
  };

  response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  response.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
  response.write("data: [DONE]\n\n");
  response.end();
}

function setCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "authorization,content-type,x-requested-with");
}

function httpError(statusCode, type, message, code, param) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.type = type;
  error.code = code;
  error.param = param;
  return error;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startServer({ dryRun: process.argv.includes("--dry-run") });
}
