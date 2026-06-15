#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const checks = [
  ["npm", ["test"]],
  ["npm", ["run", "smoke"]],
  ["npm", ["run", "doctor"]],
  ["node", ["scripts/validate-provider-reports.js"]],
  ["node", ["scripts/package-smoke.js"]],
  ["node", ["scripts/secret-scan.js"]]
];

for (const [command, args] of checks) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\nOpenFusion release checks passed.");
