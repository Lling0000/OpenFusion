import { access, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { configTemplate } from "./config.js";

export async function initConfig({ path = "openfusion.config.json", force = false } = {}) {
  const target = resolve(path);

  if (!force && await exists(target)) {
    return {
      path: target,
      created: false,
      message: `Config already exists at ${target}. Use --force to overwrite.`
    };
  }

  await writeFile(target, configTemplate(), "utf8");
  return {
    path: target,
    created: true,
    message: `Created ${target}`
  };
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
