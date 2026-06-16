#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";

const requiredFiles = [
  "examples/README.md",
  "examples/quickstart/README.md",
  "examples/quickstart/chat-request.json",
  "examples/quickstart/route-request.json",
  "examples/codex-local-adapter/README.md",
  "examples/codex-local-adapter/config.toml.example",
  "examples/codex-local-adapter/env.example",
  "examples/codex-local-adapter/verify.sh",
  "examples/aider-local-adapter/README.md",
  "examples/aider-local-adapter/env.example",
  "examples/aider-local-adapter/verify.sh",
  "examples/eval-receipt/README.md",
  "examples/tool-passthrough/README.md",
  "examples/tool-passthrough/tool-request.json",
  "examples/tool-passthrough/tool-follow-up.json",
  "examples/provider-compat/README.md",
  "examples/real-relay-openrouter/README.md",
  "examples/real-relay-openrouter/openfusion.config.example.json",
  "examples/real-relay-openrouter/env.example",
  "examples/real-relay-openrouter/verify.sh"
];

const requiredText = {
  "examples/README.md": ["quickstart", "codex-local-adapter", "aider-local-adapter", "eval-receipt", "tool-passthrough", "provider-compat", "real-relay-openrouter", "verify.sh"],
  "examples/quickstart/README.md": ["openfusion serve --dry-run", "/v1/chat/completions", "/debug/route"],
  "examples/codex-local-adapter/README.md": ["~/.codex/config.toml", "OPENFUSION_API_KEY", "OPENFUSION_BASE_URL", "tool protocol"],
  "examples/aider-local-adapter/README.md": ["~/.aider.conf.yml", "AIDER_OPENAI_API_BASE", "openai/openfusion/fusion", "tool protocol"],
  "examples/eval-receipt/README.md": ["openfusion eval --dry-run", "openfusion receipt --dry-run", "hasPhaseTrace"],
  "examples/tool-passthrough/README.md": ["tool-passthrough", "role: \"tool\"", "fusion.toolRole"],
  "examples/provider-compat/README.md": ["openfusion compat", "docs/providers", "npm run check:providers"],
  "examples/real-relay-openrouter/README.md": ["OPENROUTER_API_KEY", "doctor --real", "verify.sh", "Real mode fans ordinary requests"]
};

const failures = [];

for (const file of requiredFiles) {
  try {
    if (!statSync(file).isFile()) {
      failures.push(`${file}: not a file`);
      continue;
    }
  } catch {
    failures.push(`${file}: missing`);
    continue;
  }

  if (file.endsWith(".json")) {
    try {
      JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      failures.push(`${file}: invalid JSON: ${error.message}`);
    }
  }
}

for (const [file, markers] of Object.entries(requiredText)) {
  const text = readFileSync(file, "utf8");
  for (const marker of markers) {
    if (!text.includes(marker)) {
      failures.push(`${file}: missing ${marker}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Example validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Example validation passed.");
