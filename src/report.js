export function renderDoctorMarkdown(result) {
  const title = result.probeURL
    ? `# OpenFusion Compatibility Report\n\nEndpoint: \`${result.probeURL}\`\n`
    : "# OpenFusion Doctor Report\n";

  const rows = [
    "| Check | Status | Details |",
    "| --- | --- | --- |",
    ...result.checks.map((item) => `| \`${escapePipes(item.name)}\` | ${item.ok ? "PASS" : "FAIL"} | ${escapePipes(item.message)} |`)
  ];

  return [
    title,
    `Mode: \`${result.mode}\``,
    "",
    rows.join("\n"),
    ...renderFusionSummary(result.fusionSummary),
    "",
    `Overall: **${result.ok ? "PASS" : "FAIL"}**`
  ].join("\n");
}

function renderFusionSummary(summary) {
  if (!summary) return [];

  const phaseRows = [
    "| Phase | Role | Model | Latency | Upstream | Usage |",
    "| --- | --- | --- | --- | --- | --- |",
    ...summary.trace.phases.map((phase) => [
      escapePipes(phase.phase),
      `\`${escapePipes(phase.role)}\``,
      `\`${escapePipes(phase.model)}\``,
      formatLatency(phase.latencyMs),
      phase.upstreamId ? `\`${escapePipes(phase.upstreamId)}\`` : "-",
      phase.hasUsage ? "yes" : "no"
    ].join(" | ")).map((row) => `| ${row} |`)
  ];

  return [
    "",
    "## Fusion Receipt Summary",
    "",
    `Prompt SHA-256: \`${summary.promptSha256}\``,
    `Route: ${summary.route.selectedRoles.map((role) => `\`${escapePipes(role)}\``).join(", ")}`,
    `Judge: \`${escapePipes(summary.judge.role)}:${escapePipes(summary.judge.model)}\``,
    `Synthesizer: \`${escapePipes(summary.synthesizer.role)}:${escapePipes(summary.synthesizer.model)}\``,
    `Trace: \`${escapePipes(summary.trace.id)}\` (${summary.trace.phaseCount} phases, ${formatLatency(summary.trace.latencyMs)})`,
    "",
    phaseRows.join("\n"),
    "",
    `Evidence: ${renderEvidence(summary.evidence)}.`
  ];
}

function renderEvidence(evidence) {
  const labels = [];
  if (evidence.hasMultiplePanelRoles) labels.push("multiple panel roles");
  if (evidence.hasJudgeNotes) labels.push("judge notes");
  if (evidence.hasSynthesis) labels.push("synthesis");
  if (evidence.hasPhaseTrace) labels.push("phase trace");
  return labels.length ? labels.join(", ") : "not enough fusion evidence";
}

function formatLatency(value) {
  return Number.isFinite(value) ? `${value} ms` : "-";
}

function escapePipes(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}
