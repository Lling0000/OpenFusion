export function panelPrompt({ role, roleConfig, question }) {
  return [
    {
      role: "system",
      content: [
        `You are the ${role} specialist in an OpenFusion multi-model panel.`,
        roleConfig.description,
        "Answer independently. Be concrete. Surface uncertainty and risks.",
        "Do not defer to other panelists because they cannot see your response yet."
      ].join("\n")
    },
    {
      role: "user",
      content: question
    }
  ];
}

export function judgePrompt({ question, panelResponses }) {
  return [
    {
      role: "system",
      content: [
        "You are the OpenFusion judge.",
        "Compare independent model responses, identify agreement, contradictions, missing evidence, and the safest synthesis plan.",
        "Return concise structured Markdown with: Agreement, Disagreements, Risks, Synthesis Plan."
      ].join("\n")
    },
    {
      role: "user",
      content: renderPanelContext(question, panelResponses)
    }
  ];
}

export function synthesisPrompt({ question, panelResponses, judgeResponse }) {
  return [
    {
      role: "system",
      content: [
        "You are the OpenFusion synthesizer.",
        "Use the panel and judge notes to produce the final answer.",
        "Prefer correctness and actionable specificity over averaging.",
        "If the panel disagrees, explain the chosen answer briefly."
      ].join("\n")
    },
    {
      role: "user",
      content: [
        renderPanelContext(question, panelResponses),
        "\n\n## Judge notes\n",
        judgeResponse.content
      ].join("")
    }
  ];
}

function renderPanelContext(question, panelResponses) {
  return [
    `## Original question\n${question}`,
    "## Panel responses",
    ...panelResponses.map((response) => [
      `### ${response.role} (${response.model})`,
      response.content
    ].join("\n"))
  ].join("\n\n");
}
