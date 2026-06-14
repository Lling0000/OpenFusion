#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { MockChatClient } from "./mockClient.js";
import { OpenAICompatibleClient } from "./openaiClient.js";
import { runFusion } from "./fusion.js";
import { initConfig } from "./init.js";
import { runDoctor } from "./doctor.js";
import { listModels } from "./models.js";
import { renderDoctorMarkdown } from "./report.js";
import { loadCompatTargets, renderCompatibilityMatrixMarkdown, runCompatibilityMatrix } from "./compat.js";

const args = parseArgs(process.argv.slice(2));

if (import.meta.url === `file://${process.argv[1]}`) {
  await main(args);
}

export async function main(args) {
  if (args.help || (!args.command && !args.question && !args.server)) {
    printHelp();
    return args.help ? 0 : 1;
  }

  if (args.command === "init") {
    const result = await initConfig({ path: args.output, force: args.force });
    console.log(result.message);
    return 0;
  }

  if (args.command === "models") {
    const config = await loadConfig(args.config);
    const models = listModels(config);
    if (args.json) {
      console.log(JSON.stringify(models, null, 2));
    } else {
      for (const model of models) {
        const suffix = model.upstream_model ? ` -> ${model.upstream_model}` : "";
        console.log(`${model.id.padEnd(22)} ${model.kind}${suffix}`);
      }
    }
    return 0;
  }

  if (args.command === "doctor") {
    const config = await loadConfig(args.config);
    const result = await runDoctor({
      config,
      real: args.real,
      probeURL: args.probeUrl,
      probeModel: args.probeModel
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (args.format === "markdown") {
      console.log(renderDoctorMarkdown(result));
    } else {
      console.log(`OpenFusion doctor (${result.mode})`);
      for (const item of result.checks) {
        console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}: ${item.message}`);
      }
    }
    return result.ok ? 0 : 1;
  }

  if (args.command === "compat") {
    const targets = await loadCompatTargets({
      configPath: args.compatConfig,
      targetSpecs: args.targets
    });
    const matrix = await runCompatibilityMatrix({ targets });

    if (args.json) {
      console.log(JSON.stringify(matrix, null, 2));
    } else {
      console.log(renderCompatibilityMatrixMarkdown(matrix));
    }

    return matrix.ok ? 0 : 1;
  }

  if (args.server) {
    const { startServer } = await import("./server.js");
    const server = await startServer({ configPath: args.config, dryRun: args.dryRun, port: args.port });
    await waitForShutdown(server);
    return 0;
  }

  const config = await loadConfig(args.config);
  const client = args.dryRun ? new MockChatClient() : createUpstreamClient(config);
  const result = await runFusion({ question: args.question, config, client });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }

  return 0;
}

export function waitForShutdown(server) {
  return new Promise((resolve) => {
    const shutdown = () => {
      server.close(() => resolve());
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

export function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    json: false,
    help: false,
    server: false,
    real: false,
    force: false,
    port: Number(process.env.PORT || 8787),
    targets: []
  };
  const questionParts = [];
  const commands = new Set(["init", "models", "doctor", "compat", "serve", "chat"]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!parsed.command && commands.has(arg)) {
      parsed.command = arg;
      if (arg === "serve") parsed.server = true;
    } else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--server") parsed.server = true;
    else if (arg === "--real") parsed.real = true;
    else if (arg === "--force") parsed.force = true;
    else if (arg === "--config") parsed.config = argv[++index];
    else if (arg === "--output" || arg === "-o") parsed.output = argv[++index];
    else if (arg === "--port") parsed.port = Number(argv[++index]);
    else if (arg === "--probe-url") parsed.probeUrl = argv[++index];
    else if (arg === "--probe-model") parsed.probeModel = argv[++index];
    else if (arg === "--format") parsed.format = argv[++index];
    else if (arg === "--target") parsed.targets.push(argv[++index]);
    else if (arg === "--compat-config") parsed.compatConfig = argv[++index];
    else questionParts.push(arg);
  }

  parsed.question = questionParts.join(" ").trim();
  return parsed;
}

function createUpstreamClient(config) {
  return new OpenAICompatibleClient({
    baseURL: config.upstream.baseURL,
    apiKey: process.env[config.upstream.apiKeyEnv],
    appName: config.upstream.appName,
    siteURL: config.upstream.siteURL,
    timeoutMs: config.fusion.timeoutMs
  });
}

function printHuman(result) {
  console.log(`# OpenFusion`);
  console.log(`\n${result.final.content}`);
  console.log(`\n## Route`);
  console.log(result.route.rationale);
  console.log(`\nPanel: ${result.panel.map((item) => `${item.role}:${item.model}`).join(", ")}`);
  console.log(`Judge: ${result.judge.role}:${result.judge.model}`);
  console.log(`Synthesizer: ${result.final.role}:${result.final.model}`);
}

function printHelp() {
  console.log(`OpenFusion - local multi-model fusion for OpenAI-compatible relays

Usage:
  openfusion init [--output openfusion.config.json] [--force]
  openfusion models [--json] [--config openfusion.config.json]
  openfusion doctor [--real] [--probe-url http://127.0.0.1:8787/v1] [--json] [--format markdown]
  openfusion compat --target "local|http://127.0.0.1:8787/v1|openfusion/fusion" [--json]
  openfusion compat --compat-config examples/compat.config.example.json
  openfusion serve [--dry-run] [--port 8787]
  openfusion chat [--dry-run] [--json] "your question"
  openfusion [--dry-run] [--json] [--config openfusion.config.json] "your question"
  openfusion --server [--dry-run] [--port 8787]

Examples:
  node src/cli.js init
  node src/cli.js doctor
  node src/cli.js doctor --probe-url http://127.0.0.1:8787/v1
  node src/cli.js doctor --probe-url http://127.0.0.1:8787/v1 --format markdown
  node src/cli.js compat --target "local|http://127.0.0.1:8787/v1|openfusion/fusion"
  node src/cli.js models
  node src/cli.js --dry-run "Review this API design for security and tests"
  node src/cli.js --server --dry-run --port 8787
`);
}
