import { MockChatClient } from "./mockClient.js";
import { OpenAICompatibleClient } from "./openaiClient.js";
import { runFusion } from "./fusion.js";
import { probeEndpoint } from "./probe.js";
import { createHash } from "node:crypto";

export async function runDoctor({ config, real = false, probeURL, probeModel = "openfusion/fusion" } = {}) {
  const checks = [];
  let fusionSummary = null;

  checks.push(check("config", true, "Configuration loaded."));
  checks.push(check("roles", Object.keys(config.roles).length >= 2, `${Object.keys(config.roles).length} roles configured.`));
  checks.push(check("fusion.panel", config.fusion.minPanel >= 1 && config.fusion.maxPanel >= config.fusion.minPanel, `Panel size ${config.fusion.minPanel}-${config.fusion.maxPanel}.`));
  checks.push(check("judgeRole", Boolean(config.roles[config.fusion.judgeRole]), `Judge role: ${config.fusion.judgeRole}.`));
  checks.push(check("synthesizerRole", Boolean(config.roles[config.fusion.synthesizerRole]), `Synthesizer role: ${config.fusion.synthesizerRole}.`));

  const apiKey = process.env[config.upstream.apiKeyEnv];
  checks.push(check("upstream.key", real ? Boolean(apiKey) : true, real
    ? `${config.upstream.apiKeyEnv} ${apiKey ? "is set." : "is missing."}`
    : `Skipped real key check. Set ${config.upstream.apiKeyEnv} and pass --real to test upstream.`));

  const client = real
    ? new OpenAICompatibleClient({
      baseURL: config.upstream.baseURL,
      apiKey,
      appName: config.upstream.appName,
      siteURL: config.upstream.siteURL,
      timeoutMs: Math.min(config.fusion.timeoutMs, 30000)
    })
    : new MockChatClient();

  if (!real || apiKey) {
    try {
      const result = await runFusion({
        question: "Doctor check: debug an API relay test failure and identify routing risks.",
        config,
        client
      });
      fusionSummary = summarizeFusion(result);
      checks.push(check("fusion.pipeline", result.panel.length >= config.fusion.minPanel, `Selected ${result.panel.map((item) => item.role).join(", ")}.`));
      checks.push(check("openai.compat", Boolean(result.final.content), "Fusion produced a final assistant message."));
    } catch (error) {
      checks.push(check("fusion.pipeline", false, error.message));
    }
  }

  if (probeURL) {
    try {
      const probe = await probeEndpoint({
        baseURL: probeURL,
        model: probeModel,
        apiKey
      });
      for (const item of probe.checks) {
        checks.push(item);
      }
    } catch (error) {
      checks.push(check("probe", false, error.message));
    }
  }

  return {
    ok: checks.every((item) => item.ok),
    mode: real ? "real" : "dry-run",
    probeURL: probeURL ?? null,
    fusionSummary,
    checks
  };
}

function check(name, ok, message) {
  return {
    name,
    ok: Boolean(ok),
    message
  };
}

function summarizeFusion(fusion) {
  const phases = fusion.trace?.phases ?? [];

  return {
    object: "openfusion.fusion_summary",
    schema: "openfusion.fusion_summary.v1",
    promptSha256: sha256(fusion.question),
    route: {
      selectedRoles: fusion.route.selectedRoles,
      rationale: fusion.route.rationale
    },
    panel: fusion.panel.map(({ role, model }) => ({ role, model })),
    judge: {
      role: fusion.judge.role,
      model: fusion.judge.model
    },
    synthesizer: {
      role: fusion.final.role,
      model: fusion.final.model
    },
    trace: {
      id: fusion.trace?.id,
      latencyMs: fusion.trace?.latencyMs,
      phaseCount: phases.length,
      phases: phases.map((phase) => ({
        phase: phase.phase,
        role: phase.role,
        model: phase.model,
        latencyMs: phase.latencyMs,
        upstreamId: phase.upstreamId,
        hasUsage: Boolean(phase.usage)
      }))
    },
    evidence: {
      panelCount: fusion.panel.length,
      hasMultiplePanelRoles: fusion.panel.length >= 2,
      hasJudgeNotes: Boolean(fusion.judge.content),
      hasSynthesis: Boolean(fusion.final.content),
      hasPhaseTrace: phases.length > 0
    }
  };
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}
