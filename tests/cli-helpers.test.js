import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/defaultConfig.js";
import { runDoctor } from "../src/doctor.js";
import { initConfig } from "../src/init.js";
import { listModels } from "../src/models.js";
import { parseArgs } from "../src/cli.js";

test("parses explicit chat and serve commands", () => {
  const chat = parseArgs(["chat", "--dry-run", "--json", "Fix", "this", "test"]);
  assert.equal(chat.command, "chat");
  assert.equal(chat.dryRun, true);
  assert.equal(chat.json, true);
  assert.equal(chat.question, "Fix this test");

  const serve = parseArgs(["serve", "--port", "9999"]);
  assert.equal(serve.server, true);
  assert.equal(serve.port, 9999);
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
