#!/usr/bin/env node
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tempDir = await mkdtemp(join(tmpdir(), "openfusion-package-"));
const packDir = join(tempDir, "pack");
const installDir = join(tempDir, "install");

try {
  await mkdir(packDir, { recursive: true });
  await mkdir(installDir, { recursive: true });

  const pack = run("npm", ["pack", "--json", "--pack-destination", packDir], { capture: true });
  const [artifact] = JSON.parse(pack.stdout);
  if (!artifact?.filename) {
    throw new Error("npm pack did not return a package filename.");
  }

  const tarball = join(packDir, artifact.filename);
  run("npm", ["init", "-y"], { cwd: installDir, quiet: true });
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], { cwd: installDir, quiet: true });

  run(binPath("openfusion"), ["doctor"], { cwd: installDir, quiet: true });

  const adapter = run(binPath("openfusion"), ["adapter", "codex", "--json"], {
    cwd: installDir,
    capture: true
  });
  if (!adapter.stdout.trim()) {
    throw new Error("Packaged openfusion adapter command produced no output.");
  }

  const guide = JSON.parse(adapter.stdout);
  if (guide.local?.model !== "openfusion/fusion") {
    throw new Error("Packaged CLI returned an unexpected Codex adapter model.");
  }
  if (!guide.commands?.serveDryRun?.startsWith("openfusion serve")) {
    throw new Error("Packaged Codex adapter guide should use the openfusion bin command.");
  }

  console.log(`Package smoke passed: ${artifact.filename}`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function run(command, args, { cwd = process.cwd(), capture = false, quiet = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
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
