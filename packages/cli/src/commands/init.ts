import { chunkfunkConfigV1Schema, type ChunkfunkConfigV1, type ChunkfunkConfigV1Input } from "@chunkfunk/core";
import { UserDbReader } from "../db/reader";
import { loadConfig, writeConfig } from "../config/yaml";
import { introspect, type IntrospectResult } from "../introspect/introspect";
import { inquirerPrompts, type IntrospectPrompts } from "../introspect/prompts";

export interface InitOptions {
  dir?: string;
  connectionEnv?: string;
  systemName?: string;
  yes?: boolean;
  force?: boolean;
  prompts?: IntrospectPrompts;
  readerFactory?: (connectionString: string) => UserDbReader;
}

export interface InitResult {
  config: ChunkfunkConfigV1;
  introspection: IntrospectResult | null;
  created: boolean;
  path: string | null;
}

/**
 * `chunkfunk init` (§4.1) — introspects the database and writes chunkfunk.yaml.
 * Idempotent: if a config with a mapping already exists it is left untouched
 * (and the database is not touched) unless `force` is set.
 */
export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const {
    dir,
    connectionEnv = "DATABASE_URL",
    systemName = "my-rag",
    yes = false,
    force = false,
    prompts = inquirerPrompts,
    readerFactory = (connectionString) => new UserDbReader(connectionString),
  } = options;

  const existing = await loadConfig(dir);
  if (existing?.mapping && !force) {
    return { config: existing, introspection: null, created: false, path: null };
  }

  const connectionString = process.env[connectionEnv];
  if (!connectionString) {
    throw new Error(
      `Environment variable ${connectionEnv} is not set. Export your read-only connection string as ${connectionEnv} and re-run.`,
    );
  }

  const reader = readerFactory(connectionString);
  reader.setSystemSeed(systemName);
  try {
    const introspection = await introspect(reader, { yes, prompts });
    const configInput: ChunkfunkConfigV1Input = {
      version: 1,
      system: { name: systemName },
      connection: { env: connectionEnv },
      mapping: introspection.mapping,
    };
    const path = await writeConfig(configInput, dir);
    return { config: chunkfunkConfigV1Schema.parse(configInput), introspection, created: true, path };
  } finally {
    await reader.close();
  }
}
