export const defaultConfig = {
  upstream: {
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    appName: "OpenFusion",
    siteURL: "https://github.com/Lling0000/OpenFusion"
  },
  roles: {
    fast: {
      model: "openai/gpt-4.1-mini",
      description: "Fast general-purpose model for first-pass answers."
    },
    reasoner: {
      model: "anthropic/claude-3.7-sonnet",
      description: "Careful reasoning model for planning and tradeoffs."
    },
    coder: {
      model: "deepseek/deepseek-chat-v3-0324",
      description: "Code-focused model for implementation and debugging."
    },
    verifier: {
      model: "google/gemini-2.5-pro",
      description: "Verifier model for edge cases, tests, and risk checks."
    },
    writer: {
      model: "openai/gpt-4.1",
      description: "Polish model for concise final synthesis."
    }
  },
  fusion: {
    minPanel: 2,
    maxPanel: 4,
    judgeRole: "verifier",
    synthesizerRole: "writer",
    toolRole: "writer",
    timeoutMs: 90000
  }
};
