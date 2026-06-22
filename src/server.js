import { createServer } from "node:http";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { MockChatClient } from "./mockClient.js";
import { OpenAICompatibleClient } from "./openaiClient.js";
import { planAuto, runAuto } from "./auto.js";
import { fusionBudget, runFusion, runFusionStream } from "./fusion.js";
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
        const requestedModel = body.model ?? "openfusion/auto";
        const sessionId = sessionIdFromRequest(body, request);
        if (isAutoModel(requestedModel)) {
          const auto = planAuto({ question, config, sessionId });
          return sendJson(response, 200, {
            object: "openfusion.route",
            requested_model: requestedModel,
            route: auto.route,
            budget: auto.budget,
            auto
          });
        }
        const route = routeQuestion(question, config);
        return sendJson(response, 200, {
          object: "openfusion.route",
          requested_model: requestedModel,
          route,
          budget: fusionBudget(route, config)
        });
      }

      if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
        const body = await readJson(request);
        validateChatRequest(body);
        const requestOptions = pickUpstreamOptions(body, request);
        const sessionId = requestOptions.session_id;

        if (hasToolFields(body)) {
          if (body.stream) {
            return sendPassthroughStream(response, {
              body,
              requestedModel: body.model ?? "openfusion/coder",
              mode: "tool-passthrough",
              upstreamModel: resolveUpstreamModel(body.model ?? "openfusion/coder", config, { toolPassthrough: true }),
              reason: "Tool calls bypass fusion so the client can continue the tool-call protocol with one upstream model.",
              client,
              requestOptions
            });
          }
          const payload = await runToolPassthrough({ body, config, client, requestOptions });

          return sendJson(response, 200, payload);
        }

        if (isExplicitRoleModel(body.model, config)) {
          if (body.stream) {
            return sendPassthroughStream(response, {
              body,
              requestedModel: body.model,
              mode: "role-passthrough",
              upstreamModel: resolveUpstreamModel(body.model, config),
              reason: "Explicit OpenFusion role models use one configured upstream model instead of the fusion panel.",
              client,
              requestOptions
            });
          }
          const payload = await runRolePassthrough({ body, config, client, requestOptions });

          return sendJson(response, 200, payload);
        }

        const requestedModel = body.model ?? "openfusion/auto";

        if (isAutoModel(requestedModel)) {
          const result = await runAuto({ messages: body.messages, config, client, sessionId, requestOptions });
          const payload = toOpenAIResponse(result, requestedModel);
          if (body.stream) {
            return sendSseCompletion(response, payload);
          }

          return sendJson(response, 200, payload);
        }

        if (body.stream) {
          const fusion = await runFusionStream({ messages: body.messages, config, client, requestOptions });
          return sendFusionStream(response, fusion, requestedModel);
        }

        const result = await runFusion({ messages: body.messages, config, client, requestOptions });
        const payload = toOpenAIResponse(result, requestedModel);

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
}

function hasToolFields(body) {
  return Boolean(
    body.tools
    || body.tool_choice
    || body.parallel_tool_calls
    || body.messages?.some((message) => message.role === "tool" || message.tool_calls)
  );
}

async function runToolPassthrough({ body, config, client, requestOptions = {} }) {
  const requestedModel = body.model ?? "openfusion/coder";
  const upstreamModel = resolveUpstreamModel(requestedModel, config, { toolPassthrough: true });
  const upstreamPayload = await client.completeChat({
    ...pickPassthroughBody(body),
    ...requestOptions,
    model: upstreamModel
  });

  return {
    ...normalizeChatCompletion(upstreamPayload, requestedModel),
    openfusion: {
      mode: "tool-passthrough",
      requested_model: requestedModel,
      upstream_model: upstreamModel,
      upstream: publicUpstreamOptions(requestOptions),
      reason: "Tool calls bypass fusion so the client can continue the tool-call protocol with one upstream model."
    }
  };
}

async function runRolePassthrough({ body, config, client, requestOptions = {} }) {
  const requestedModel = body.model;
  const upstreamModel = resolveUpstreamModel(requestedModel, config);
  const upstreamPayload = await client.completeChat({
    ...pickPassthroughBody(body),
    ...requestOptions,
    model: upstreamModel
  });

  return {
    ...normalizeChatCompletion(upstreamPayload, requestedModel),
    openfusion: {
      mode: "role-passthrough",
      requested_model: requestedModel,
      upstream_model: upstreamModel,
      upstream: publicUpstreamOptions(requestOptions),
      reason: "Explicit OpenFusion role models use one configured upstream model instead of the fusion panel."
    }
  };
}

function isExplicitRoleModel(requestedModel, config) {
  if (!requestedModel?.startsWith("openfusion/")) return false;
  const role = requestedModel.split("/")[1];
  return Boolean(config.roles[role]);
}

function isAutoModel(requestedModel) {
  return !requestedModel || requestedModel === "openfusion/auto";
}

function resolveUpstreamModel(requestedModel, config, { toolPassthrough = false } = {}) {
  if (requestedModel?.startsWith("openfusion/")) {
    const role = requestedModel.split("/")[1];
    if (config.roles[role]) {
      return config.roles[role].model;
    }

    return toolPassthrough
      ? config.roles[config.fusion.toolRole]?.model ?? config.roles[config.fusion.synthesizerRole].model
      : config.roles[config.fusion.synthesizerRole].model;
  }

  return requestedModel;
}

function pickPassthroughBody(body) {
  const allowed = [
    "messages",
    "temperature",
    "top_p",
    "max_tokens",
    "max_completion_tokens",
    "stop",
    "presence_penalty",
    "frequency_penalty",
    "seed",
    "response_format",
    "tools",
    "tool_choice",
    "parallel_tool_calls",
    "user",
    "metadata",
    "models",
    "provider",
    "plugins",
    "session_id"
  ];
  const picked = {};

  for (const key of allowed) {
    if (body[key] !== undefined) {
      picked[key] = body[key];
    }
  }

  return picked;
}

function pickUpstreamOptions(body, request) {
  const picked = {};
  for (const key of upstreamOptionKeys()) {
    if (body[key] !== undefined) {
      picked[key] = body[key];
    }
  }

  const headerSessionId = request.headers["x-session-id"];
  if (picked.session_id === undefined && typeof headerSessionId === "string" && headerSessionId.trim()) {
    picked.session_id = headerSessionId.trim();
  }

  return picked;
}

function upstreamOptionKeys() {
  return [
    "temperature",
    "top_p",
    "max_tokens",
    "max_completion_tokens",
    "stop",
    "presence_penalty",
    "frequency_penalty",
    "seed",
    "response_format",
    "user",
    "metadata",
    "models",
    "provider",
    "plugins",
    "session_id"
  ];
}

function sessionIdFromRequest(body, request) {
  const fromBody = typeof body.session_id === "string" && body.session_id.trim() ? body.session_id.trim() : null;
  const fromHeader = typeof request.headers["x-session-id"] === "string" && request.headers["x-session-id"].trim()
    ? request.headers["x-session-id"].trim()
    : null;
  return fromBody ?? fromHeader;
}

function normalizeChatCompletion(payload, requestedModel) {
  return {
    id: payload.id ?? `chatcmpl-openfusion-${Date.now()}`,
    object: payload.object ?? "chat.completion",
    created: payload.created ?? Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: payload.choices ?? [
      {
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: ""
        }
      }
    ],
    usage: payload.usage ?? {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  };
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
      ...(result.auto ? { mode: "auto", auto: result.auto } : { mode: "fusion" }),
      route: result.route,
      panel: result.panel.map(({ role, model }) => ({ role, model })),
      judge: { role: result.judge?.role ?? null, model: result.judge?.model ?? null },
      synthesizer: { role: result.final.role, model: result.final.model },
      trace: {
        id: result.trace?.id,
        auto: result.trace?.auto,
        budget: result.trace?.budget,
        phase_count: result.trace?.phases?.length ?? 0,
        phases: (result.trace?.phases ?? []).map(publicTracePhase)
      }
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

  const message = payload.choices[0].message;
  const delta = {
    role: message.role ?? "assistant",
    ...(message.content !== undefined && message.content !== null ? { content: message.content } : {}),
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {})
  };

  const chunk = {
    id: payload.id,
    object: "chat.completion.chunk",
    created: payload.created,
    model: payload.model,
    choices: [
      {
        index: 0,
        delta,
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

async function sendPassthroughStream(response, { body, requestedModel, upstreamModel, mode, reason, client, requestOptions = {} }) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });

  for await (const item of client.streamChat({
    ...pickPassthroughBody(body),
    ...requestOptions,
    model: upstreamModel
  })) {
    const chunk = structuredClone(item.chunk);
    chunk.model = requestedModel;
    chunk.openfusion = {
      mode,
      requested_model: requestedModel,
      upstream_model: upstreamModel,
      upstream: publicUpstreamOptions(requestOptions),
      reason
    };
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }

  response.write("data: [DONE]\n\n");
  response.end();
}

async function sendFusionStream(response, fusion, requestedModel) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });

  let finalState = null;

  for await (const item of fusion.stream()) {
    finalState = item.state;
    const chunk = structuredClone(item.chunk);
    chunk.model = requestedModel;
    chunk.openfusion = buildOpenFusionTrace(finalState);
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }

  const finalChunk = {
    id: `chatcmpl-openfusion-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop"
      }
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    },
    openfusion: finalState ? buildOpenFusionTrace(finalState) : undefined
  };

  response.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
  response.write("data: [DONE]\n\n");
  response.end();
}

function buildOpenFusionTrace(result) {
  return {
    ...(result.auto ? { mode: "auto", auto: result.auto } : { mode: "fusion" }),
    route: result.route,
    panel: result.panel.map(({ role, model }) => ({ role, model })),
    judge: { role: result.judge?.role ?? null, model: result.judge?.model ?? null },
    synthesizer: { role: result.final.role, model: result.final.model },
    trace: {
      id: result.trace?.id,
      auto: result.trace?.auto,
      budget: result.trace?.budget,
      phase_count: result.trace?.phases?.length ?? 0,
      phases: (result.trace?.phases ?? []).map(publicTracePhase)
    }
  };
}

function publicTracePhase(phase) {
  return {
    phase: phase.phase,
    role: phase.role,
    model: phase.model,
    candidate_id: phase.candidateId,
    candidate_model: phase.candidateModel,
    score: phase.score,
    latency_ms: phase.latencyMs,
    upstream_id: phase.upstreamId,
    upstream: phase.upstream,
    usage: phase.usage,
    attempts: phase.attempts
  };
}

function publicUpstreamOptions(options = {}) {
  const picked = {};
  for (const key of ["models", "provider", "plugins", "session_id"]) {
    if (options[key] !== undefined) picked[key] = options[key];
  }
  return Object.keys(picked).length > 0 ? picked : null;
}

function setCorsHeaders(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "authorization,content-type,x-requested-with,x-session-id");
}

function httpError(statusCode, type, message, code, param) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.type = type;
  error.code = code;
  error.param = param;
  return error;
}

if (isMain(import.meta.url, process.argv[1])) {
  await startServer({ dryRun: process.argv.includes("--dry-run") });
}

function isMain(moduleURL, argvPath) {
  if (!argvPath) return false;

  try {
    return realpathSync(fileURLToPath(moduleURL)) === realpathSync(argvPath);
  } catch {
    return fileURLToPath(moduleURL) === argvPath;
  }
}
