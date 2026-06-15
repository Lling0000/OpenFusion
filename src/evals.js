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
