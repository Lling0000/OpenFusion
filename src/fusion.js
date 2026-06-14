import { routeQuestion } from "./router.js";
import { panelPrompt, judgePrompt, synthesisPrompt } from "./prompts.js";

export async function runFusion({ question, config, client }) {
  const route = routeQuestion(question, config);

  const panelResponses = await Promise.all(route.selectedRoles.map(async (role) => {
    const roleConfig = config.roles[role];
    const response = await client.complete({
      model: roleConfig.model,
      messages: panelPrompt({ role, roleConfig, question }),
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
    messages: judgePrompt({ question, panelResponses }),
    metadata: { phase: "judge", role: judgeRole }
  });

  const synthesizerRole = config.fusion.synthesizerRole;
  const synthesizerConfig = config.roles[synthesizerRole];
  const finalResponse = await client.complete({
    model: synthesizerConfig.model,
    messages: synthesisPrompt({ question, panelResponses, judgeResponse }),
    metadata: { phase: "synthesis", role: synthesizerRole }
  });

  return {
    question,
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
