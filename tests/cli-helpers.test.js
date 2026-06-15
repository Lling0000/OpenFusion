import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/defaultConfig.js";
import { runDoctor } from "../src/doctor.js";
import { initConfig } from "../src/init.js";
import { listModels } from "../src/models.js";
import { parseArgs } from "../src/cli.js";
import { startServer } from "../src/server.js";
import { probeEndpoint } from "../src/probe.js";
import { renderDoctorMarkdown } from "../src/report.js";
import { loadCompatTargets, renderCompatibilityMatrixMarkdown, runCompatibilityMatrix } from "../src/compat.js";
import { buildAdapterGuide, listAdapters, renderAdapterGuide } from "../src/adapters.js";
import { buildFusionReceipt, renderEvalMarkdown, runEvalSuite } from "../src/evals.js";
import { MockChatClient } from "../src/mockClient.js";
import { runFusion } from "../src/fusion.js";

test("parses explicit chat and serve commands", () => {
  const chat = parseArgs(["chat", "--dry-run", "--json", "Fix", "this", "test"]);
  assert.equal(chat.command, "chat");
  assert.equal(chat.dryRun, true);
  assert.equal(chat.json, true);
  assert.equal(chat.question, "Fix this test");

  const serve = parseArgs(["serve", "--port", "9999"]);
  assert.equal(serve.server, true);
  assert.equal(serve.port, 9999);

  const doctor = parseArgs(["doctor", "--probe-url", "http://127.0.0.1:8787/v1", "--format", "markdown"]);
  assert.equal(doctor.command, "doctor");
  assert.equal(doctor.probeUrl, "http://127.0.0.1:8787/v1");
  assert.equal(doctor.format, "markdown");

  const compat = parseArgs(["compat", "--target", "local|http://127.0.0.1:8787/v1|openfusion/fusion"]);
  assert.equal(compat.command, "compat");
  assert.deepEqual(compat.targets, ["local|http://127.0.0.1:8787/v1|openfusion/fusion"]);

  const adapter = parseArgs(["adapter", "codex", "--port", "9999", "--json", "--command-name", "node src/cli.js"]);
  assert.equal(adapter.command, "adapter");
  assert.equal(adapter.adapterName, "codex");
  assert.equal(adapter.port, 9999);
  assert.equal(adapter.json, true);
  assert.equal(adapter.commandName, "node src/cli.js");

  const evalArgs = parseArgs(["eval", "--dry-run", "--json"]);
  assert.equal(evalArgs.command, "eval");
  assert.equal(evalArgs.dryRun, true);
  assert.equal(evalArgs.json, true);

  const receipt = parseArgs(["receipt", "--dry-run", "Review", "this", "patch"]);
  assert.equal(receipt.command, "receipt");
  assert.equal(receipt.dryRun, true);
  assert.equal(receipt.question, "Review this patch");
});

test("lists virtual and role models", () => {
  const models = listModels(defaultConfig);
  assert.ok(models.some((model) => model.id === "openfusion/auto"));
  assert.ok(models.some((model) => model.id === "openfusion/fusion"));
  assert.ok(models.some((model) => model.id === "openfusion/coder" && model.upstream_model));
});

test("doctor validates dry-run fusion pipeline without upstream key", async () => {
  const result = await runDoctor({ config: defaultConfig });

  assert.equal(result.ok, true);
  assert.equal(result.mode, "dry-run");
  assert.ok(result.checks.some((check) => check.name === "fusion.pipeline" && check.ok));
});

test("doctor can probe an OpenAI-compatible endpoint", async () => {
  const server = await startServer({ dryRun: true, port: 0 });
  const { port } = server.address();

  try {
    const result = await runDoctor({
      config: defaultConfig,
      probeURL: `http://127.0.0.1:${port}/v1`,
      probeModel: "openfusion/fusion"
    });

    assert.equal(result.ok, true);
    assert.ok(result.checks.some((item) => item.name === "probe.models" && item.ok));
    assert.ok(result.checks.some((item) => item.name === "probe.chat" && item.ok));
    assert.ok(result.checks.some((item) => item.name === "probe.chat.stream" && item.ok));
    assert.ok(result.checks.some((item) => item.name === "probe.tool.roundtrip" && item.ok));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("probeEndpoint reports contract checks", async () => {
  const server = await startServer({ dryRun: true, port: 0 });
  const { port } = server.address();

  try {
    const result = await probeEndpoint({
      baseURL: `http://127.0.0.1:${port}/v1`,
      model: "openfusion/fusion"
    });

    assert.equal(result.ok, true);
    assert.equal(result.checks.length, 4);
    assert.ok(result.checks.some((item) => item.name === "probe.tool.roundtrip"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("renders doctor results as a Markdown compatibility report", async () => {
  const result = {
    ok: false,
    mode: "dry-run",
    probeURL: "http://127.0.0.1:8787/v1",
    checks: [
      { name: "probe.chat", ok: true, message: "POST /chat/completions returned 200." },
      { name: "probe.tool.roundtrip", ok: false, message: "Tool | follow-up failed." }
    ]
  };

  const markdown = renderDoctorMarkdown(result);

  assert.match(markdown, /# OpenFusion Compatibility Report/);
  assert.match(markdown, /\| `probe\.chat` \| PASS \|/);
  assert.match(markdown, /\| `probe\.tool\.roundtrip` \| FAIL \| Tool \\| follow-up failed\. \|/);
  assert.match(markdown, /Overall: \*\*FAIL\*\*/);
});

test("runs and renders a provider compatibility matrix", async () => {
  const server = await startServer({ dryRun: true, port: 0 });
  const { port } = server.address();

  try {
    const targets = await loadCompatTargets({
      targetSpecs: [`local|http://127.0.0.1:${port}/v1|openfusion/fusion`]
    });
    const matrix = await runCompatibilityMatrix({ targets });
    const markdown = renderCompatibilityMatrixMarkdown(matrix);

    assert.equal(matrix.ok, true);
    assert.equal(matrix.results[0].name, "local");
    assert.ok(matrix.results[0].checks.some((check) => check.name === "probe.tool.roundtrip" && check.ok));
    assert.match(markdown, /# OpenFusion Provider Compatibility Matrix/);
    assert.match(markdown, /\| local \| `openfusion\/fusion` \|/);
    assert.match(markdown, /Overall: \*\*PASS\*\*/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("compatibility matrix requires at least one target", async () => {
  await assert.rejects(
    () => runCompatibilityMatrix({ targets: [] }),
    /requires at least one target/
  );
});

test("builds and renders a Codex adapter guide", () => {
  assert.deepEqual(listAdapters(), ["codex"]);

  const guide = buildAdapterGuide(defaultConfig, {
    adapter: "codex",
    port: 9999,
    configPath: "examples/api-relay.config.example.json",
    commandName: "openfusion"
  });
  const markdown = renderAdapterGuide(guide);

  assert.equal(guide.local.baseURL, "http://127.0.0.1:9999/v1");
  assert.equal(guide.local.model, "openfusion/fusion");
  assert.equal(guide.local.apiKeyEnv, "OPENFUSION_API_KEY");
  assert.equal(guide.upstream.apiKeyEnv, defaultConfig.upstream.apiKeyEnv);
  assert.match(guide.codex.configToml, /model_provider = "openfusion"/);
  assert.match(guide.codex.configToml, /env_key = "OPENFUSION_API_KEY"/);
  assert.match(guide.commands.serveDryRun, /^openfusion serve/);
  assert.match(markdown, /# OpenFusion Codex Adapter/);
  assert.match(markdown, /~\/\.codex\/config\.toml/);
  assert.match(markdown, /base_url = http:\/\/127\.0\.0\.1:9999\/v1/);
  assert.match(markdown, /Tool-call requests use single-model passthrough/);
});

test("rejects unknown adapters", () => {
  assert.throws(
    () => buildAdapterGuide(defaultConfig, { adapter: "unknown" }),
    /Unknown adapter/
  );
});

test("runs and renders eval receipts", async () => {
  const receipt = await runEvalSuite({
    config: defaultConfig,
    client: new MockChatClient()
  });
  const markdown = renderEvalMarkdown(receipt);

  assert.equal(receipt.object, "openfusion.eval_receipt");
  assert.equal(receipt.schema, "openfusion.eval_receipt.v1");
  assert.equal(receipt.summary.failed, 0);
  assert.ok(receipt.results.some((item) => item.id === "coding-review" && item.selectedRoles.includes("coder")));
  assert.ok(receipt.results.every((item) => item.trace.phaseCount >= 4));
  assert.ok(receipt.results.every((item) => item.evidence.panel[0].contentSha256.length === 64));
  assert.match(markdown, /# OpenFusion Eval Receipt/);
  assert.match(markdown, /\| `coding-review` \| PASS \|/);
  assert.match(markdown, /does not prove answer quality/);
});

test("builds a single fusion receipt", async () => {
  const fusion = await runFusion({
    question: "Review this patch for security and tests",
    config: defaultConfig,
    client: new MockChatClient()
  });
  const receipt = buildFusionReceipt({
    fusion,
    mode: "dry-run",
    id: "test"
  });

  assert.equal(receipt.object, "openfusion.fusion_receipt");
  assert.equal(receipt.schema, "openfusion.fusion_receipt.v1");
  assert.equal(receipt.verdict.hasMultiplePanelRoles, true);
  assert.equal(receipt.verdict.hasJudgeNotes, true);
  assert.equal(receipt.verdict.hasSynthesis, true);
  assert.equal(receipt.verdict.hasPhaseTrace, true);
  assert.equal(receipt.promptSha256.length, 64);
  assert.ok(receipt.panel[0].contentExcerpt);
});

test("cli serve keeps a foreground server alive", async () => {
  const port = 18787;
  const child = spawn(process.execPath, ["src/cli.js", "serve", "--dry-run", "--port", String(port)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealth(`http://127.0.0.1:${port}/health`);
    assert.equal(child.exitCode, null);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
});

test("init creates config and refuses overwrite unless forced", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openfusion-"));
  const configPath = join(dir, "openfusion.config.json");

  try {
    const created = await initConfig({ path: configPath });
    assert.equal(created.created, true);
    assert.match(await readFile(configPath, "utf8"), /"upstream"/);

    await writeFile(configPath, "{\"custom\":true}\n", "utf8");
    const skipped = await initConfig({ path: configPath });
    assert.equal(skipped.created, false);
    assert.equal(await readFile(configPath, "utf8"), "{\"custom\":true}\n");

    const forced = await initConfig({ path: configPath, force: true });
    assert.equal(forced.created, true);
    assert.match(await readFile(configPath, "utf8"), /"fusion"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function waitForHealth(url) {
  const started = Date.now();
  let lastError;

  while (Date.now() - started < 3000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw lastError ?? new Error("Timed out waiting for health check.");
}
