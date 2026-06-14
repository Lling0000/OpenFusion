import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { probeEndpoint } from "./probe.js";

export async function loadCompatTargets({ configPath, targetSpecs = [] } = {}) {
  const fileTargets = configPath ? await readTargetsFile(configPath) : [];
  const cliTargets = targetSpecs.map(parseTargetSpec);
  return [...fileTargets, ...cliTargets];
}

export async function runCompatibilityMatrix({ targets, timeoutMs = 10000 } = {}) {
  const results = [];

  for (const target of targets) {
    const apiKey = target.apiKeyEnv ? process.env[target.apiKeyEnv] : undefined;
    const probe = await probeEndpoint({
      baseURL: target.baseURL,
      model: target.model,
      apiKey,
      timeoutMs
    });

    results.push({
      name: target.name,
      apiKeyEnv: target.apiKeyEnv ?? null,
      ...probe
    });
  }

  return {
    ok: results.every((result) => result.ok),
    results
  };
}

export function renderCompatibilityMatrixMarkdown(matrix) {
  const checkNames = [...new Set(matrix.results.flatMap((result) => result.checks.map((check) => check.name)))];
  const header = ["| Target | Model |", ...checkNames.map((name) => ` \`${name}\` |`)].join("");
  const divider = ["| --- | --- |", ...checkNames.map(() => " --- |")].join("");
  const rows = matrix.results.map((result) => {
    const checksByName = new Map(result.checks.map((check) => [check.name, check]));
    const cells = checkNames.map((name) => checksByName.get(name)?.ok ? "PASS" : "FAIL");
    return [`| ${escapePipes(result.name)} | \`${escapePipes(result.model)}\` |`, ...cells.map((cell) => ` ${cell} |`)].join("");
  });

  return [
    "# OpenFusion Provider Compatibility Matrix",
    "",
    header,
    divider,
    ...rows,
    "",
    `Overall: **${matrix.ok ? "PASS" : "FAIL"}**`
  ].join("\n");
}

function parseTargetSpec(spec) {
  const [name, baseURL, model = "openfusion/fusion", apiKeyEnv] = spec.split("|");

  if (!name || !baseURL) {
    throw new Error("Target must use name|baseURL|model|apiKeyEnv format.");
  }

  return {
    name,
    baseURL,
    model,
    apiKeyEnv
  };
}

async function readTargetsFile(path) {
  const fullPath = resolve(path);
  const payload = JSON.parse(await readFile(fullPath, "utf8"));
  if (!Array.isArray(payload.targets)) {
    throw new Error(`Expected ${fullPath} to contain a targets array.`);
  }

  return payload.targets.map((target) => ({
    name: target.name,
    baseURL: target.baseURL,
    model: target.model ?? "openfusion/fusion",
    apiKeyEnv: target.apiKeyEnv
  }));
}

function escapePipes(value) {
  return String(value).replaceAll("|", "\\|").trim();
}
