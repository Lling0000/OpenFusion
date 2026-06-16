const adapters = ["codex", "aider"];

export function listAdapters() {
  return [...adapters];
}

export function buildAdapterGuide(config, {
  adapter = "codex",
  host = "127.0.0.1",
  port = 8787,
  configPath = "openfusion.config.json",
  commandName = "openfusion"
} = {}) {
  if (!adapters.includes(adapter)) {
    throw new Error(`Unknown adapter "${adapter}". Available adapters: ${listAdapters().join(", ")}`);
  }

  const localBaseURL = `http://${host}:${port}/v1`;
  const localApiKey = "openfusion-local-placeholder";
  const localApiKeyEnv = "OPENFUSION_API_KEY";
  const model = "openfusion/fusion";
  const aiderModel = `openai/${model}`;
  const codexConfigToml = `model = "${model}"
model_provider = "openfusion"

[model_providers.openfusion]
name = "OpenFusion local"
base_url = "${localBaseURL}"
env_key = "${localApiKeyEnv}"`;
  const aiderConfigYml = `model: ${aiderModel}
openai-api-base: ${localBaseURL}
openai-api-key: ${localApiKey}`;

  return {
    adapter,
    local: {
      baseURL: localBaseURL,
      apiKey: localApiKey,
      apiKeyEnv: localApiKeyEnv,
      model,
      aiderModel
    },
    codex: {
      configPath: "~/.codex/config.toml",
      configToml: codexConfigToml
    },
    aider: {
      configPath: "~/.aider.conf.yml",
      configYml: aiderConfigYml,
      envScript: `export AIDER_OPENAI_API_BASE="${localBaseURL}"
export AIDER_OPENAI_API_KEY="${localApiKey}"
aider --model ${aiderModel}`,
      launchCommand: `aider --model ${aiderModel}`
    },
    upstream: {
      baseURL: config.upstream.baseURL,
      apiKeyEnv: config.upstream.apiKeyEnv,
      appName: config.upstream.appName,
      siteURL: config.upstream.siteURL
    },
    commands: {
      init: `${commandName} init --output ${configPath}`,
      serveDryRun: `${commandName} serve --dry-run --port ${port}`,
      serveReal: `${config.upstream.apiKeyEnv}="..." ${commandName} serve --config ${configPath} --port ${port}`,
      doctorDryRun: `${commandName} doctor`,
      doctorReal: `${config.upstream.apiKeyEnv}="..." ${commandName} doctor --real --config ${configPath}`,
      probeLocal: `${commandName} doctor --probe-url ${localBaseURL} --probe-model ${model}`
    },
    notes: [
      "Use the local base URL in the client or any OpenAI-compatible tool.",
      "Keep your real relay API key in the upstream environment variable, not in Codex client config.",
      "If you are running from a git checkout, replace openfusion with node src/cli.js.",
      "Use dry-run mode first to verify routing without sending prompts upstream.",
      "Tool-call requests use single-model passthrough so coding-agent protocols remain stable."
    ]
  };
}

export function renderAdapterGuide(guide) {
  if (guide.adapter === "aider") {
    return renderAiderGuide(guide);
  }

  return renderCodexGuide(guide);
}

function renderCodexGuide(guide) {
  return `# OpenFusion ${titleCase(guide.adapter)} Adapter

Use OpenFusion as the local OpenAI-compatible gateway, then point ${titleCase(guide.adapter)} at the local URL.

## 1. Create Or Edit OpenFusion Config

\`\`\`bash
${guide.commands.init}
\`\`\`

Set your upstream relay in \`openfusion.config.json\`:

\`\`\`json
{
  "upstream": {
    "baseURL": "${guide.upstream.baseURL}",
    "apiKeyEnv": "${guide.upstream.apiKeyEnv}"
  }
}
\`\`\`

## 2. Start OpenFusion

Dry-run, no upstream calls:

\`\`\`bash
${guide.commands.serveDryRun}
\`\`\`

Real relay mode:

\`\`\`bash
${guide.commands.serveReal}
\`\`\`

## 3. Configure ${titleCase(guide.adapter)}

Add this to \`${guide.codex.configPath}\`:

\`\`\`toml
${guide.codex.configToml}
\`\`\`

Set a local placeholder key for Codex. The real upstream key stays with OpenFusion:

\`\`\`bash
export ${guide.local.apiKeyEnv}="${guide.local.apiKey}"
\`\`\`

Generic OpenAI-compatible clients can use the same values directly:

\`\`\`text
base_url = ${guide.local.baseURL}
api_key = ${guide.local.apiKey}
model = ${guide.local.model}
\`\`\`

## 4. Verify

\`\`\`bash
${guide.commands.doctorDryRun}
${guide.commands.probeLocal}
\`\`\`

For a real upstream relay:

\`\`\`bash
${guide.commands.doctorReal}
\`\`\`

## Notes

${guide.notes.map((note) => `- ${note}`).join("\n")}
`;
}

function renderAiderGuide(guide) {
  return `# OpenFusion Aider Adapter

Use OpenFusion as the local OpenAI-compatible gateway, then point Aider at the local URL.

## 1. Create Or Edit OpenFusion Config

\`\`\`bash
${guide.commands.init}
\`\`\`

Set your upstream relay in \`openfusion.config.json\`:

\`\`\`json
{
  "upstream": {
    "baseURL": "${guide.upstream.baseURL}",
    "apiKeyEnv": "${guide.upstream.apiKeyEnv}"
  }
}
\`\`\`

## 2. Start OpenFusion

Dry-run, no upstream calls:

\`\`\`bash
${guide.commands.serveDryRun}
\`\`\`

Real relay mode:

\`\`\`bash
${guide.commands.serveReal}
\`\`\`

## 3. Configure Aider

Option A: add this to \`${guide.aider.configPath}\`:

\`\`\`yaml
${guide.aider.configYml}
\`\`\`

Option B: use environment variables and pass the model on the command line:

\`\`\`bash
${guide.aider.envScript}
\`\`\`

The real upstream key stays with OpenFusion. Aider only needs the local placeholder key and the local OpenFusion base URL.

## 4. Verify

\`\`\`bash
${guide.commands.doctorDryRun}
${guide.commands.probeLocal}
\`\`\`

For a real upstream relay:

\`\`\`bash
${guide.commands.doctorReal}
\`\`\`

## Notes

${guide.notes.map((note) => `- ${note}`).join("\n")}
- Aider uses the OpenAI-compatible provider path, so the model name is \`${guide.local.aiderModel}\`.
- If you use a config file, Aider can read the local base URL and placeholder key without extra CLI flags.
`;
}

function titleCase(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
