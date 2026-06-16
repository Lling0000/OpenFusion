import { createHash } from "node:crypto";
import { runFusion } from "./fusion.js";

export const defaultEvalCases = [
  {
    id: "coding-review",
    prompt: "Review this Node.js API patch for bugs, security risks, and missing tests.",
    expectedRoles: ["coder", "verifier"]
  },
  {
    id: "architecture-tradeoff",
    prompt: "Compare two architectures for a Codex API relay and choose the safer design.",
    expectedRoles: ["reasoner", "verifier"]
  },
  {
    id: "docs-polish",
    prompt: "Rewrite this README section so new users understand the setup steps.",
    expectedRoles: ["writer"]
  }
];

export async function runEvalSuite({ config, client, cases = defaultEvalCases } = {}) {
  const startedAt = new Date().toISOString();
  const results = [];

  for (const item of cases) {
    const fusion = await runFusion({
      question: item.prompt,
      config,
      client
    });
    const selected = fusion.route.selectedRoles;
    const missingRoles = item.expectedRoles.filter((role) => !selected.includes(role));

    results.push({
      id: item.id,
      prompt: item.prompt,
      promptSha256: sha256(item.prompt),
      expectedRoles: item.expectedRoles,
      selectedRoles: selected,
      missingRoles,
      ok: missingRoles.length === 0,
      route: fusion.route,
      panel: fusion.panel.map(({ role, model }) => ({ role, model })),
      judge: {
        role: fusion.judge.role,
        model: fusion.judge.model
      },
      synthesizer: {
        role: fusion.final.role,
        model: fusion.final.model
      },
      evidence: fusionEvidence(fusion),
      trace: traceSummary(fusion.trace)
    });
  }

  const passed = results.filter((item) => item.ok).length;

  return {
    object: "openfusion.eval_receipt",
    schema: "openfusion.eval_receipt.v1",
    startedAt,
    mode: client.constructor?.name === "MockChatClient" ? "dry-run" : "real",
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      routingDiversity: routingDiversity(results)
    },
    results
  };
}

export async function runComparisonSuite({ config, client, cases = defaultEvalCases, baselineRole = "fast" } = {}) {
  if (!config.roles[baselineRole]) {
    throw new Error(`Unknown baseline role: ${baselineRole}`);
  }

  const startedAt = new Date().toISOString();
  const baselineConfig = config.roles[baselineRole];
  const results = [];

  for (const item of cases) {
    const baselineStarted = Date.now();
    const baseline = await client.complete({
      phase: "baseline",
      role: baselineRole,
      model: baselineConfig.model,
      messages: [{ role: "user", content: item.prompt }],
      metadata: { phase: "baseline", role: baselineRole }
    });
    const baselineLatencyMs = Date.now() - baselineStarted;
    const fusion = await runFusion({
      question: item.prompt,
      config,
      client
    });

    results.push({
      id: item.id,
      prompt: item.prompt,
      promptSha256: sha256(item.prompt),
      expectedRoles: item.expectedRoles,
      baseline: {
        role: baselineRole,
        model: baseline.model ?? baselineConfig.model,
        latencyMs: baselineLatencyMs,
        contentSha256: sha256(baseline.content),
        contentExcerpt: excerpt(baseline.content),
        upstreamId: baseline.raw?.id ?? null,
        usage: baseline.raw?.usage ?? null
      },
      fusion: {
        selectedRoles: fusion.route.selectedRoles,
        panel: fusion.panel.map(({ role, model }) => ({ role, model })),
        judge: {
          role: fusion.judge.role,
          model: fusion.judge.model,
          contentSha256: sha256(fusion.judge.content),
          contentExcerpt: excerpt(fusion.judge.content)
        },
        synthesizer: {
          role: fusion.final.role,
          model: fusion.final.model,
          contentSha256: sha256(fusion.final.content),
          contentExcerpt: excerpt(fusion.final.content)
        },
        trace: traceSummary(fusion.trace)
      },
      verdict: {
        hasBaselineAnswer: Boolean(baseline.content),
        hasMultipleFusionRoles: fusion.panel.length >= 2,
        hasJudgeNotes: Boolean(fusion.judge.content),
        hasFusionSynthesis: Boolean(fusion.final.content),
        hasDistinctFusionPath: fusion.panel.length > 1 || fusion.panel[0]?.model !== (baseline.model ?? baselineConfig.model)
      }
    });
  }

  const passed = results.filter((item) => (
    item.verdict.hasBaselineAnswer &&
    item.verdict.hasMultipleFusionRoles &&
    item.verdict.hasJudgeNotes &&
    item.verdict.hasFusionSynthesis &&
    item.verdict.hasDistinctFusionPath
  )).length;

  return {
    object: "openfusion.comparison_receipt",
    schema: "openfusion.comparison_receipt.v1",
    startedAt,
    mode: client.constructor?.name === "MockChatClient" ? "dry-run" : "real",
    baselineRole,
    baselineModel: baselineConfig.model,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      routingDiversity: routingDiversity(results.map((item) => ({
        id: item.id,
        selectedRoles: item.fusion.selectedRoles
      })))
    },
    results
  };
}

export async function runQualityComparisonSuite({
  config,
  client,
  cases = defaultEvalCases,
  baselineRole = "fast",
  graderRole = "verifier"
} = {}) {
  if (!config.roles[baselineRole]) {
    throw new Error(`Unknown baseline role: ${baselineRole}`);
  }
  if (!config.roles[graderRole]) {
    throw new Error(`Unknown grader role: ${graderRole}`);
  }

  const startedAt = new Date().toISOString();
  const baselineConfig = config.roles[baselineRole];
  const graderConfig = config.roles[graderRole];
  const results = [];

  for (const item of cases) {
    const baseline = await client.complete({
      phase: "baseline",
      role: baselineRole,
      model: baselineConfig.model,
      messages: [{ role: "user", content: item.prompt }],
      metadata: { phase: "baseline", role: baselineRole }
    });
    const fusion = await runFusion({
      question: item.prompt,
      config,
      client
    });
    const grading = await client.complete({
      phase: "grading",
      role: graderRole,
      model: graderConfig.model,
      messages: qualityJudgePrompt({
        question: item.prompt,
        baselineRole,
        baselineModel: baseline.model ?? baselineConfig.model,
        baselineContent: baseline.content,
        fusion
      }),
      metadata: { phase: "grading", role: graderRole }
    });
    const grade = parseQualityGrade(grading.content);

    results.push({
      id: item.id,
      prompt: item.prompt,
      promptSha256: sha256(item.prompt),
      expectedRoles: item.expectedRoles,
      baseline: {
        role: baselineRole,
        model: baseline.model ?? baselineConfig.model,
        contentSha256: sha256(baseline.content),
        contentExcerpt: excerpt(baseline.content),
        upstreamId: baseline.raw?.id ?? null,
        usage: baseline.raw?.usage ?? null
      },
      fusion: {
        selectedRoles: fusion.route.selectedRoles,
        panel: fusion.panel.map(({ role, model }) => ({ role, model })),
        judge: {
          role: fusion.judge.role,
          model: fusion.judge.model,
          contentSha256: sha256(fusion.judge.content),
          contentExcerpt: excerpt(fusion.judge.content)
        },
        synthesizer: {
          role: fusion.final.role,
          model: fusion.final.model,
          contentSha256: sha256(fusion.final.content),
          contentExcerpt: excerpt(fusion.final.content)
        },
        trace: traceSummary(fusion.trace)
      },
      grading: {
        role: graderRole,
        model: grading.model ?? graderConfig.model,
        raw: grading.content,
        contentSha256: sha256(grading.content),
        contentExcerpt: excerpt(grading.content),
        upstreamId: grading.raw?.id ?? null,
        usage: grading.raw?.usage ?? null,
        ...grade
      }
    });
  }

  const fusionWins = results.filter((item) => item.grading.winner === "fusion").length;
  const baselineWins = results.filter((item) => item.grading.winner === "baseline").length;
  const ties = results.filter((item) => item.grading.winner === "tie").length;
  const parsed = results.filter((item) => item.grading.parsed).length;

  return {
    object: "openfusion.quality_comparison_receipt",
    schema: "openfusion.quality_comparison_receipt.v1",
    startedAt,
    mode: client.constructor?.name === "MockChatClient" ? "dry-run" : "real",
    baselineRole,
    baselineModel: baselineConfig.model,
    graderRole,
    graderModel: graderConfig.model,
    summary: {
      total: results.length,
      parsed,
      fusionWins,
      baselineWins,
      ties,
      gradingCoverage: parsed === results.length
    },
    results
  };
}

export function renderEvalMarkdown(receipt) {
  const rows = [
    "| Case | Status | Expected Roles | Selected Roles | Trace | Judge | Synthesizer |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...receipt.results.map((item) => [
      `| \`${escapePipes(item.id)}\``,
      item.ok ? "PASS" : "FAIL",
      item.expectedRoles.map((role) => `\`${role}\``).join(", "),
      item.selectedRoles.map((role) => `\`${role}\``).join(", "),
      `\`${item.trace.id}\` (${item.trace.phaseCount} phases)`,
      `\`${item.judge.role}:${item.judge.model}\``,
      `\`${item.synthesizer.role}:${item.synthesizer.model}\` |`
    ].join(" | "))
  ];

  const failures = receipt.results
    .filter((item) => !item.ok)
    .map((item) => `- \`${item.id}\` missing ${item.missingRoles.map((role) => `\`${role}\``).join(", ")}`);

  return [
    "# OpenFusion Eval Receipt",
    "",
    `Mode: \`${receipt.mode}\``,
    `Started: \`${receipt.startedAt}\``,
    `Overall: **${receipt.summary.failed === 0 ? "PASS" : "FAIL"}** (${receipt.summary.passed}/${receipt.summary.total})`,
    "",
    rows.join("\n"),
    "",
    renderRoutingDiversityMarkdown(receipt.summary.routingDiversity),
    ...(failures.length ? ["", "## Missing Expected Roles", "", failures.join("\n")] : []),
    "",
    "This receipt validates routing and orchestration behavior. It does not prove answer quality without real provider calls and task-specific grading."
  ].join("\n");
}

export function renderComparisonMarkdown(receipt) {
  const rows = [
    "| Case | Status | Baseline | Fusion Panel | Judge | Synthesizer |",
    "| --- | --- | --- | --- | --- | --- |",
    ...receipt.results.map((item) => [
      `| \`${escapePipes(item.id)}\``,
      comparisonOk(item) ? "PASS" : "FAIL",
      `\`${escapePipes(item.baseline.role)}:${escapePipes(item.baseline.model)}\``,
      item.fusion.selectedRoles.map((role) => `\`${escapePipes(role)}\``).join(" + "),
      `\`${escapePipes(item.fusion.judge.role)}:${escapePipes(item.fusion.judge.model)}\``,
      `\`${escapePipes(item.fusion.synthesizer.role)}:${escapePipes(item.fusion.synthesizer.model)}\` |`
    ].join(" | "))
  ];

  return [
    "# OpenFusion Single-vs-Fusion Comparison Receipt",
    "",
    `Mode: \`${receipt.mode}\``,
    `Started: \`${receipt.startedAt}\``,
    `Baseline: \`${receipt.baselineRole}:${receipt.baselineModel}\``,
    `Overall: **${receipt.summary.failed === 0 ? "PASS" : "FAIL"}** (${receipt.summary.passed}/${receipt.summary.total})`,
    "",
    rows.join("\n"),
    "",
    renderRoutingDiversityMarkdown(receipt.summary.routingDiversity),
    "",
    "This receipt proves the same prompts were exercised through one baseline model and the OpenFusion multi-stage route. It is orchestration evidence, not an automatic quality win claim; use real mode plus task-specific grading for quality comparisons."
  ].join("\n");
}

export function renderQualityComparisonMarkdown(receipt) {
  const rows = [
    "| Case | Winner | Baseline | Fusion Panel | Grader |",
    "| --- | --- | --- | --- | --- |",
    ...receipt.results.map((item) => [
      `| \`${escapePipes(item.id)}\``,
      item.grading.winner.toUpperCase(),
      `\`${escapePipes(item.baseline.role)}:${escapePipes(item.baseline.model)}\``,
      item.fusion.selectedRoles.map((role) => `\`${escapePipes(role)}\``).join(" + "),
      `\`${escapePipes(item.grading.role)}:${escapePipes(item.grading.model)}\` |`
    ].join(" | "))
  ];

  return [
    "# OpenFusion Quality Comparison Receipt",
    "",
    `Mode: \`${receipt.mode}\``,
    `Started: \`${receipt.startedAt}\``,
    `Baseline: \`${receipt.baselineRole}:${receipt.baselineModel}\``,
    `Grader: \`${receipt.graderRole}:${receipt.graderModel}\``,
    `Fusion wins: **${receipt.summary.fusionWins}**`,
    `Baseline wins: **${receipt.summary.baselineWins}**`,
    `Ties: **${receipt.summary.ties}**`,
    "",
    rows.join("\n"),
    "",
    "This receipt adds model-graded quality evidence on top of orchestration evidence. Treat the grader as another model judgment, not as ground truth."
  ].join("\n");
}

export function buildFusionReceipt({ fusion, mode = "dry-run", id = "single-prompt" }) {
  return {
    object: "openfusion.fusion_receipt",
    schema: "openfusion.fusion_receipt.v1",
    id,
    createdAt: new Date().toISOString(),
    mode,
    promptSha256: sha256(fusion.question),
    route: fusion.route,
    panel: fusion.panel.map((item) => ({
      role: item.role,
      model: item.model,
      contentSha256: sha256(item.content),
      contentExcerpt: excerpt(item.content)
    })),
    judge: {
      role: fusion.judge.role,
      model: fusion.judge.model,
      contentSha256: sha256(fusion.judge.content),
      contentExcerpt: excerpt(fusion.judge.content)
    },
    synthesizer: {
      role: fusion.final.role,
      model: fusion.final.model,
      contentSha256: sha256(fusion.final.content),
      contentExcerpt: excerpt(fusion.final.content)
    },
    trace: traceSummary(fusion.trace),
    verdict: {
      hasMultiplePanelRoles: fusion.panel.length >= 2,
      hasJudgeNotes: Boolean(fusion.judge.content),
      hasSynthesis: Boolean(fusion.final.content),
      hasPhaseTrace: Boolean(fusion.trace?.phases?.length)
    }
  };
}

function comparisonOk(item) {
  return item.verdict.hasBaselineAnswer &&
    item.verdict.hasMultipleFusionRoles &&
    item.verdict.hasJudgeNotes &&
    item.verdict.hasFusionSynthesis &&
    item.verdict.hasDistinctFusionPath;
}

function qualityJudgePrompt({ question, baselineRole, baselineModel, baselineContent, fusion }) {
  return [
    {
      role: "system",
      content: [
        "You are the OpenFusion quality judge.",
        "Compare two candidate answers for the same task: one baseline answer and one fused answer.",
        "Judge helpfulness, correctness, risk awareness, and actionability.",
        "Return strict Markdown with these headings only: Winner, Score, Rationale, Risks.",
        "Winner must be exactly one of: fusion, baseline, tie.",
        "Score must be one short line like: fusion 8/10, baseline 6/10."
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `## Original question\n${question}`,
        "",
        `## Baseline (${baselineRole}:${baselineModel})`,
        baselineContent,
        "",
        "## Fusion route",
        fusion.route.rationale,
        "",
        "## Fusion panel",
        ...fusion.panel.map((response) => `### ${response.role} (${response.model})\n${response.content}`),
        "",
        `## Fusion judge (${fusion.judge.role}:${fusion.judge.model})`,
        fusion.judge.content,
        "",
        `## Fusion final (${fusion.final.role}:${fusion.final.model})`,
        fusion.final.content
      ].join("\n")
    }
  ];
}

function parseQualityGrade(content) {
  const text = String(content ?? "");
  const winnerMatch = text.match(/^##\s*Winner\s*\n+([^\n]+)/im);
  const scoreMatch = text.match(/^##\s*Score\s*\n+([^\n]+)/im);
  const rationaleMatch = text.match(/^##\s*Rationale\s*\n+([\s\S]*?)(?:\n##\s*Risks|\s*$)/im);
  const risksMatch = text.match(/^##\s*Risks\s*\n+([\s\S]*?)\s*$/im);
  const normalizedWinner = winnerMatch?.[1]?.trim().toLowerCase();
  const winner = ["fusion", "baseline", "tie"].includes(normalizedWinner) ? normalizedWinner : "unknown";

  return {
    parsed: Boolean(winnerMatch && scoreMatch),
    winner,
    scoreLine: scoreMatch?.[1]?.trim() ?? null,
    rationale: rationaleMatch?.[1]?.trim() ?? null,
    risks: risksMatch?.[1]?.trim() ?? null
  };
}

function fusionEvidence(fusion) {
  return {
    panel: fusion.panel.map((item) => ({
      role: item.role,
      model: item.model,
      contentSha256: sha256(item.content),
      contentExcerpt: excerpt(item.content)
    })),
    judge: {
      role: fusion.judge.role,
      model: fusion.judge.model,
      contentSha256: sha256(fusion.judge.content),
      contentExcerpt: excerpt(fusion.judge.content)
    },
    synthesizer: {
      role: fusion.final.role,
      model: fusion.final.model,
      contentSha256: sha256(fusion.final.content)
    }
  };
}

function routingDiversity(results) {
  const panelSignatures = results.map((item) => ({
    caseId: item.id,
    signature: item.selectedRoles.join("+"),
    selectedRoles: item.selectedRoles
  }));
  const uniqueSignatures = [...new Set(panelSignatures.map((item) => item.signature))];
  const roleUsage = {};

  for (const item of panelSignatures) {
    for (const role of item.selectedRoles) {
      roleUsage[role] = (roleUsage[role] ?? 0) + 1;
    }
  }

  return {
    uniquePanelCount: uniqueSignatures.length,
    totalCases: results.length,
    hasDistinctPanels: uniqueSignatures.length > 1,
    roleCoverage: Object.keys(roleUsage).sort(),
    roleUsage,
    panelSignatures
  };
}

function renderRoutingDiversityMarkdown(diversity) {
  if (!diversity) return "";

  const rows = [
    "| Case | Panel Signature |",
    "| --- | --- |",
    ...diversity.panelSignatures.map((item) => [
      `| \`${escapePipes(item.caseId)}\``,
      `${item.selectedRoles.map((role) => `\`${escapePipes(role)}\``).join(" + ")} |`
    ].join(" | "))
  ];

  return [
    "## Routing Diversity",
    "",
    `Unique panels: **${diversity.uniquePanelCount}/${diversity.totalCases}**`,
    `Role coverage: ${diversity.roleCoverage.map((role) => `\`${escapePipes(role)}\``).join(", ")}`,
    `Distinct routing: **${diversity.hasDistinctPanels ? "yes" : "no"}**`,
    "",
    rows.join("\n")
  ].join("\n");
}

function traceSummary(trace = {}) {
  return {
    id: trace.id,
    startedAt: trace.startedAt,
    completedAt: trace.completedAt,
    latencyMs: trace.latencyMs,
    budget: trace.budget,
    phaseCount: trace.phases?.length ?? 0,
    phases: (trace.phases ?? []).map((phase) => ({
      phase: phase.phase,
      role: phase.role,
      model: phase.model,
      latencyMs: phase.latencyMs,
      upstreamId: phase.upstreamId,
      usage: phase.usage
    }))
  };
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function excerpt(value, limit = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function escapePipes(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}
