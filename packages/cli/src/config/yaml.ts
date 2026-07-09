import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parse, stringify } from "yaml";
import { chunkfunkConfigV1Schema, type ChunkfunkConfigV1, type ChunkfunkConfigV1Input } from "@chunkfunk/core";
import { configPath } from "./paths";

/** Reads and validates chunkfunk.yaml; returns null when the file is absent. */
export interface LoadedConfig {
  config: ChunkfunkConfigV1;
  telemetryConfigured: boolean;
}

/** Reads and validates chunkfunk.yaml; returns null when the file is absent. */
export async function loadConfig(
  dir?: string,
): Promise<ChunkfunkConfigV1 | null> {
  return (await loadConfigWithMetadata(dir))?.config ?? null;
}

export async function loadConfigWithMetadata(dir?: string): Promise<LoadedConfig | null> {
  const path = configPath(dir);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, "utf8");
  const parsed = parse(raw);
  return {
    config: chunkfunkConfigV1Schema.parse(parsed),
    telemetryConfigured: Boolean(parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "telemetry")),
  };
}

/**
 * Writes chunkfunk.yaml. The config is validated first so we never persist an
 * invalid file, and the connection string is never stored — only the NAME of the
 * env var that holds it (§3.3).
 */
export async function writeConfig(
  config: ChunkfunkConfigV1Input,
  dir?: string,
): Promise<string> {
  const validated = chunkfunkConfigV1Schema.parse(config);
  const path = configPath(dir);
  const header =
    "# ChunkFunk configuration. The connection string is NEVER stored here —\n" +
    "# `connection.env` names the environment variable that holds it.\n";
  const output: ChunkfunkConfigV1Input = {
    version: validated.version,
    system: validated.system,
    connection: validated.connection,
    ...(validated.mapping ? { mapping: validated.mapping } : {}),
    ...(validated.sources ? { sources: validated.sources } : {}),
    ...(validated.inventory ? { inventory: validated.inventory } : {}),
    ...(validated.sync ? { sync: validated.sync } : {}),
    ...(Object.prototype.hasOwnProperty.call(config, "telemetry") ? { telemetry: validated.telemetry } : {}),
    ...(validated.thresholds ? { thresholds: validated.thresholds } : {}),
  };
  await writeFile(path, header + stringify(output), "utf8");
  return path;
}

export function configExists(dir?: string): boolean {
  return existsSync(configPath(dir));
}
