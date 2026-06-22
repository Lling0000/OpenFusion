import { createHash } from "node:crypto";
import { routeQuestion } from "./router.js";
import { panelPrompt, judgePrompt, synthesisPrompt } from "./prompts.js";
import { transcriptFromMessages } from "./fusion.js";

const DEFAULT_AUTO_THRESHOLDS = {
  singleVerifyRisk: 0.55,
  fusionComplexity: 0.72,
  fusionRisk: 0.84
};

const DEFAULT_AUTO_SCORING = {
  costQualityTradeoff: 7,
  stickyBonus: 0.2,
  maxFallbackCandidates: 3,
  weights: {
    skill: 0.24,
    benchmark: 0.22,
    availability: 0.17,
    price: 0.14,
    throughput: 0.09,
    latency: 0.08,
    role: 0.06
  },
  preferences: {
    minAvailability: 0,
    minBenchmarkPercentile: null,
    maxUsdPer1M: null,
    preferredMinThroughput: null,
    preferredMaxLatency: null
  }
};

const DEFAULT_AUTO_STICKINESS = {
  enabled: true,
  implicit: true,
  ttlMs: 5 * 60 * 1000
};

const DEFAULT_FALLBACK_ROLES = ["fast", "writer", "reasoner"];
const SCORE_KEYS = ["skill", "benchmark", "availability", "price", "throughput", "latency", "role"];

const defaultAutoSessionStore = createAutoSessionStore();

export function createAutoSessionStore() {
  return new Map();
}

export function planAuto({ question, messages, config, sessionId, sessionStore = defaultAutoSessionStore, now = Date.now() }) {
  const normalizedQuestion = question ?? transcriptFromMessages(messages);
  const route = routeQuestion(normalizedQuestion, config);
  const task = analyzeTask(normalizedQuestion, route);
  const session = resolveAutoSession({ question: normalizedQuestion, messages, config, sessionId, sessionStore, now });
  const candidates = rankedCandidates({ task, route, config, session });
  const mode = chooseMode({ task, route, config });
  const selected = selectPlanCandidates({ mode, task, route, candidates, config });
  const phases = planPhases({ mode, selected, candidates, config });
  const budget = autoBudget({ phases, config });

  const plan = {
    object: "openfusion.auto_plan",
    schema: "openfusion.auto_plan.v2",
    mode,
    profile: chooseProfile({ mode, task }),
    rationale: explainAutoPlan({ mode, task, selected, session }),
    task,
    route,
    strategy: publicStrategy({ config, task }),
    session: publicSession(session),
    candidates: candidates.map(publicCandidate),
    selected: selected.map(publicCandidate),
    phases: phases.map((phase) => ({
      phase: phase.phase,
      role: phase.role,
      model: phase.candidates[0]?.model,
      candidates: phase.candidates.map(publicCandidate)
    })),
    budget
  };
  Object.defineProperty(plan, "__session", {
    value: session,
    enumerable: false
  });
  return plan;
}

export async function runAuto({
  question,
  messages,
  config,
  client,
  sessionId,
  sessionStore = defaultAutoSessionStore,
  requestOptions = {}
}) {
  const normalizedQuestion = question ?? transcriptFromMessages(messages);
  const plan = planAuto({ question: normalizedQuestion, messages, config, sessionId, sessionStore });
  enforceAutoBudget(plan.budget);

  const trace = {
    id: createTraceId(),
    startedAt: new Date().toISOString(),
    auto: traceAutoPlan(plan),
    budget: plan.budget,
    phases: []
  };

  const context = { config, session: plan.__session ?? null, sessionStore, requestOptions };

  if (plan.mode === "fast-single" || plan.mode === "smart-single") {
    return runAutoSingle({ question: normalizedQuestion, plan, trace, context, client });
  }

  if (plan.mode === "single-verify") {
    return runAutoSingleVerify({ question: normalizedQuestion, plan, trace, context, client });
  }

  return runAutoFusionPanel({ question: normalizedQuestion, plan, trace, context, client });
}

function analyzeTask(question, route) {
  const text = question.toLowerCase();
  const signals = {
    coding: countMatches(text, [
      /\b(code|bug|debug|test|typescript|javascript|python|react|node|api|stack trace|patch|refactor)\b/g,
      /报错|代码|测试|接口|修复|调试|重构/g
    ]),
    reasoning: countMatches(text, [
      /\b(compare|decide|tradeoff|architecture|design|plan|why|prove|math|reason)\b/g,
      /比较|取舍|架构|方案|推理|证明|为什么/g
    ]),
    verification: countMatches(text, [
      /\b(verify|risk|security|edge case|review|audit|failure|safe|eval)\b/g,
      /验证|风险|安全|边界|审查|评估/g
    ]),
    writing: countMatches(text, [
      /\b(write|rewrite|summarize|email|readme|docs|copy|blog|translate)\b/g,
      /写|改写|总结|文档|邮件|翻译|README/gi
    ]),
    critical: countMatches(text, [
      /\b(production|critical|incident|outage|migration|compliance|auth|payment|privacy|data loss)\b/g,
      /生产|严重|事故|迁移|合规|认证|支付|隐私|数据丢失/g
    ])
  };
  const activeSignals = Object.values(signals).filter((score) => score > 0).length;
  const lengthScore = Math.min(1, question.length / 2400);
  const complexity = clamp01(
    (signals.reasoning * 0.17)
    + (signals.coding * 0.08)
    + (signals.verification * 0.08)
    + (signals.critical * 0.12)
    + (activeSignals * 0.11)
    + (lengthScore * 0.28)
  );
  const risk = clamp01(
    (signals.verification * 0.18)
    + (signals.critical * 0.22)
    + (signals.coding * 0.06)
    + (text.includes("security") || text.includes("安全") ? 0.18 : 0)
    + (text.includes("test") || text.includes("测试") ? 0.08 : 0)
  );
  const primaryRole = choosePrimaryRole(signals, route);
  const type = taskType({ signals, complexity, risk, primaryRole });

  return {
    type,
    primaryRole,
    signals,
    complexity,
    risk,
    important: risk >= DEFAULT_AUTO_THRESHOLDS.singleVerifyRisk || signals.critical > 0,
    highRisk: risk >= DEFAULT_AUTO_THRESHOLDS.fusionRisk,
    routeRationale: route.rationale
  };
}

function chooseMode({ task, route, config }) {
  const thresholds = {
    ...DEFAULT_AUTO_THRESHOLDS,
    ...(config.auto?.thresholds ?? {})
  };
  const routedRoles = route.selectedRoles.filter((role) => role !== "fast");
  const hasComplexPanel = routedRoles.length >= 3 || (routedRoles.includes("reasoner") && routedRoles.includes("verifier"));

  if (
    task.complexity >= thresholds.fusionComplexity
    || (task.risk >= thresholds.fusionRisk && task.complexity >= 0.48)
    || (task.risk >= thresholds.singleVerifyRisk && hasComplexPanel && task.complexity >= 0.5)
  ) {
    return "fusion-panel";
  }

  if (task.risk >= thresholds.singleVerifyRisk || routedRoles.includes("verifier") && task.signals.verification > 0) {
    return "single-verify";
  }

  return task.primaryRole === "fast" ? "fast-single" : "smart-single";
}

function chooseProfile({ mode, task }) {
  if (mode === "fast-single") return "fast";
  if (mode === "fusion-panel" || task.highRisk) return "quality";
  return "balanced";
}

function selectPlanCandidates({ mode, task, route, candidates, config }) {
  const selected = [];

  if (mode === "fast-single") {
    selected.push(bestForRole("fast", candidates) ?? candidates[0]);
    return selected.filter(Boolean);
  }

  if (mode === "smart-single") {
    selected.push(bestForRole(task.primaryRole, candidates) ?? candidates[0]);
    return selected.filter(Boolean);
  }

  if (mode === "single-verify") {
    selected.push(bestForRole(task.primaryRole === "verifier" ? "reasoner" : task.primaryRole, candidates) ?? candidates[0]);
    selected.push(bestForRole(config.fusion.judgeRole, candidates) ?? bestForRole("verifier", candidates));
    selected.push(bestForRole(config.fusion.synthesizerRole, candidates) ?? bestForRole("writer", candidates));
    return uniqueCandidates(selected.filter(Boolean));
  }

  const roles = route.selectedRoles
    .filter((role) => role !== config.fusion.synthesizerRole)
    .slice(0, config.fusion.maxPanel);
  for (const role of roles) {
    const candidate = bestForRole(role, candidates);
    if (candidate) selected.push(candidate);
  }
  selected.push(bestForRole(config.fusion.judgeRole, candidates) ?? bestForRole("verifier", candidates));
  selected.push(bestForRole(config.fusion.synthesizerRole, candidates) ?? bestForRole("writer", candidates));
  return uniqueCandidates(selected.filter(Boolean));
}

function planPhases({ mode, selected, candidates, config }) {
  const byRole = new Map(selected.map((candidate) => [candidate.role, candidate]));
  const phases = [];

  if (mode === "fast-single" || mode === "smart-single") {
    const primary = selected[0];
    phases.push({
      phase: "primary",
      role: primary.role,
      candidates: fallbackCandidatesForRole(primary.role, primary, candidates, config)
    });
    return phases;
  }

  if (mode === "single-verify") {
    const primary = selected.find((candidate) => !["verifier", config.fusion.synthesizerRole].includes(candidate.role)) ?? selected[0];
    const verifier = byRole.get(config.fusion.judgeRole) ?? byRole.get("verifier") ?? primary;
    const synthesizer = byRole.get(config.fusion.synthesizerRole) ?? byRole.get("writer") ?? primary;
    phases.push({ phase: "primary", role: primary.role, candidates: fallbackCandidatesForRole(primary.role, primary, candidates, config) });
    phases.push({ phase: "judge", role: verifier.role, candidates: fallbackCandidatesForRole(verifier.role, verifier, candidates, config) });
    phases.push({ phase: "synthesis", role: synthesizer.role, candidates: fallbackCandidatesForRole(synthesizer.role, synthesizer, candidates, config) });
    return phases;
  }

  for (const candidate of selected) {
    if ([config.fusion.judgeRole, config.fusion.synthesizerRole].includes(candidate.role)) continue;
    phases.push({ phase: "panel", role: candidate.role, candidates: fallbackCandidatesForRole(candidate.role, candidate, candidates, config) });
  }
  const judge = byRole.get(config.fusion.judgeRole) ?? byRole.get("verifier");
  const synthesizer = byRole.get(config.fusion.synthesizerRole) ?? byRole.get("writer");
  phases.push({ phase: "judge", role: judge.role, candidates: fallbackCandidatesForRole(judge.role, judge, candidates, config) });
  phases.push({ phase: "synthesis", role: synthesizer.role, candidates: fallbackCandidatesForRole(synthesizer.role, synthesizer, candidates, config) });
  return phases;
}

async function runAutoSingle({ question, plan, trace, context, client }) {
  const primaryPhase = plan.phases[0];
  const { response, phase } = await completeWithFallback(client, {
    phase: primaryPhase.phase,
    candidates: primaryPhase.candidates,
    messages: panelPrompt({
      role: primaryPhase.role,
      roleConfig: roleConfigForCandidate(primaryPhase.candidates[0], context.config),
      question
    }),
    context
  });
  trace.phases.push(phase);
  finishTrace(trace, context);

  return {
    question,
    route: plan.route,
    auto: trace.auto,
    panel: [{ role: primaryPhase.role, model: response.model, content: response.content }],
    judge: { role: null, model: null, content: "" },
    final: { role: primaryPhase.role, model: response.model, content: response.content },
    trace
  };
}

async function runAutoSingleVerify({ question, plan, trace, context, client }) {
  const [primaryPhase, judgePhase, synthesisPhase] = plan.phases;
  const { response: primaryResponse, phase: primaryTrace } = await completeWithFallback(client, {
    phase: primaryPhase.phase,
    candidates: primaryPhase.candidates,
    messages: panelPrompt({
      role: primaryPhase.role,
      roleConfig: roleConfigForCandidate(primaryPhase.candidates[0], context.config),
      question
    }),
    context
  });
  const panelResponses = [{ role: primaryPhase.role, model: primaryResponse.model, content: primaryResponse.content }];
  trace.phases.push(primaryTrace);

  const { response: judgeResponse, phase: judgeTrace } = await completeWithFallback(client, {
    phase: "judge",
    candidates: judgePhase.candidates,
    messages: judgePrompt({ question, panelResponses }),
    context
  });
  trace.phases.push(judgeTrace);

  const { response: finalResponse, phase: synthesisTrace } = await completeWithFallback(client, {
    phase: "synthesis",
    candidates: synthesisPhase.candidates,
    messages: synthesisPrompt({ question, panelResponses, judgeResponse }),
    context
  });
  trace.phases.push(synthesisTrace);
  finishTrace(trace, context);

  return {
    question,
    route: plan.route,
    auto: trace.auto,
    panel: panelResponses,
    judge: { role: judgeTrace.role, model: judgeResponse.model, content: judgeResponse.content },
    final: { role: synthesisTrace.role, model: finalResponse.model, content: finalResponse.content },
    trace
  };
}

async function runAutoFusionPanel({ question, plan, trace, context, client }) {
  const panelPhases = plan.phases.filter((phase) => phase.phase === "panel");
  const panelResults = await Promise.all(panelPhases.map(async (phasePlan) => {
    const { response, phase } = await completeWithFallback(client, {
      phase: "panel",
      candidates: phasePlan.candidates,
      messages: panelPrompt({
        role: phasePlan.role,
        roleConfig: roleConfigForCandidate(phasePlan.candidates[0], context.config),
        question
      }),
      context
    });
    return {
      response: { role: phase.role, model: response.model, content: response.content },
      phase
    };
  }));
  const panelResponses = panelResults.map((result) => result.response);
  trace.phases.push(...panelResults.map((result) => result.phase));

  const judgePhase = plan.phases.find((phase) => phase.phase === "judge");
  const { response: judgeResponse, phase: judgeTrace } = await completeWithFallback(client, {
    phase: "judge",
    candidates: judgePhase.candidates,
    messages: judgePrompt({ question, panelResponses }),
    context
  });
  trace.phases.push(judgeTrace);

  const synthesisPhase = plan.phases.find((phase) => phase.phase === "synthesis");
  const { response: finalResponse, phase: synthesisTrace } = await completeWithFallback(client, {
    phase: "synthesis",
    candidates: synthesisPhase.candidates,
    messages: synthesisPrompt({ question, panelResponses, judgeResponse }),
    context
  });
  trace.phases.push(synthesisTrace);
  finishTrace(trace, context);

  return {
    question,
    route: plan.route,
    auto: trace.auto,
    panel: panelResponses,
    judge: { role: judgeTrace.role, model: judgeResponse.model, content: judgeResponse.content },
    final: { role: synthesisTrace.role, model: finalResponse.model, content: finalResponse.content },
    trace
  };
}

async function completeWithFallback(client, { phase, candidates, messages, context }) {
  const attempts = [];
  let lastError;

  for (const candidate of candidates) {
    const startedAt = new Date();
    const startedMs = Date.now();
    const requestOptions = buildCandidateRequestOptions({ candidate, candidates, context });
    try {
      const response = await client.complete({
        phase,
        role: candidate.role,
        model: candidate.model,
        messages,
        ...requestOptions,
        metadata: {
          ...(requestOptions.metadata ?? {}),
          phase,
          role: candidate.role,
          auto: true,
          candidate_id: candidate.id
        }
      });
      const completedAt = new Date();
      attempts.push({
        id: candidate.id,
        role: candidate.role,
        model: candidate.model,
        score: candidate.score,
        status: "success",
        upstream: publicUpstreamOptions(requestOptions)
      });
      return {
        response,
        phase: {
          phase,
          role: candidate.role,
          model: response.model ?? candidate.model,
          candidateId: candidate.id,
          candidateModel: candidate.model,
          score: candidate.score,
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          latencyMs: Date.now() - startedMs,
          upstreamId: response.raw?.id ?? null,
          usage: response.raw?.usage ?? null,
          upstream: publicUpstreamOptions(requestOptions),
          attempts
        }
      };
    } catch (error) {
      lastError = error;
      attempts.push({
        id: candidate.id,
        role: candidate.role,
        model: candidate.model,
        score: candidate.score,
        status: "error",
        error: error.message,
        upstream: publicUpstreamOptions(requestOptions)
      });
    }
  }

  throw lastError ?? new Error(`No candidate succeeded for auto phase ${phase}.`);
}

function rankedCandidates({ task, route, config, session }) {
  const pool = candidatePool(config);
  const preferences = autoScoring(config).preferences;
  const scored = pool
    .map((candidate) => {
      const metrics = candidateMetrics(candidate, task, config);
      const status = candidateStatus({ candidate, metrics, preferences, task });
      const scoreResult = scoreCandidate({ candidate, metrics, status, task, route, config, session });
      return {
        ...candidate,
        metrics,
        status,
        score: scoreResult.score,
        scoreBreakdown: scoreResult.breakdown,
        sticky: stickyInfo(candidate, session)
      };
    })
    .sort(compareCandidates);

  return scored.some((candidate) => candidate.status.eligible)
    ? scored
    : scored.map((candidate) => ({
      ...candidate,
      status: { ...candidate.status, eligible: true, hardRejects: ["all_candidates_rejected_fails_open"] }
    }));
}

function candidatePool(config) {
  const configured = Array.isArray(config.auto?.candidates) ? config.auto.candidates : [];
  const base = configured.length > 0
    ? configured
    : Object.entries(config.roles).map(([role, roleConfig]) => ({
      id: role,
      role,
      model: roleConfig.model,
      description: roleConfig.description
    }));

  return base
    .filter((candidate) => candidate?.role && candidate?.model)
    .map((candidate, index) => normalizeCandidate(candidate, config, index));
}

function normalizeCandidate(candidate, config, index) {
  const roleConfig = config.roles[candidate.role] ?? {};
  const pricing = candidate.pricing ?? roleConfig.pricing ?? null;
  const upstream = mergePlain(
    candidate.request,
    candidate.upstream,
    candidate.provider ? { provider: candidate.provider } : undefined,
    candidate.plugins ? { plugins: candidate.plugins } : undefined,
    candidate.models ? { models: candidate.models } : undefined
  );

  return {
    id: candidate.id ?? `${candidate.role}-${index}`,
    role: candidate.role,
    model: candidate.model ?? roleConfig.model,
    description: candidate.description ?? roleConfig.description ?? `${candidate.role} candidate`,
    skills: {
      general: normalizedScore(candidate.skills?.general ?? (candidate.role === "fast" ? 0.8 : 0.55)),
      coding: normalizedScore(candidate.skills?.coding ?? (candidate.role === "coder" ? 0.85 : 0.45)),
      reasoning: normalizedScore(candidate.skills?.reasoning ?? (candidate.role === "reasoner" ? 0.85 : 0.5)),
      verification: normalizedScore(candidate.skills?.verification ?? (candidate.role === "verifier" ? 0.86 : 0.45)),
      writing: normalizedScore(candidate.skills?.writing ?? (candidate.role === "writer" ? 0.86 : 0.55))
    },
    benchmarks: candidate.benchmarks ?? candidate.benchmarkPercentiles ?? candidate.benchmark ?? null,
    quality: normalizedScore(candidate.quality ?? 0.7),
    pricing,
    cost: normalizedScore(candidate.cost ?? (candidate.role === "fast" ? 0.9 : 0.55)),
    performance: candidate.performance ?? candidate.metrics ?? {},
    latency: candidate.latency,
    throughput: candidate.throughput,
    availability: availabilityValue(candidate),
    reliability: normalizedScore(candidate.reliability ?? 0.75),
    fallback: Boolean(candidate.fallback),
    upstream
  };
}

function candidateMetrics(candidate, task, config) {
  const skillKey = skillKeyForTask(task);
  const benchmark = benchmarkScore(candidate, skillKey);
  const pricing = pricingMetric(candidate, config);
  const throughput = percentileMetric(
    candidate.performance?.throughput
    ?? candidate.performance?.tokensPerSecond
    ?? candidate.throughput
  );
  const latency = percentileMetric(
    candidate.performance?.latency
    ?? candidate.performance?.latencySeconds
    ?? candidate.latency
  );
  const availability = normalizedScore(candidate.availability ?? candidate.reliability ?? 0.75);

  return {
    skillKey,
    skill: candidate.skills[skillKey] ?? candidate.skills.general ?? 0.5,
    benchmark,
    price: pricing,
    throughput,
    latency,
    availability,
    quality: candidate.quality
  };
}

function candidateStatus({ candidate, metrics, preferences, task }) {
  const hardRejects = [];
  const preferenceMisses = [];
  const minAvailability = numberPreference(preferences.minAvailability);
  const minBenchmark = taskPreference(preferences.minBenchmarkPercentile, task);
  const maxUsdPer1M = maxPricePreference(preferences.maxUsdPer1M);

  if (candidate.availability === false || candidate.available === false) {
    hardRejects.push("unavailable");
  }
  if (minAvailability !== null && metrics.availability < minAvailability) {
    hardRejects.push("availability_below_floor");
  }
  if (minBenchmark !== null && metrics.benchmark.value !== null && metrics.benchmark.value < minBenchmark) {
    hardRejects.push("benchmark_below_floor");
  }
  if (maxUsdPer1M !== null && metrics.price.usdPer1M !== null && metrics.price.usdPer1M > maxUsdPer1M) {
    hardRejects.push("price_above_max");
  }

  const throughputPreference = preferences.preferredMinThroughput;
  if (throughputPreference && !meetsPercentilePreference(metrics.throughput, throughputPreference, "min")) {
    preferenceMisses.push("preferred_min_throughput");
  }
  const latencyPreference = preferences.preferredMaxLatency;
  if (latencyPreference && !meetsPercentilePreference(metrics.latency, latencyPreference, "max")) {
    preferenceMisses.push("preferred_max_latency");
  }

  return {
    eligible: hardRejects.length === 0,
    hardRejects,
    preferenceMisses
  };
}

function scoreCandidate({ candidate, metrics, status, task, route, config, session }) {
  const roleSignal = route.selectedRoles.includes(candidate.role) || task.primaryRole === candidate.role ? 1 : 0;
  const metricScores = {
    skill: metrics.skill,
    benchmark: metrics.benchmark.score,
    availability: metrics.availability,
    price: metrics.price.score ?? candidate.cost ?? 0.5,
    throughput: throughputScore(metrics.throughput),
    latency: latencyScore(metrics.latency, candidate),
    role: roleSignal
  };
  const weights = effectiveWeights(config);
  const weighted = SCORE_KEYS.reduce((total, key) => total + metricScores[key] * weights[key], 0);
  const preferencePenalty = status.preferenceMisses.length * 0.05;
  const hardPenalty = status.eligible ? 0 : 0.35;
  const sticky = stickyInfo(candidate, session);
  const stickyBonus = sticky.pinned ? autoScoring(config).stickyBonus : 0;

  return {
    score: roundScore(weighted + stickyBonus - preferencePenalty - hardPenalty),
    breakdown: {
      metrics: roundObject(metricScores),
      weights: roundObject(weights),
      preferencePenalty: roundScore(preferencePenalty),
      hardPenalty: roundScore(hardPenalty),
      stickyBonus: roundScore(stickyBonus)
    }
  };
}

function bestForRole(role, candidates) {
  return candidates.find((candidate) => candidate.role === role && candidate.status.eligible)
    ?? candidates.find((candidate) => candidate.role === role)
    ?? null;
}

function fallbackCandidatesForRole(role, preferred, candidates, config) {
  const fallbackRoles = config.auto?.fallbackRoles ?? DEFAULT_FALLBACK_ROLES;
  const maxFallbackCandidates = config.auto?.maxFallbackCandidates
    ?? config.auto?.scoring?.maxFallbackCandidates
    ?? DEFAULT_AUTO_SCORING.maxFallbackCandidates;
  const ranked = [
    preferred,
    ...candidates.filter((candidate) => candidate.role === role),
    ...candidates.filter((candidate) => fallbackRoles.includes(candidate.role) || candidate.fallback)
  ];
  const eligible = uniqueCandidates(ranked).filter((candidate) => candidate.status?.eligible !== false);
  const fallback = eligible.length > 0 ? eligible : uniqueCandidates(ranked);

  return fallback.slice(0, Math.max(1, maxFallbackCandidates));
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  const unique = [];
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate.model)) continue;
    seen.add(candidate.model);
    unique.push(candidate);
  }
  return unique;
}

function autoBudget({ phases, config }) {
  const estimatedUpstreamCalls = phases.length;
  const maxUpstreamCalls = config.fusion.maxUpstreamCalls ?? Infinity;
  const cost = estimateAutoCost({ phases, config });
  return {
    estimatedUpstreamCalls,
    maxUpstreamCalls,
    withinBudget: estimatedUpstreamCalls <= maxUpstreamCalls && cost.withinBudget,
    callsWithinBudget: estimatedUpstreamCalls <= maxUpstreamCalls,
    cost
  };
}

function estimateAutoCost({ phases, config }) {
  const settings = config.fusion.costEstimate ?? {};
  const inputTokensPerCall = settings.inputTokensPerCall ?? 0;
  const outputTokensPerCall = settings.outputTokensPerCall ?? 0;
  const maxUsd = settings.maxUsd ?? null;
  const items = phases.map((phase) => {
    const candidate = phase.candidates[0] ?? {};
    const pricing = candidate.pricing ?? config.roles[candidate.role]?.pricing;
    const inputUsdPer1M = pricing?.inputUsdPer1M;
    const outputUsdPer1M = pricing?.outputUsdPer1M;
    const hasPricing = Number.isFinite(inputUsdPer1M) && Number.isFinite(outputUsdPer1M);
    const estimatedUsd = hasPricing
      ? ((inputTokensPerCall * inputUsdPer1M) + (outputTokensPerCall * outputUsdPer1M)) / 1_000_000
      : null;
    return {
      phase: phase.phase,
      role: candidate.role,
      model: candidate.model,
      inputTokens: inputTokensPerCall,
      outputTokens: outputTokensPerCall,
      inputUsdPer1M: hasPricing ? inputUsdPer1M : null,
      outputUsdPer1M: hasPricing ? outputUsdPer1M : null,
      estimatedUsd
    };
  });
  const estimatedUsd = items.every((item) => item.estimatedUsd !== null)
    ? items.reduce((total, item) => total + item.estimatedUsd, 0)
    : null;

  return {
    available: estimatedUsd !== null,
    estimatedUsd,
    maxUsd,
    withinBudget: estimatedUsd === null || maxUsd === null || estimatedUsd <= maxUsd,
    assumptions: { inputTokensPerCall, outputTokensPerCall },
    items
  };
}

function enforceAutoBudget(budget) {
  if (budget.withinBudget) return;

  if (!budget.callsWithinBudget) {
    const error = new Error(`Auto route needs ${budget.estimatedUpstreamCalls} upstream calls, which exceeds fusion.maxUpstreamCalls=${budget.maxUpstreamCalls}.`);
    error.name = "OpenFusionBudgetError";
    error.statusCode = 400;
    error.type = "invalid_request_error";
    error.code = "fusion_budget_exceeded";
    error.param = "fusion.maxUpstreamCalls";
    throw error;
  }

  const error = new Error(`Auto route estimated cost $${budget.cost.estimatedUsd.toFixed(6)}, which exceeds fusion.costEstimate.maxUsd=$${budget.cost.maxUsd}.`);
  error.name = "OpenFusionBudgetError";
  error.statusCode = 400;
  error.type = "invalid_request_error";
  error.code = "fusion_budget_exceeded";
  error.param = "fusion.costEstimate.maxUsd";
  throw error;
}

function buildCandidateRequestOptions({ candidate, candidates, context }) {
  const upstreamFallbacks = context.config.auto?.upstreamFallbacks ?? {};
  const fallbackModels = upstreamFallbacks.enabled
    ? candidates
      .filter((item) => item.model !== candidate.model)
      .slice(0, Math.max(0, upstreamFallbacks.maxModels ?? 2))
      .map((item) => item.model)
    : [];
  const configured = context.config.auto?.upstream ?? {};
  const requestOptions = mergePlain(
    configured,
    fallbackModels.length > 0 ? { models: fallbackModels } : undefined,
    candidate.upstream,
    context.requestOptions
  );
  if (context.session?.id) {
    requestOptions.session_id = context.session.id;
  }
  return requestOptions;
}

function resolveAutoSession({ question, messages, config, sessionId, sessionStore, now }) {
  const settings = {
    ...DEFAULT_AUTO_STICKINESS,
    ...(config.auto?.stickiness ?? {})
  };
  if (!settings.enabled) {
    return { enabled: false, key: null, id: null, source: null, hit: false, pins: { roles: {} }, ttlMs: settings.ttlMs };
  }

  const explicit = cleanString(sessionId);
  const implicit = !explicit && settings.implicit
    ? implicitSessionFingerprint(messages, question)
    : null;
  const id = explicit ?? implicit;
  if (!id) {
    return { enabled: true, key: null, id: null, source: null, hit: false, pins: { roles: {} }, ttlMs: settings.ttlMs };
  }

  const source = explicit ? "explicit" : "implicit";
  const key = `${source}:${id}`;
  const entry = sessionStore?.get(key);
  if (entry && entry.expiresAt <= now) {
    sessionStore?.delete(key);
  }
  const freshEntry = entry && entry.expiresAt > now ? entry : null;

  return {
    enabled: true,
    key,
    id,
    source,
    hit: Boolean(freshEntry),
    ttlMs: settings.ttlMs,
    pins: freshEntry?.pins ?? { roles: {} },
    expiresAt: freshEntry?.expiresAt ?? null
  };
}

function persistAutoSession({ trace, context }) {
  const session = context.session;
  if (!session?.enabled || !session.key || !context.sessionStore) return null;

  const now = Date.now();
  const nextPins = {
    roles: {
      ...(session.pins?.roles ?? {})
    }
  };
  for (const phase of trace.phases) {
    if (!phase.role || !phase.candidateModel) continue;
    nextPins.roles[phase.role] = phase.candidateModel;
  }

  const entry = {
    pins: nextPins,
    updatedAt: now,
    expiresAt: now + session.ttlMs
  };
  context.sessionStore.set(session.key, entry);
  return entry;
}

function stickyInfo(candidate, session) {
  const pinnedModel = session?.pins?.roles?.[candidate.role] ?? null;
  return {
    pinned: Boolean(pinnedModel && pinnedModel === candidate.model),
    pinnedModel
  };
}

function implicitSessionFingerprint(messages, question) {
  const seed = Array.isArray(messages) && messages.length > 0
    ? [
      firstMessageContent(messages, "system"),
      firstMessageContent(messages, "user")
    ].filter(Boolean).join("\n\n")
    : question.slice(0, 1000);

  if (!seed) return null;
  return createHash("sha256").update(seed).digest("hex").slice(0, 24);
}

function firstMessageContent(messages, role) {
  const message = messages.find((item) => item.role === role);
  if (!message) return "";
  return contentToText(message.content);
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (part.type === "text" && typeof part.text === "string") return part.text;
      if (typeof part.text === "string") return part.text;
      return "";
    }).join("\n");
  }
  if (content == null) return "";
  return JSON.stringify(content);
}

function choosePrimaryRole(signals, route) {
  const roleScores = {
    coder: signals.coding,
    reasoner: signals.reasoning,
    verifier: signals.verification,
    writer: signals.writing,
    fast: 0
  };
  const [role, score] = Object.entries(roleScores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (score > 0 && role !== "verifier") return role;
  if (score > 0 && signals.coding === 0 && signals.reasoning === 0) return "reasoner";
  return route.selectedRoles.find((item) => !["verifier"].includes(item)) ?? "fast";
}

function taskType({ signals, complexity, risk, primaryRole }) {
  if (complexity >= 0.72) return "complex-fusion";
  if (signals.coding > 0 && risk >= 0.55) return "coding-review";
  if (signals.coding > 0) return "coding";
  if (signals.reasoning > 0) return "reasoning";
  if (signals.writing > 0) return "writing";
  if (risk >= 0.55) return "verification";
  return primaryRole === "fast" ? "simple" : primaryRole;
}

function countMatches(text, patterns) {
  return patterns.reduce((total, pattern) => {
    const matches = text.match(pattern);
    return total + (matches?.length ?? 0);
  }, 0);
}

function roleConfigForCandidate(candidate, config) {
  return {
    ...(config.roles[candidate.role] ?? {}),
    model: candidate.model,
    description: candidate.description
  };
}

function skillKeyForTask(task) {
  return {
    coder: "coding",
    reasoner: "reasoning",
    verifier: "verification",
    writer: "writing",
    fast: "general"
  }[task.primaryRole] ?? "general";
}

function benchmarkScore(candidate, skillKey) {
  const raw = firstDefined(
    readMetric(candidate.benchmarks, [skillKey, "percentile"]),
    readMetric(candidate.benchmarks, [skillKey]),
    readMetric(candidate.benchmarks, ["general", "percentile"]),
    readMetric(candidate.benchmarks, ["general"]),
    candidate.benchmarkPercentile,
    candidate.quality
  );
  const value = normalizePercentile(raw);

  return {
    value,
    score: value ?? candidate.quality ?? 0.5
  };
}

function pricingMetric(candidate, config) {
  const pricing = candidate.pricing ?? {};
  const inputUsdPer1M = pricing.inputUsdPer1M;
  const outputUsdPer1M = pricing.outputUsdPer1M;
  const costSettings = config.fusion?.costEstimate ?? {};
  const inputTokens = costSettings.inputTokensPerCall ?? 2;
  const outputTokens = costSettings.outputTokensPerCall ?? 1;
  const hasPricing = Number.isFinite(inputUsdPer1M) && Number.isFinite(outputUsdPer1M);
  const usdPer1M = hasPricing
    ? ((inputUsdPer1M * inputTokens) + (outputUsdPer1M * outputTokens)) / Math.max(1, inputTokens + outputTokens)
    : null;

  return {
    inputUsdPer1M: hasPricing ? inputUsdPer1M : null,
    outputUsdPer1M: hasPricing ? outputUsdPer1M : null,
    usdPer1M,
    score: usdPer1M === null ? candidate.cost : priceScore(usdPer1M)
  };
}

function percentileMetric(value) {
  if (value == null || typeof value === "boolean") return { value: null, p50: null, p75: null, p90: null, p99: null };
  if (typeof value === "number") return { value, p50: value, p75: null, p90: null, p99: null };
  if (typeof value !== "object") return { value: null, p50: null, p75: null, p90: null, p99: null };
  const p50 = numericOrNull(value.p50 ?? value.median ?? value.value);
  const p75 = numericOrNull(value.p75);
  const p90 = numericOrNull(value.p90);
  const p99 = numericOrNull(value.p99);
  return {
    value: p50 ?? p75 ?? p90 ?? p99,
    p50,
    p75,
    p90,
    p99
  };
}

function throughputScore(metric) {
  if (metric.value === null) return 0.5;
  const p50 = metric.p50 ?? metric.value;
  const p90 = metric.p90 ?? p50;
  return roundScore((clamp01(p50 / 120) * 0.55) + (clamp01(p90 / 80) * 0.45));
}

function latencyScore(metric, candidate) {
  if (typeof candidate.latency === "number" && candidate.latency >= 0 && candidate.latency <= 1) {
    return normalizedScore(candidate.latency);
  }
  if (metric.value === null) return 0.5;
  const p50 = metric.p50 ?? metric.value;
  const p90 = metric.p90 ?? p50;
  return roundScore((clamp01(1 - (p50 / 4)) * 0.5) + (clamp01(1 - (p90 / 8)) * 0.5));
}

function priceScore(usdPer1M) {
  if (!Number.isFinite(usdPer1M)) return 0.5;
  return roundScore(1 - (Math.log10(Math.max(usdPer1M, 0.001) + 1) / Math.log10(101)));
}

function meetsPercentilePreference(metric, preference, direction) {
  if (typeof preference === "number") {
    return compareMetric(metric.p50 ?? metric.value, preference, direction);
  }
  if (!preference || typeof preference !== "object") return true;
  return ["p50", "p75", "p90", "p99"].every((key) => {
    if (preference[key] === undefined) return true;
    return compareMetric(metric[key] ?? metric.value, preference[key], direction);
  });
}

function compareMetric(actual, expected, direction) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  return direction === "min" ? actual >= expected : actual <= expected;
}

function effectiveWeights(config) {
  const scoring = autoScoring(config);
  const base = {
    ...DEFAULT_AUTO_SCORING.weights,
    ...(scoring.weights ?? {})
  };
  const tradeoff = clamp01((scoring.costQualityTradeoff ?? DEFAULT_AUTO_SCORING.costQualityTradeoff) / 10);
  const qualityTilt = 1 - tradeoff;
  const adjusted = {
    skill: base.skill * (1 + qualityTilt * 0.45),
    benchmark: base.benchmark * (1 + qualityTilt * 0.65),
    availability: base.availability,
    price: base.price * (0.65 + tradeoff * 1.35),
    throughput: base.throughput,
    latency: base.latency,
    role: base.role
  };
  const total = SCORE_KEYS.reduce((sum, key) => sum + adjusted[key], 0);
  return Object.fromEntries(SCORE_KEYS.map((key) => [key, adjusted[key] / total]));
}

function autoScoring(config) {
  return {
    ...DEFAULT_AUTO_SCORING,
    ...(config.auto?.scoring ?? {}),
    preferences: {
      ...DEFAULT_AUTO_SCORING.preferences,
      ...(config.auto?.preferences ?? {}),
      ...(config.auto?.scoring?.preferences ?? {})
    }
  };
}

function compareCandidates(a, b) {
  if (a.status.eligible !== b.status.eligible) return a.status.eligible ? -1 : 1;
  if (a.sticky.pinned !== b.sticky.pinned) return a.sticky.pinned ? -1 : 1;
  return b.score - a.score || a.model.localeCompare(b.model);
}

function publicCandidate(candidate) {
  return {
    id: candidate.id,
    role: candidate.role,
    model: candidate.model,
    score: candidate.score,
    description: candidate.description,
    status: candidate.status,
    sticky: candidate.sticky,
    metrics: publicMetrics(candidate.metrics),
    score_breakdown: candidate.scoreBreakdown,
    upstream: publicUpstreamOptions(candidate.upstream)
  };
}

function publicMetrics(metrics) {
  return {
    skill_key: metrics.skillKey,
    skill: roundScore(metrics.skill),
    benchmark_percentile: metrics.benchmark.value === null ? null : Math.round(metrics.benchmark.value * 100),
    price_usd_per_1m: metrics.price.usdPer1M,
    throughput: metrics.throughput,
    latency: metrics.latency,
    availability: roundScore(metrics.availability)
  };
}

function publicStrategy({ config, task }) {
  const scoring = autoScoring(config);
  return {
    scoring: {
      cost_quality_tradeoff: scoring.costQualityTradeoff,
      weights: roundObject(effectiveWeights(config)),
      preferences: scoring.preferences
    },
    task_skill_key: skillKeyForTask(task),
    fallback_roles: config.auto?.fallbackRoles ?? DEFAULT_FALLBACK_ROLES,
    max_fallback_candidates: config.auto?.maxFallbackCandidates
      ?? config.auto?.scoring?.maxFallbackCandidates
      ?? DEFAULT_AUTO_SCORING.maxFallbackCandidates,
    upstream_fallbacks: config.auto?.upstreamFallbacks ?? { enabled: false }
  };
}

function publicSession(session) {
  return {
    enabled: session.enabled,
    source: session.source,
    id: session.id,
    key: session.key,
    hit: session.hit,
    ttl_ms: session.ttlMs,
    pins: session.pins
  };
}

function publicUpstreamOptions(options = {}) {
  const picked = {};
  for (const key of ["models", "provider", "plugins", "session_id"]) {
    if (options[key] !== undefined) picked[key] = options[key];
  }
  return Object.keys(picked).length > 0 ? picked : null;
}

function traceAutoPlan(plan) {
  return {
    mode: plan.mode,
    profile: plan.profile,
    rationale: plan.rationale,
    task: plan.task,
    strategy: plan.strategy,
    session: plan.session,
    selected: plan.selected,
    candidates: plan.candidates,
    phases: plan.phases
  };
}

function explainAutoPlan({ mode, task, selected, session }) {
  const picked = selected.map((candidate) => `${candidate.role}:${candidate.model}`).join(", ");
  const sticky = session.hit ? " Reused sticky session pins where applicable." : "";
  if (mode === "fast-single") return `Selected one fast candidate for a low-risk ${task.type} task: ${picked}.${sticky}`;
  if (mode === "smart-single") return `Selected one task-fit candidate for ${task.type}: ${picked}.${sticky}`;
  if (mode === "single-verify") return `Selected a primary model plus verifier for an important ${task.type} task: ${picked}.${sticky}`;
  return `Selected full fusion because the task is complex or high-risk: ${picked}.${sticky}`;
}

function finishTrace(trace, context) {
  trace.completedAt = new Date().toISOString();
  trace.latencyMs = trace.phases.reduce((total, phase) => total + phase.latencyMs, 0);
  const entry = persistAutoSession({ trace, context });
  if (trace.auto?.session && entry) {
    trace.auto.session.updated = true;
    trace.auto.session.expires_at = new Date(entry.expiresAt).toISOString();
    trace.auto.session.pins = entry.pins;
  }
}

function createTraceId() {
  return `of_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function mergePlain(...items) {
  const output = {};
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    for (const [key, value] of Object.entries(item)) {
      if (isPlainObject(value) && isPlainObject(output[key])) {
        output[key] = mergePlain(output[key], value);
      } else if (value !== undefined) {
        output[key] = value;
      }
    }
  }
  return output;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function readMetric(value, path) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

function firstDefined(...items) {
  return items.find((item) => item !== undefined && item !== null);
}

function normalizePercentile(value) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return normalizedScore(numeric);
}

function normalizedScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return numeric > 1 ? clamp01(numeric / 100) : clamp01(numeric);
}

function availabilityValue(candidate) {
  if (candidate.available === false || candidate.availability === false) return false;
  return normalizedScore(candidate.availability ?? candidate.reliability ?? 0.75);
}

function numberPreference(value) {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? normalizedScore(numeric) : null;
}

function taskPreference(value, task) {
  if (value == null) return null;
  if (typeof value === "number") return normalizedScore(value);
  if (typeof value !== "object") return null;
  return numberPreference(value[skillKeyForTask(task)] ?? value[task.primaryRole] ?? value.general);
}

function maxPricePreference(value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value !== "object") return null;
  const input = value.inputUsdPer1M;
  const output = value.outputUsdPer1M;
  if (Number.isFinite(input) && Number.isFinite(output)) {
    return Math.max(input, output);
  }
  return numericOrNull(value.usdPer1M ?? value.blendedUsdPer1M);
}

function numericOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundObject(object) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, roundScore(value)]));
}

function cleanString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function roundScore(value) {
  return Math.round(clamp01(value) * 1000) / 1000;
}
