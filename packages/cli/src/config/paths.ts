import { resolve } from "node:path";

export const CONFIG_FILENAME = "chunkfunk.yaml";

/** Absolute path to chunkfunk.yaml in the given directory (default: cwd). */
export function configPath(dir: string = process.cwd()): string {
  return resolve(dir, CONFIG_FILENAME);
}
