import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defaultConfig } from "./defaultConfig.js";

export async function loadConfig(configPath) {
  const path = configPath ? resolve(configPath) : resolve("openfusion.config.json");
  let userConfig = {};

  try {
    userConfig = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (configPath || error.code !== "ENOENT") {
      throw new Error(`Failed to load config at ${path}: ${error.message}`);
    }
  }

  return mergeConfig(defaultConfig, userConfig);
}

export function mergeConfig(base, override) {
  const output = structuredClone(base);

  for (const [key, value] of Object.entries(override ?? {})) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = mergeConfig(output[key], value);
    } else {
      output[key] = value;
    }
  }

  return output;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
