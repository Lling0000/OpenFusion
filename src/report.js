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
    "",
    `Overall: **${result.ok ? "PASS" : "FAIL"}**`
  ].join("\n");
}

function escapePipes(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}
