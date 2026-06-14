#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { MockChatClient } from "./mockClient.js";
import { OpenAICompatibleClient } from "./openaiClient.js";
import { runFusion } from "./fusion.js";

const args = parseArgs(process.argv.slice(2));

if (args.help || (!args.question && !args.server)) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

if (args.server) {
  const { startServer } = await import("./server.js");
  await startServer({ configPath: args.config, dryRun: args.dryRun, port: args.port });
} else {
  const config = await loadConfig(args.config);
  const client = args.dryRun ? new MockChatClient() : createUpstreamClient(config);
  const result = await runFusion({ question: args.question, config, client });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }
}

export function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    json: false,
    help: false,
    server: false,
    port: Number(process.env.PORT || 8787)
  };
  const questionParts = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--server") parsed.server = true;
    else if (arg === "--config") parsed.config = argv[++index];
    else if (arg === "--port") parsed.port = Number(argv[++index]);
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
  openfusion [--dry-run] [--json] [--config openfusion.config.json] "your question"
  openfusion --server [--dry-run] [--port 8787]

Examples:
  node src/cli.js --dry-run "Review this API design for security and tests"
  node src/cli.js --server --dry-run --port 8787
`);
}
