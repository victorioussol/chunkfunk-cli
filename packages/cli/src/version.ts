import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function readPackageVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth < 8; depth += 1) {
    const path = join(dir, "package.json");
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as {
        name?: string;
        version?: string;
      };
      if ((parsed.name === "chunkfunk" || parsed.name === "@chunkfunk/cli") && parsed.version) {
        return parsed.version;
      }
    } catch {
      // Keep walking toward the package root.
    }

    const next = dirname(dir);
    if (next === dir) break;
    dir = next;
  }

  throw new Error("Could not read ChunkFunk version from package.json");
}
