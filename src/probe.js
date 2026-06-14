export async function probeEndpoint({
  baseURL,
  model = "openfusion/fusion",
  apiKey,
  timeoutMs = 10000
} = {}) {
  if (!baseURL) {
    throw new Error("probeEndpoint requires a baseURL.");
  }

  const root = baseURL.replace(/\/$/, "");
  const checks = [];

  checks.push(await probeModels({ root, apiKey, timeoutMs }));
  checks.push(await probeChat({ root, model, apiKey, timeoutMs, stream: false }));
  checks.push(await probeChat({ root, model, apiKey, timeoutMs, stream: true }));
  checks.push(await probeToolRoundtrip({ root, model, apiKey, timeoutMs }));

  return {
    ok: checks.every((item) => item.ok),
    baseURL: root,
    model,
    checks
  };
}

async function probeToolRoundtrip({ root, model, apiKey, timeoutMs }) {
  try {
    const first = await timedFetch(`${root}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders(apiKey)
      },
      body: JSON.stringify({
        model,
        tools: [
          {
            type: "function",
            function: {
              name: "openfusion_probe_tool",
              description: "Probe whether tool calls round-trip correctly.",
              parameters: {
                type: "object",
                properties: {}
              }
            }
          }
        ],
        tool_choice: {
          type: "function",
          function: {
            name: "openfusion_probe_tool"
          }
        },
        messages: [
          {
            role: "user",
            content: "Call the probe tool."
          }
        ]
      })
    }, timeoutMs);
    const firstPayload = safeJson(await first.text());
    const toolCall = firstPayload?.choices?.[0]?.message?.tool_calls?.[0];

    if (!first.ok || !toolCall?.id || toolCall?.function?.name !== "openfusion_probe_tool") {
      return check("probe.tool.roundtrip", false, `Tool call request returned ${first.status} without a usable tool_call.`);
    }

    const second = await timedFetch(`${root}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders(apiKey)
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: "Call the probe tool."
          },
          firstPayload.choices[0].message,
          {
            role: "tool",
            tool_call_id: toolCall.id,
            content: "{\"ok\":true}"
          }
        ]
      })
    }, timeoutMs);
    const secondPayload = safeJson(await second.text());
    const ok = second.ok
      && secondPayload?.object === "chat.completion"
      && typeof secondPayload?.choices?.[0]?.message?.content === "string";

    return check("probe.tool.roundtrip", ok, `Tool follow-up returned ${second.status}.`);
  } catch (error) {
    return check("probe.tool.roundtrip", false, error.message);
  }
}

async function probeModels({ root, apiKey, timeoutMs }) {
  try {
    const response = await timedFetch(`${root}/models`, {
      headers: authHeaders(apiKey)
    }, timeoutMs);
    const text = await response.text();
    const payload = safeJson(text);

    return check("probe.models", response.ok && payload?.object === "list", `GET /models returned ${response.status}.`);
  } catch (error) {
    return check("probe.models", false, error.message);
  }
}

async function probeChat({ root, model, apiKey, timeoutMs, stream }) {
  try {
    const response = await timedFetch(`${root}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders(apiKey)
      },
      body: JSON.stringify({
        model,
        stream,
        messages: [
          {
            role: "user",
            content: stream
              ? "OpenFusion probe: stream a one sentence answer."
              : "OpenFusion probe: answer in one sentence."
          }
        ]
      })
    }, timeoutMs);
    const text = await response.text();

    if (stream) {
      const contentType = response.headers.get("content-type") ?? "";
      const ok = response.ok && contentType.includes("text/event-stream") && text.includes("data: [DONE]");
      return check("probe.chat.stream", ok, `POST /chat/completions stream returned ${response.status} ${contentType || "unknown content-type"}.`);
    }

    const payload = safeJson(text);
    const ok = response.ok
      && payload?.object === "chat.completion"
      && typeof payload?.choices?.[0]?.message?.content === "string";
    return check("probe.chat", ok, `POST /chat/completions returned ${response.status}.`);
  } catch (error) {
    return check(stream ? "probe.chat.stream" : "probe.chat", false, error.message);
  }
}

async function timedFetch(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(apiKey) {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function check(name, ok, message) {
  return {
    name,
    ok: Boolean(ok),
    message
  };
}
