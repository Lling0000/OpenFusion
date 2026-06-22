import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const DEFAULT_PROVIDER = "openfusion";
const DEFAULT_PROVIDER_NAME = "OpenFusion local";
const DEFAULT_API_KEY_ENV = "OPENFUSION_API_KEY";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;

export function defaultCodexConfigPath() {
  return join(homedir(), ".codex", "config.toml");
}

export function buildLocalBaseURL({ host = DEFAULT_HOST, port = DEFAULT_PORT } = {}) {
  return `http://${host}:${port}/v1`;
}

export function targetModelForCodexAction(action, role) {
  if (action === "enable-auto") return "openfusion/auto";
  if (action === "enable-fusion") return "openfusion/fusion";
  if (action === "use-role") {
    if (!role) {
      throw new Error("codex use-role requires a role name, for example: openfusion codex use-role coder");
    }
    return role.startsWith("openfusion/") ? role : `openfusion/${role}`;
  }

  throw new Error(`Unknown codex action "${action}". Use status, snippet, enable-auto, enable-fusion, or use-role.`);
}

export function buildCodexConfigSnippet({
  model = "openfusion/auto",
  provider = DEFAULT_PROVIDER,
  providerName = DEFAULT_PROVIDER_NAME,
  baseURL = buildLocalBaseURL(),
  apiKeyEnv = DEFAULT_API_KEY_ENV
} = {}) {
  return `model = "${escapeTomlString(model)}"
model_provider = "${escapeTomlString(provider)}"

[model_providers.${provider}]
name = "${escapeTomlString(providerName)}"
base_url = "${escapeTomlString(baseURL)}"
env_key = "${escapeTomlString(apiKeyEnv)}"`;
}

export async function inspectCodexConfig({
  configPath = defaultCodexConfigPath(),
  provider = DEFAULT_PROVIDER
} = {}) {
  const resolvedPath = resolveHome(configPath);

  try {
    const text = await readFile(resolvedPath, "utf8");
    return inspectCodexConfigText(text, { configPath: resolvedPath, provider, exists: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return inspectCodexConfigText("", { configPath: resolvedPath, provider, exists: false });
  }
}

export function inspectCodexConfigText(text, {
  configPath = defaultCodexConfigPath(),
  provider = DEFAULT_PROVIDER,
  exists = true
} = {}) {
  const model = readTopLevelString(text, "model");
  const modelProvider = readTopLevelString(text, "model_provider");
  const providerSection = readSectionStrings(text, `model_providers.${provider}`);
  const mode = classifyCodexMode({ exists, model, modelProvider, provider });

  return {
    object: "openfusion.codex_status",
    schema: "openfusion.codex_status.v1",
    configPath: resolveHome(configPath),
    exists,
    provider,
    model,
    modelProvider,
    providerSection,
    mode,
    enabled: mode.startsWith("openfusion-"),
    autoEnabled: mode === "openfusion-auto",
    label: codexModeLabel(mode, model),
    visibleHint: codexVisibleHint(mode, model),
    recommendation: codexRecommendation(mode)
  };
}

export async function enableCodexOpenFusion({
  configPath = defaultCodexConfigPath(),
  model = "openfusion/auto",
  provider = DEFAULT_PROVIDER,
  providerName = DEFAULT_PROVIDER_NAME,
  baseURL = buildLocalBaseURL(),
  apiKeyEnv = DEFAULT_API_KEY_ENV,
  backup = true
} = {}) {
  const resolvedPath = resolveHome(configPath);
  let before = "";
  let existed = true;

  try {
    before = await readFile(resolvedPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    existed = false;
  }

  const after = updateCodexConfigText(before, {
    model,
    provider,
    providerName,
    baseURL,
    apiKeyEnv
  });
  const changed = after !== before;
  let backupPath = null;

  if (changed) {
    await mkdir(dirname(resolvedPath), { recursive: true });
    if (backup && existed) {
      backupPath = `${resolvedPath}.openfusion-backup-${timestampForPath()}`;
      await copyFile(resolvedPath, backupPath);
    }
    await writeFile(resolvedPath, after, "utf8");
  }

  return {
    object: "openfusion.codex_switch",
    schema: "openfusion.codex_switch.v1",
    changed,
    backupPath,
    targetModel: model,
    status: inspectCodexConfigText(after, {
      configPath: resolvedPath,
      provider,
      exists: true
    })
  };
}

export function updateCodexConfigText(text, {
  model = "openfusion/auto",
  provider = DEFAULT_PROVIDER,
  providerName = DEFAULT_PROVIDER_NAME,
  baseURL = buildLocalBaseURL(),
  apiKeyEnv = DEFAULT_API_KEY_ENV
} = {}) {
  let output = ensureTrailingNewline(text ?? "");
  output = setTopLevelTomlString(output, "model", model);
  output = setTopLevelTomlString(output, "model_provider", provider);
  output = setTomlSectionStrings(output, `model_providers.${provider}`, {
    name: providerName,
    base_url: baseURL,
    env_key: apiKeyEnv
  });
  return output;
}

export function renderCodexStatus(status) {
  const lines = [
    "# OpenFusion Codex Switch",
    "",
    `Status: ${status.label}`,
    `Config: ${status.configPath}`,
    `Current model_provider: ${status.modelProvider ?? "(not set)"}`,
    `Current model: ${status.model ?? "(not set)"}`,
    `OpenFusion base_url: ${status.providerSection.base_url ?? "(not set)"}`,
    `Visible hint: ${status.visibleHint}`,
    "",
    "Next steps:",
    `- ${status.recommendation}`,
    "- Start OpenFusion with: openfusion serve --config openfusion.config.json --port 8787",
    "- Verify with: openfusion doctor --probe-url http://127.0.0.1:8787/v1 --probe-model openfusion/auto"
  ];

  return lines.join("\n");
}

export function renderCodexSnippet(snippet) {
  return `# OpenFusion Codex Config Snippet

Add this to ~/.codex/config.toml, or run:

\`\`\`bash
openfusion codex enable-auto
\`\`\`

\`\`\`toml
${snippet}
\`\`\`

When Codex shows the selected model near the composer/model selector, look for \`openfusion/auto\` to confirm the Auto strategy is on.`;
}

export function renderCodexSwitch(result) {
  const lines = [
    "# OpenFusion Codex Switch",
    "",
    `Target model: ${result.targetModel}`,
    `Changed config: ${result.changed ? "yes" : "no"}`,
    `Config: ${result.status.configPath}`
  ];

  if (result.backupPath) {
    lines.push(`Backup: ${result.backupPath}`);
  }

  lines.push(
    "",
    `Status: ${result.status.label}`,
    `Visible hint: ${result.status.visibleHint}`,
    "",
    "Restart Codex or start a new thread if the current session does not pick up the new config."
  );

  return lines.join("\n");
}

function classifyCodexMode({ exists, model, modelProvider, provider }) {
  if (!exists) return "missing";
  if (modelProvider !== provider) return "direct";
  if (model === "openfusion/auto") return "openfusion-auto";
  if (model === "openfusion/fusion") return "openfusion-fusion";
  if (model?.startsWith("openfusion/")) return "openfusion-role";
  return "openfusion-provider-only";
}

function codexModeLabel(mode, model) {
  if (mode === "missing") return "Codex config not found";
  if (mode === "openfusion-auto") return "Auto is ON";
  if (mode === "openfusion-fusion") return "Fusion is ON";
  if (mode === "openfusion-role") return `Role passthrough is ON (${model})`;
  if (mode === "openfusion-provider-only") return "OpenFusion provider is selected, but the model is not an OpenFusion virtual model";
  return "OpenFusion is OFF";
}

function codexVisibleHint(mode, model) {
  if (mode === "openfusion-auto") return "Codex should show openfusion/auto as the selected model.";
  if (mode === "openfusion-fusion") return "Codex should show openfusion/fusion as the selected model.";
  if (mode === "openfusion-role") return `Codex should show ${model} as a single-role OpenFusion model.`;
  return "Codex is not currently pointed at OpenFusion.";
}

function codexRecommendation(mode) {
  if (mode === "openfusion-auto") return "Auto is already enabled. Ask a normal question and inspect /debug/route or response.openfusion to see the selected strategy, candidates, and roles.";
  if (mode === "openfusion-fusion") return "Fusion is enabled. Use openfusion codex enable-auto if you want Auto to choose between single-model, verified, and full-fusion strategies.";
  if (mode === "openfusion-role") return "A single role is selected. Use openfusion codex enable-auto to turn the Auto strategy back on.";
  return "Run openfusion codex enable-auto to point Codex at the local Auto strategy.";
}

function readTopLevelString(text, key) {
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    if (isSectionHeader(line)) return null;
    const parsed = parseTomlStringLine(line, key);
    if (parsed !== null) return parsed;
  }

  return null;
}

function readSectionStrings(text, sectionName) {
  const lines = text.split(/\r?\n/);
  const values = {};
  let inSection = false;

  for (const line of lines) {
    if (isSectionHeader(line)) {
      inSection = sectionHeaderName(line) === sectionName;
      continue;
    }

    if (!inSection) continue;
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*"((?:\\"|[^"])*)"/);
    if (match) {
      values[match[1]] = unescapeTomlString(match[2]);
    }
  }

  return values;
}

function setTopLevelTomlString(text, key, value) {
  const lines = text.split("\n");
  const replacement = `${key} = "${escapeTomlString(value)}"`;
  const firstSectionIndex = lines.findIndex(isSectionHeader);
  const topLevelEnd = firstSectionIndex === -1 ? lines.length : firstSectionIndex;

  for (let index = 0; index < topLevelEnd; index += 1) {
    if (matchesTomlKey(lines[index], key)) {
      lines[index] = replacement;
      return lines.join("\n");
    }
  }

  const insertAt = firstSectionIndex === -1 ? firstNonFinalEmptyLine(lines) : firstSectionIndex;
  lines.splice(insertAt, 0, replacement);
  return lines.join("\n");
}

function setTomlSectionStrings(text, sectionName, entries) {
  const lines = text.split("\n");
  const header = `[${sectionName}]`;
  let sectionStart = lines.findIndex((line) => sectionHeaderName(line) === sectionName);

  if (sectionStart === -1) {
    const insertAt = firstNonFinalEmptyLine(lines);
    const prefix = insertAt > 0 && lines[insertAt - 1].trim() !== "" ? [""] : [];
    lines.splice(insertAt, 0, ...prefix, header, ...Object.entries(entries).map(([key, value]) => `${key} = "${escapeTomlString(value)}"`));
    return ensureTrailingNewline(lines.join("\n"));
  }

  let sectionEnd = lines.length;
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (isSectionHeader(lines[index])) {
      sectionEnd = index;
      break;
    }
  }

  for (const [key, value] of Object.entries(entries)) {
    const replacement = `${key} = "${escapeTomlString(value)}"`;
    let replaced = false;

    for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
      if (matchesTomlKey(lines[index], key)) {
        lines[index] = replacement;
        replaced = true;
        break;
      }
    }

    if (!replaced) {
      lines.splice(sectionEnd, 0, replacement);
      sectionEnd += 1;
    }
  }

  return ensureTrailingNewline(lines.join("\n"));
}

function parseTomlStringLine(line, key) {
  const match = line.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"((?:\\\\"|[^"])*)"`));
  return match ? unescapeTomlString(match[1]) : null;
}

function matchesTomlKey(line, key) {
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(line);
}

function isSectionHeader(line) {
  return /^\s*\[[^\]]+\]\s*$/.test(line);
}

function sectionHeaderName(line) {
  const match = line.match(/^\s*\[([^\]]+)\]\s*$/);
  return match?.[1] ?? null;
}

function firstNonFinalEmptyLine(lines) {
  return lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

function ensureTrailingNewline(text) {
  if (text === "") return "";
  return text.endsWith("\n") ? text : `${text}\n`;
}

function resolveHome(path) {
  if (!path || path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return resolve(path);
}

function escapeTomlString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function unescapeTomlString(value) {
  return value.replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
