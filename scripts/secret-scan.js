#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ignoredDirs = new Set([".git", "node_modules", "coverage"]);
const ignoredFiles = new Set(["package-lock.json"]);
const suspicious = [
  /BEGIN (RSA|OPENSSH|PRIVATE) KEY/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}/,
  /\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/i
];
const allowedPlaceholders = [
  "any-local-placeholder",
  "YOUR_RELAY_API_KEY",
  "OPENROUTER_API_KEY",
  "..."
];

const findings = [];

scan(".");

if (findings.length > 0) {
  console.error("Potential secrets found:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log("Secret scan passed.");

function scan(dir) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      scan(path);
      continue;
    }

    if (ignoredFiles.has(entry) || stat.size > 1_000_000) continue;
    const text = readFileSync(path, "utf8");
    const lines = text.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (allowedPlaceholders.some((placeholder) => line.includes(placeholder))) {
        return;
      }

      if (line.includes("process.env")) {
        return;
      }

      if (suspicious.some((pattern) => pattern.test(line))) {
        findings.push(`${path}:${index + 1}`);
      }
    });
  }
}
