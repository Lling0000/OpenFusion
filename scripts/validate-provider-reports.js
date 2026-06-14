#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = "docs/providers";
const required = [
  "- Date:",
  "- OpenFusion commit:",
  "- Provider or relay version:",
  "- Command:",
  "## Result",
  "## Notes"
];
const matrixChecks = [
  "probe.models",
  "probe.chat",
  "probe.chat.stream",
  "probe.tool.roundtrip"
];
const failures = [];

for (const entry of readdirSync(dir)) {
  if (!entry.endsWith(".md") || entry === "README.md") continue;

  const path = join(dir, entry);
  if (!statSync(path).isFile()) continue;

  const text = readFileSync(path, "utf8");
  for (const marker of required) {
    if (!text.includes(marker)) {
      failures.push(`${path}: missing ${marker}`);
    }
  }

  for (const check of matrixChecks) {
    if (!text.includes(check)) {
      failures.push(`${path}: missing ${check}`);
    }
  }

  if (!text.includes("Overall: **")) {
    failures.push(`${path}: missing Overall status`);
  }
}

if (failures.length > 0) {
  console.error("Provider report validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Provider report validation passed.");
