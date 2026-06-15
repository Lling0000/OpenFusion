const adapters = new Set(["codex"]);

export function listAdapters() {
  return Array.from(adapters);
}

export function buildAdapterGuide(config, {
  adapter = "codex",
  host = "127.0.0.1",
  port = 8787,
  configPath = "openfusion.config.json",
  commandName = "openfusion"
} = {}) {
  if (!adapters.has(adapter)) {
    throw new Error(`Unknown adapter "${adapter}". Available adapters: ${listAdapters().join(", ")}`);
  }

  const localBaseURL = `http://${host}:${port}/v1`;
  const localApiKey = "openfusion-local-placeholder";
  const model = "openfusion/fusion";

  return {
    adapter,
    local: {
      baseURL: localBaseURL,
      apiKey: localApiKey,
      model
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
      "Use the local base URL in Codex or any OpenAI-compatible client.",
      "Keep your real relay API key in the upstream environment variable, not in Codex client config.",
      "If you are running from a git checkout, replace openfusion with node src/cli.js.",
      "Use dry-run mode first to verify routing without sending prompts upstream.",
      "Tool-call requests use single-model passthrough so coding-agent protocols remain stable."
    ]
  };
}

export function renderAdapterGuide(guide) {
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

function titleCase(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
