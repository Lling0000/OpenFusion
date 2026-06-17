#!/usr/bin/env node
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tempDir = await mkdtemp(join(tmpdir(), "openfusion-package-"));
const packDir = join(tempDir, "pack");
const installDir = join(tempDir, "install");
const npmCacheDir = join(tempDir, "npm-cache");

try {
  await mkdir(packDir, { recursive: true });
  await mkdir(installDir, { recursive: true });
  await mkdir(npmCacheDir, { recursive: true });

  const pack = run("npm", ["pack", "--json", "--pack-destination", packDir], { capture: true });
  const [artifact] = JSON.parse(pack.stdout);
  if (!artifact?.filename) {
    throw new Error("npm pack did not return a package filename.");
  }

  const tarball = join(packDir, artifact.filename);
  run("npm", ["init", "-y"], { cwd: installDir, quiet: true });
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], { cwd: installDir, quiet: true });

  const help = run(binPath("openfusion"), ["--help"], { cwd: installDir, capture: true });
  if (!help.stdout.includes("Usage:")) {
    throw new Error("Packaged openfusion --help did not print usage text.");
  }

  run(binPath("openfusion"), ["doctor"], { cwd: installDir, quiet: true });

  const dryRun = run(binPath("openfusion"), ["--dry-run", "--json", "Review this Codex relay patch"], {
    cwd: installDir,
    capture: true
  });
  const dryRunResult = JSON.parse(dryRun.stdout);
  if (!Array.isArray(dryRunResult.route?.selectedRoles) || dryRunResult.route.selectedRoles.length < 2) {
    throw new Error("Packaged openfusion dry-run did not return a multi-role route.");
  }

  const route = run(binPath("openfusion"), ["route", "--json", "Review this Codex relay patch"], {
    cwd: installDir,
    capture: true
  });
  const routeJson = JSON.parse(route.stdout);
  if (routeJson.schema !== "openfusion.route_preview.v1" || !routeJson.budget?.withinBudget) {
    throw new Error("Packaged openfusion route command did not return a valid route preview.");
  }
  if (!Array.isArray(routeJson.panel) || routeJson.panel.length < 2) {
    throw new Error("Packaged openfusion route command did not include a multi-role panel preview.");
  }

  const receipt = run(binPath("openfusion"), ["receipt", "--dry-run", "Review this packaged CLI route"], {
    cwd: installDir,
    capture: true
  });
  const receiptJson = JSON.parse(receipt.stdout);
  if (receiptJson.schema !== "openfusion.fusion_receipt.v1" || !receiptJson.verdict?.hasPhaseTrace) {
    throw new Error("Packaged openfusion receipt command did not return a valid phase trace receipt.");
  }

  const comparison = run(binPath("openfusion"), ["compare", "--dry-run", "--json"], {
    cwd: installDir,
    capture: true
  });
  const comparisonJson = JSON.parse(comparison.stdout);
  if (comparisonJson.schema !== "openfusion.comparison_receipt.v1" || comparisonJson.summary?.failed !== 0) {
    throw new Error("Packaged openfusion compare command did not return a passing comparison receipt.");
  }
  if (!comparisonJson.summary?.routingDiversity?.hasDistinctPanels) {
    throw new Error("Packaged openfusion compare command did not prove distinct fusion panels.");
  }

  const adapter = run(binPath("openfusion"), ["adapter", "codex", "--json"], {
    cwd: installDir,
    capture: true
  });
  if (!adapter.stdout.trim()) {
    throw new Error("Packaged openfusion adapter command produced no output.");
  }

  const guide = JSON.parse(adapter.stdout);
  if (guide.local?.model !== "openfusion/auto") {
    throw new Error("Packaged CLI returned an unexpected Codex adapter model.");
  }
  if (!guide.codex?.configToml?.includes('model_provider = "openfusion"')) {
    throw new Error("Packaged Codex adapter guide did not include a Codex config.toml snippet.");
  }
  if (!guide.commands?.serveDryRun?.startsWith("openfusion serve")) {
    throw new Error("Packaged Codex adapter guide should use the openfusion bin command.");
  }

  const codexSnippet = run(binPath("openfusion"), ["codex", "snippet", "--json"], {
    cwd: installDir,
    capture: true
  });
  const codexSnippetJson = JSON.parse(codexSnippet.stdout);
  if (!codexSnippetJson.configToml?.includes('model = "openfusion/auto"')) {
    throw new Error("Packaged codex snippet did not default to openfusion/auto.");
  }

  const codexSwitch = run(binPath("openfusion"), [
    "codex",
    "enable-auto",
    "--codex-config",
    "./codex.test.toml",
    "--no-backup",
    "--json"
  ], {
    cwd: installDir,
    capture: true
  });
  const codexSwitchJson = JSON.parse(codexSwitch.stdout);
  if (codexSwitchJson.targetModel !== "openfusion/auto" || !codexSwitchJson.status?.autoEnabled) {
    throw new Error("Packaged codex enable-auto command did not enable the Auto switch.");
  }

  console.log(`Package smoke passed: ${artifact.filename}`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function run(command, args, { cwd = process.cwd(), capture = false, quiet = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: process.env.npm_config_cache ?? npmCacheDir
    },
    shell: process.platform === "win32",
    stdio: capture ? ["ignore", "pipe", "pipe"] : quiet ? "ignore" : "inherit"
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed.${output ? `\n${output}` : ""}`);
  }

  return result;
}

function binPath(name) {
  return process.platform === "win32"
    ? join("node_modules", ".bin", `${name}.cmd`)
    : join("node_modules", ".bin", name);
}
