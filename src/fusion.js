import { routeQuestion } from "./router.js";
import { panelPrompt, judgePrompt, synthesisPrompt } from "./prompts.js";

export async function runFusion({ question, messages, config, client }) {
  const normalizedQuestion = question ?? transcriptFromMessages(messages);
  const route = routeQuestion(normalizedQuestion, config);

  const panelResponses = await Promise.all(route.selectedRoles.map(async (role) => {
    const roleConfig = config.roles[role];
    const response = await client.complete({
      model: roleConfig.model,
      messages: panelPrompt({ role, roleConfig, question: normalizedQuestion }),
      metadata: { phase: "panel", role }
    });

    return {
      role,
      model: response.model,
      content: response.content
    };
  }));

  const judgeRole = config.fusion.judgeRole;
  const judgeConfig = config.roles[judgeRole];
  const judgeResponse = await client.complete({
    model: judgeConfig.model,
    messages: judgePrompt({ question: normalizedQuestion, panelResponses }),
    metadata: { phase: "judge", role: judgeRole }
  });

  const synthesizerRole = config.fusion.synthesizerRole;
  const synthesizerConfig = config.roles[synthesizerRole];
  const finalResponse = await client.complete({
    model: synthesizerConfig.model,
    messages: synthesisPrompt({ question: normalizedQuestion, panelResponses, judgeResponse }),
    metadata: { phase: "synthesis", role: synthesizerRole }
  });

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
    }
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
