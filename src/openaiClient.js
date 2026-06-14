export class OpenAICompatibleClient {
  constructor({ baseURL, apiKey, appName, siteURL, timeoutMs = 90000 }) {
    this.baseURL = baseURL.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.appName = appName;
    this.siteURL = siteURL;
    this.timeoutMs = timeoutMs;
  }

  async complete({ model, messages, temperature = 0.2 }) {
    if (!this.apiKey) {
      throw new Error("Missing upstream API key. Set the configured apiKeyEnv or use --dry-run.");
    }

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
          temperature
        })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Upstream ${response.status}: ${body.slice(0, 500)}`);
      }

      const payload = await response.json();
      return {
        model: payload.model ?? model,
        content: payload.choices?.[0]?.message?.content ?? "",
        raw: payload
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
