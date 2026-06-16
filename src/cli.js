#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { MockChatClient } from "./mockClient.js";
import { OpenAICompatibleClient } from "./openaiClient.js";
import { runFusion } from "./fusion.js";
import { initConfig } from "./init.js";
import { runDoctor } from "./doctor.js";
import { listModels } from "./models.js";
import { renderDoctorMarkdown } from "./report.js";
import { fusionBudget } from "./fusion.js";
import { routeQuestion } from "./router.js";
import { loadCompatTargets, renderCompatibilityMatrixMarkdown, runCompatibilityMatrix } from "./compat.js";
import { buildAdapterGuide, listAdapters, renderAdapterGuide } from "./adapters.js";
import {
  buildFusionReceipt,
  renderComparisonMarkdown,
  renderEvalMarkdown,
  renderQualityComparisonMarkdown,
  runComparisonSuite,
  runEvalSuite,
  runQualityComparisonSuite
} from "./evals.js";

const args = parseArgs(process.argv.slice(2));

if (isMain(import.meta.url, process.argv[1])) {
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

  if (args.command === "route") {
    const config = await loadConfig(args.config);
    const result = buildRoutePreview(args.question, config);

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printRoutePreview(result);
    }

    return result.budget.withinBudget ? 0 : 1;
  }

  if (args.command === "doctor") {
    const config = await loadConfig(args.config);
    const result = await runDoctor({
      config,
      real: args.real,
      probeURL: args.probeUrl,
      probeModel: args.probeModel,
      probeTimeoutMs: args.probeTimeoutMs
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
    const matrix = await runCompatibilityMatrix({
      targets,
      timeoutMs: args.timeoutMs
    });

    if (args.json) {
      console.log(JSON.stringify(matrix, null, 2));
    } else {
      console.log(renderCompatibilityMatrixMarkdown(matrix));
    }

    return matrix.ok ? 0 : 1;
  }

  if (args.command === "adapter") {
    if (!args.adapterName) {
      const names = listAdapters();
      if (args.json) {
        console.log(JSON.stringify({ adapters: names }, null, 2));
      } else {
        console.log(`Available adapters: ${names.join(", ")}`);
        console.log("Examples: node src/cli.js adapter codex --port 8787");
        console.log("          node src/cli.js adapter aider --port 8787");
      }
      return 0;
    }

    const config = await loadConfig(args.config);
    const guide = buildAdapterGuide(config, {
      adapter: args.adapterName,
      port: args.port,
      configPath: args.config ?? "openfusion.config.json",
      commandName: args.commandName
    });

    if (args.json) {
      console.log(JSON.stringify(guide, null, 2));
    } else {
      console.log(renderAdapterGuide(guide));
    }

    return 0;
  }

  if (args.command === "eval") {
    const config = await loadConfig(args.config);
    const client = args.dryRun ? new MockChatClient() : createUpstreamClient(config);
    const receipt = await runEvalSuite({ config, client });

    if (args.json) {
      console.log(JSON.stringify(receipt, null, 2));
    } else {
      console.log(renderEvalMarkdown(receipt));
    }

    return receipt.summary.failed === 0 ? 0 : 1;
  }

  if (args.command === "compare") {
    const config = await loadConfig(args.config);
    const client = args.dryRun ? new MockChatClient() : createUpstreamClient(config);
    const receipt = args.grade
      ? await runQualityComparisonSuite({
        config,
        client,
        baselineRole: args.baselineRole ?? "fast",
        graderRole: args.graderRole ?? "verifier"
      })
      : await runComparisonSuite({
        config,
        client,
        baselineRole: args.baselineRole ?? "fast"
      });

    if (args.json) {
      console.log(JSON.stringify(receipt, null, 2));
    } else {
      console.log(args.grade ? renderQualityComparisonMarkdown(receipt) : renderComparisonMarkdown(receipt));
    }

    if (args.grade) {
      return receipt.summary.gradingCoverage ? 0 : 1;
    }

    return receipt.summary.failed === 0 ? 0 : 1;
  }

  if (args.command === "receipt") {
    const config = await loadConfig(args.config);
    const client = args.dryRun ? new MockChatClient() : createUpstreamClient(config);
    const fusion = await runFusion({ question: args.question, config, client });
    const receipt = buildFusionReceipt({
      fusion,
      mode: args.dryRun ? "dry-run" : "real",
      id: "cli-prompt"
    });

    console.log(JSON.stringify(receipt, null, 2));
    return receipt.verdict.hasMultiplePanelRoles && receipt.verdict.hasJudgeNotes && receipt.verdict.hasSynthesis ? 0 : 1;
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
  const commands = new Set(["init", "models", "route", "doctor", "compat", "adapter", "eval", "compare", "receipt", "serve", "chat"]);

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
    else if (arg === "--probe-timeout-ms") parsed.probeTimeoutMs = Number(argv[++index]);
    else if (arg === "--format") parsed.format = argv[++index];
    else if (arg === "--target") parsed.targets.push(argv[++index]);
    else if (arg === "--compat-config") parsed.compatConfig = argv[++index];
    else if (arg === "--command-name") parsed.commandName = argv[++index];
    else if (arg === "--timeout-ms") parsed.timeoutMs = Number(argv[++index]);
    else if (arg === "--baseline-role") parsed.baselineRole = argv[++index];
    else if (arg === "--grader-role") parsed.graderRole = argv[++index];
    else if (arg === "--grade") parsed.grade = true;
    else if (parsed.command === "adapter" && !parsed.adapterName) parsed.adapterName = arg;
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

function buildRoutePreview(question, config) {
  const route = routeQuestion(question, config);
  const budget = fusionBudget(route, config);

  return {
    object: "openfusion.route_preview",
    schema: "openfusion.route_preview.v1",
    question,
    route,
    budget,
    panel: route.selectedRoles.map((role) => ({
      role,
      model: config.roles[role].model,
      description: config.roles[role].description
    })),
    judge: {
      role: config.fusion.judgeRole,
      model: config.roles[config.fusion.judgeRole].model
    },
    synthesizer: {
      role: config.fusion.synthesizerRole,
      model: config.roles[config.fusion.synthesizerRole].model
    }
  };
}

function isMain(moduleURL, argvPath) {
  if (!argvPath) return false;

  try {
    return realpathSync(fileURLToPath(moduleURL)) === realpathSync(argvPath);
  } catch {
    return fileURLToPath(moduleURL) === argvPath;
  }
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

function printRoutePreview(result) {
  console.log("# OpenFusion Route Preview");
  console.log(`\n${result.route.rationale}`);
  console.log(`\nPanel: ${result.panel.map((item) => `${item.role}:${item.model}`).join(", ")}`);
  console.log(`Judge: ${result.judge.role}:${result.judge.model}`);
  console.log(`Synthesizer: ${result.synthesizer.role}:${result.synthesizer.model}`);
  console.log(`Budget: ${result.budget.estimatedUpstreamCalls}/${result.budget.maxUpstreamCalls} upstream calls`);
  console.log(`Cost: ${formatCost(result.budget.cost)}`);
  console.log(`Within budget: ${result.budget.withinBudget ? "yes" : "no"}`);
}

function formatCost(cost) {
  if (!cost?.available) return "not estimated";
  const limit = cost.maxUsd === null ? "no cost limit" : `max $${cost.maxUsd}`;
  return `$${cost.estimatedUsd.toFixed(6)} (${limit})`;
}

function printHelp() {
  console.log(`OpenFusion - local multi-model fusion for OpenAI-compatible relays

Usage:
  openfusion init [--output openfusion.config.json] [--force]
  openfusion models [--json] [--config openfusion.config.json]
  openfusion route [--json] [--config openfusion.config.json] "your question"
  openfusion doctor [--real] [--probe-url http://127.0.0.1:8787/v1] [--probe-timeout-ms 30000] [--json] [--format markdown]
  openfusion compat --target "local|http://127.0.0.1:8787/v1|openfusion/fusion" [--timeout-ms 30000] [--json]
  openfusion compat --compat-config examples/compat.config.example.json
  openfusion adapter [codex|aider] [--json] [--port 8787] [--config openfusion.config.json] [--command-name openfusion]
  openfusion eval --dry-run [--json] [--format markdown]
  openfusion compare --dry-run [--json] [--baseline-role fast] [--grade] [--grader-role verifier]
  openfusion receipt --dry-run "your question"
  openfusion serve [--dry-run] [--port 8787]
  openfusion chat [--dry-run] [--json] "your question"
  openfusion [--dry-run] [--json] [--config openfusion.config.json] "your question"
  openfusion --server [--dry-run] [--port 8787]

Examples:
  node src/cli.js init
  node src/cli.js doctor
  node src/cli.js route --json "Review this API design for security and tests"
  node src/cli.js doctor --probe-url http://127.0.0.1:8787/v1 --probe-timeout-ms 30000
  node src/cli.js doctor --probe-url http://127.0.0.1:8787/v1 --format markdown
  node src/cli.js compat --target "local|http://127.0.0.1:8787/v1|openfusion/fusion" --timeout-ms 30000
  node src/cli.js adapter codex
  node src/cli.js adapter aider
  node src/cli.js eval --dry-run
  node src/cli.js compare --dry-run --baseline-role fast
  node src/cli.js compare --dry-run --grade --grader-role verifier
  node src/cli.js receipt --dry-run "Debug this failing API test"
  node src/cli.js models
  node src/cli.js --dry-run "Review this API design for security and tests"
  node src/cli.js --server --dry-run --port 8787
`);
}
