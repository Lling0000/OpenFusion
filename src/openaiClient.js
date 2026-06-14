export class OpenAICompatibleClient {
  constructor({ baseURL, apiKey, appName, siteURL, timeoutMs = 90000 }) {
    this.baseURL = baseURL.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.appName = appName;
    this.siteURL = siteURL;
    this.timeoutMs = timeoutMs;
  }

  async complete({ model, messages, temperature = 0.2, ...options }) {
    const payload = await this.completeChat({
      model,
      messages,
      temperature,
      ...options
    });

    return {
      model: payload.model ?? model,
      content: payload.choices?.[0]?.message?.content ?? "",
      raw: payload
    };
  }

  async completeChat(request) {
    if (!this.apiKey) {
      throw new Error("Missing upstream API key. Set the configured apiKeyEnv or use --dry-run.");
    }

    const { model, messages, ...options } = request;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          ...(this.siteURL ? { "HTTP-Referer": this.siteURL } : {}),
          ...(this.appName ? { "X-Title": this.appName } : {})
        },
        body: JSON.stringify({
          model,
          messages,
          ...pickChatOptions(options)
        })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Upstream ${response.status}: ${body.slice(0, 500)}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

function pickChatOptions(options) {
  const allowed = [
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
    "metadata"
  ];
  const picked = {};

  for (const key of allowed) {
    if (options[key] !== undefined) {
      picked[key] = options[key];
    }
  }

  return picked;
}
