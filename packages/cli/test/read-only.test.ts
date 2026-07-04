import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const dbDir = join(here, "..", "src", "db");

/** Write keywords that must never be sent to a user's database (§4.2). */
const FORBIDDEN = ["INSERT", "UPDATE", "DELETE", "ALTER", "DROP", "CREATE", "TRUNCATE", "GRANT"];

function dbSourceFiles(): string[] {
  return readdirSync(dbDir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(dbDir, f));
}

describe("read-only enforcement (§4.2)", () => {
  it("the db module contains no write keyword (whole-word, case-insensitive)", () => {
    for (const file of dbSourceFiles()) {
      const source = readFileSync(file, "utf8");
      for (const keyword of FORBIDDEN) {
        const re = new RegExp(`\\b${keyword}\\b`, "i");
        expect(re.test(source), `${keyword} found in ${file}`).toBe(false);
      }
    }
  });

  it("opens every session read-only", () => {
    const reader = readFileSync(join(dbDir, "reader.ts"), "utf8");
    expect(reader).toContain("default_transaction_read_only=on");
  });

  it("all user-DB access lives in the single reader module", () => {
    // No other CLI file may import pg / pg-query-stream directly.
    const srcDir = join(here, "..", "src");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".ts") && !full.includes(`${join("src", "db")}`)) {
          const source = readFileSync(full, "utf8");
          if (/from ["']pg["']|from ["']pg-query-stream["']/.test(source)) {
            offenders.push(full);
          }
        }
      }
    };
    walk(srcDir);
    expect(offenders).toEqual([]);
  });
});
