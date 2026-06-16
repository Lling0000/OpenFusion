export class MockChatClient {
  async completeChat(request) {
    const created = Math.floor(Date.now() / 1000);
    const message = mockChatMessage(request);

    return {
      id: `chatcmpl-openfusion-mock-${created}`,
      object: "chat.completion",
      created,
      model: request.model,
      choices: [
        {
          index: 0,
          finish_reason: message.tool_calls ? "tool_calls" : "stop",
          message
        }
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }
    };
  }

  async complete({ model, messages, metadata }) {
    const last = messages.at(-1)?.content ?? "";
    const role = metadata?.role ?? "model";

    if (metadata?.phase === "judge") {
      return {
        model,
        content: [
          "## Agreement",
          "The panel agrees the answer should combine specialist perspectives instead of relying on one model.",
          "## Disagreements",
          "Specialists emphasize different details, so the synthesis should keep the strongest concrete steps.",
          "## Risks",
          "Do not claim live upstream quality without running a real provider call.",
          "## Synthesis Plan",
          "Route by prompt signals, run the selected panel concurrently, judge conflicts, then synthesize."
        ].join("\n")
      };
    }

    if (metadata?.phase === "grading") {
      return {
        model,
        content: [
          "## Winner",
          "fusion",
          "## Score",
          "fusion 8/10, baseline 6/10.",
          "## Rationale",
          "Fusion combines specialist implementation, verification, and synthesis details into a more actionable answer.",
          "## Risks",
          "This is a dry-run grader response and does not represent a real-provider quality evaluation."
        ].join("\n")
      };
    }

    if (metadata?.phase === "synthesis") {
      return {
        model,
        content: [
          "OpenFusion would answer by selecting a role-specific panel, collecting independent responses, judging disagreements, and returning one synthesized response.",
          "",
          "For this prompt, the dry-run proves the orchestration path works without sending data to an upstream API."
        ].join("\n")
      };
    }

    return {
      model,
      content: `[${role}] ${mockSpecialistAnswer(role, last)}`
    };
  }
}

function mockChatMessage(request) {
  if (request.tools?.length && request.tool_choice) {
    const tool = chooseTool(request.tools, request.tool_choice);
    if (tool) {
      return {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_openfusion_mock",
            type: "function",
            function: {
              name: tool.function.name,
              arguments: JSON.stringify({ reason: "dry-run tool passthrough" })
            }
          }
        ]
      };
    }
  }

  return {
    role: "assistant",
    content: "OpenFusion mock passthrough response."
  };
}

function chooseTool(tools, toolChoice) {
  if (typeof toolChoice === "object" && toolChoice.function?.name) {
    return tools.find((tool) => tool.function?.name === toolChoice.function.name);
  }

  return tools.find((tool) => tool.type === "function");
}

function mockSpecialistAnswer(role, prompt) {
  const compactPrompt = prompt.replace(/\s+/g, " ").slice(0, 90);

  switch (role) {
    case "coder":
      return `Focus on implementation, tests, and failure modes for: "${compactPrompt}"`;
    case "reasoner":
      return `Break the problem into assumptions, tradeoffs, and a decision path for: "${compactPrompt}"`;
    case "verifier":
      return `Check edge cases, hidden risks, and validation evidence for: "${compactPrompt}"`;
    case "writer":
      return `Turn the strongest points into a clear final response for: "${compactPrompt}"`;
    default:
      return `Give a fast first-pass answer for: "${compactPrompt}"`;
  }
}
