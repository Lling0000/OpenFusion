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

  async *streamChat(request) {
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
          stream: true,
          ...pickChatOptions(options)
        })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Upstream ${response.status}: ${body.slice(0, 500)}`);
      }

      if (!response.body) {
        throw new Error("Upstream did not return a readable stream.");
      }

      let aggregate = null;
      for await (const chunk of parseSse(response.body)) {
        aggregate = mergeChunk(aggregate, chunk, model);
        yield { chunk, aggregate };
      }
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
    "metadata",
    "models",
    "provider",
    "plugins",
    "session_id"
  ];
  const picked = {};

  for (const key of allowed) {
    if (options[key] !== undefined) {
      picked[key] = options[key];
    }
  }

  return picked;
}

async function *parseSse(body) {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });

    while (buffer.includes("\n\n")) {
      const boundary = buffer.indexOf("\n\n");
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const dataLines = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());

      if (dataLines.length === 0) continue;

      const data = dataLines.join("\n");
      if (data === "[DONE]") break;

      yield JSON.parse(data);
    }
  }
}

function mergeChunk(previous, chunk, requestedModel) {
  const next = previous ?? {
    id: chunk.id ?? `chatcmpl-openfusion-${Date.now()}`,
    object: "chat.completion",
    created: chunk.created ?? Math.floor(Date.now() / 1000),
    model: chunk.model ?? requestedModel,
    choices: [
      {
        index: 0,
        finish_reason: null,
        message: {
          role: "assistant",
          content: ""
        }
      }
    ],
    usage: null
  };

  const choice = chunk.choices?.[0];
  const delta = choice?.delta ?? {};
  const message = next.choices[0].message;

  if (delta.role) {
    message.role = delta.role;
  }
  if (typeof delta.content === "string") {
    message.content = `${message.content ?? ""}${delta.content}`;
  }
  if (delta.tool_calls) {
    message.tool_calls = delta.tool_calls;
  }
  if (choice?.finish_reason !== undefined) {
    next.choices[0].finish_reason = choice.finish_reason;
  }
  if (chunk.usage) {
    next.usage = chunk.usage;
  }

  return next;
}
