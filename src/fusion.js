import { routeQuestion } from "./router.js";
import { panelPrompt, judgePrompt, synthesisPrompt } from "./prompts.js";

export async function runFusion({ question, messages, config, client }) {
  const normalizedQuestion = question ?? transcriptFromMessages(messages);
  const route = routeQuestion(normalizedQuestion, config);
  const budget = fusionBudget(route, config);
  enforceFusionBudget(budget);
  const trace = {
    id: createTraceId(),
    startedAt: new Date().toISOString(),
    budget,
    phases: []
  };

  const panelResults = await Promise.all(route.selectedRoles.map(async (role) => {
    const roleConfig = config.roles[role];
    const { response, phase } = await timedComplete(client, {
      phase: "panel",
      role,
      model: roleConfig.model,
      messages: panelPrompt({ role, roleConfig, question: normalizedQuestion }),
      metadata: { phase: "panel", role }
    });

    return {
      response: {
        role,
        model: response.model,
        content: response.content
      },
      phase
    };
  }));
  const panelResponses = panelResults.map((result) => result.response);
  trace.phases.push(...panelResults.map((result) => result.phase));

  const judgeRole = config.fusion.judgeRole;
  const judgeConfig = config.roles[judgeRole];
  const { response: judgeResponse, phase: judgePhase } = await timedComplete(client, {
    phase: "judge",
    role: judgeRole,
    model: judgeConfig.model,
    messages: judgePrompt({ question: normalizedQuestion, panelResponses }),
    metadata: { phase: "judge", role: judgeRole }
  });
  trace.phases.push(judgePhase);

  const synthesizerRole = config.fusion.synthesizerRole;
  const synthesizerConfig = config.roles[synthesizerRole];
  const { response: finalResponse, phase: synthesisPhase } = await timedComplete(client, {
    phase: "synthesis",
    role: synthesizerRole,
    model: synthesizerConfig.model,
    messages: synthesisPrompt({ question: normalizedQuestion, panelResponses, judgeResponse }),
    metadata: { phase: "synthesis", role: synthesizerRole }
  });
  trace.phases.push(synthesisPhase);
  trace.completedAt = new Date().toISOString();
  trace.latencyMs = trace.phases.reduce((total, phase) => total + phase.latencyMs, 0);

  return {
    question: normalizedQuestion,
    route,
    panel: panelResponses,
    judge: {
      role: judgeRole,
      model: judgeResponse.model,
      content: judgeResponse.content
    },
    final: {
      role: synthesizerRole,
      model: finalResponse.model,
      content: finalResponse.content
    },
    trace
  };
}

export function fusionBudget(route, config) {
  const estimatedUpstreamCalls = route.selectedRoles.length + 2;
  const maxUpstreamCalls = config.fusion.maxUpstreamCalls ?? Infinity;

  return {
    estimatedUpstreamCalls,
    maxUpstreamCalls,
    withinBudget: estimatedUpstreamCalls <= maxUpstreamCalls
  };
}

export function transcriptFromMessages(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("OpenFusion requires a non-empty messages array.");
  }

  const parts = messages.map((message, index) => {
    const role = message.role ?? `message_${index}`;
    return `### ${role}\n${contentToText(message.content)}`;
  });

  return parts.join("\n\n");
}

function enforceFusionBudget(budget) {
  if (budget.withinBudget) return;

  const error = new Error(`Fusion route needs ${budget.estimatedUpstreamCalls} upstream calls, which exceeds fusion.maxUpstreamCalls=${budget.maxUpstreamCalls}.`);
  error.name = "OpenFusionBudgetError";
  error.statusCode = 400;
  error.type = "invalid_request_error";
  error.code = "fusion_budget_exceeded";
  error.param = "fusion.maxUpstreamCalls";
  throw error;
}

function contentToText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((part) => {
      if (part.type === "text" && typeof part.text === "string") return part.text;
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      return `[unsupported content part: ${part.type ?? "unknown"}]`;
    }).join("\n");
  }

  if (content == null) {
    return "";
  }

  return JSON.stringify(content);
}

async function timedComplete(client, request) {
  const startedAt = new Date();
  const startedMs = Date.now();
  const response = await client.complete(request);
  const completedAt = new Date();

  return {
    response,
    phase: {
      phase: request.phase,
      role: request.role,
      model: response.model ?? request.model,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      latencyMs: Date.now() - startedMs,
      upstreamId: response.raw?.id ?? null,
      usage: response.raw?.usage ?? null
    }
  };
}

function createTraceId() {
  return `of_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
