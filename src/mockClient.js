export class MockChatClient {
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
