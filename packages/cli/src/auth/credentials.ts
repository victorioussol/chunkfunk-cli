import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_API_URL = "https://chunkfunk.app";

export interface CliCredentials {
  token: string;
}

function configDir(): string {
  return process.env.CHUNKFUNK_CONFIG_DIR || join(homedir(), ".config", "chunkfunk");
}

export function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}

export async function readCredentials(): Promise<CliCredentials | null> {
  const path = credentialsPath();
  if (!existsSync(path)) return null;

  const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<CliCredentials>;
  if (!parsed.token || typeof parsed.token !== "string") return null;

  return { token: parsed.token };
}

export async function writeCredentials(credentials: CliCredentials): Promise<string> {
  const dir = configDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const path = credentialsPath();
  await writeFile(
    path,
    `${JSON.stringify({ token: credentials.token }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await chmod(path, 0o600);
  return path;
}
