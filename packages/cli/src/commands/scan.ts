import { writeFile } from "node:fs/promises";
import {
  DEFAULT_LIMITS,
  DEFAULT_THRESHOLDS,
  runHeuristicDetectors,
  type ChunkfunkConfigV1,
  type DetectorContext,
  type DetectorLimits,
  type DetectorThresholds,
  type MappingV1,
  type ChunkfunkConfigV1Input,
  type ReportV1,
} from "@chunkfunk/core";
import { UserDbReader } from "../db/reader";
import { loadConfigWithMetadata, writeConfig } from "../config/yaml";
import {
  introspect,
  stackMetaForMapping,
  type StackMeta,
} from "../introspect/introspect";
import { inquirerPrompts, type IntrospectPrompts } from "../introspect/prompts";
import { buildReport } from "../scan/build-report";
import { renderHtml } from "../render/html";
import { renderJson } from "../render/json";
import { renderTerminal } from "../render/terminal";
import { DEFAULT_API_URL, readCredentials } from "../auth/credentials";
import { syncReport } from "../sync/client";
import { buildTelemetryPayload, type TelemetryRecipeId } from "../telemetry/payload";
import { sendTelemetry } from "../telemetry/client";
import { confirm as confirmPrompt } from "@inquirer/prompts";
import { readPackageVersion } from "../version";

export const DEFAULT_MIN_SCORE = 70;

export interface ScanOptions {
  dir?: string;
  connectionEnv?: string;
  systemName?: string;
  json?: boolean;
  htmlPath?: string;
  ci?: boolean;
  yes?: boolean;
  minScore?: number;
  nonInteractive?: boolean;
  render?: boolean;
  offerSync?: boolean;
  offerTelemetry?: boolean;
  syncPrompt?: (message: string) => Promise<boolean>;
  telemetryPrompt?: (message: string) => Promise<boolean>;
  telemetryFetchFn?: typeof fetch;
  prompts?: IntrospectPrompts;
  readerFactory?: (connectionString: string) => UserDbReader;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export interface ScanResult {
  report: ReportV1;
  exitCode: number;
}

function resolveThresholds(config: ChunkfunkConfigV1 | null): {
  thresholds: DetectorThresholds;
  limits: DetectorLimits;
} {
  const t = config?.thresholds;
  return {
    thresholds: {
      nearDuplicateCosine: t?.nearDuplicateCosine ?? DEFAULT_THRESHOLDS.nearDuplicateCosine,
      thinChunkMinChars: t?.thinChunkMinChars ?? DEFAULT_THRESHOLDS.thinChunkMinChars,
      linkNavDensity: t?.linkNavDensity ?? DEFAULT_THRESHOLDS.linkNavDensity,
    },
    limits: {
      maxChunks: t?.maxChunks ?? DEFAULT_LIMITS.maxChunks,
      nearDupProbes: t?.nearDupProbes ?? DEFAULT_LIMITS.nearDupProbes,
    },
  };
}

/**
 * `chunkfunk scan` (§4.1): load/create chunkfunk.yaml → connect read-only →
 * introspect (skipped when a mapping exists) → run detectors → render. In
 * `--json` mode ONLY ReportV1 is written to stdout; every log goes to stderr.
 * `--ci` sets exit code 1 when the health score is below `--min-score`.
 */
export async function runScan(options: ScanOptions = {}): Promise<ScanResult> {
  const {
    dir,
    json = false,
    htmlPath,
    ci = false,
    yes = false,
    minScore = DEFAULT_MIN_SCORE,
    nonInteractive = json || ci,
    render = true,
    offerSync = true,
    offerTelemetry = true,
    syncPrompt = (message) => confirmPrompt({ message, default: true }),
    telemetryPrompt = (message) => confirmPrompt({ message, default: false }),
    telemetryFetchFn,
    prompts = inquirerPrompts,
    readerFactory = (connectionString) => new UserDbReader(connectionString),
    stdout = (text) => process.stdout.write(text),
    stderr = (text) => process.stderr.write(text),
  } = options;

  const loadedConfig = await loadConfigWithMetadata(dir);
  const config = loadedConfig?.config ?? null;
  let telemetryConfigured = loadedConfig?.telemetryConfigured ?? false;
  const connectionEnv = config?.connection.env ?? options.connectionEnv ?? "DATABASE_URL";
  const systemName = config?.system.name ?? options.systemName ?? "my-rag";
  const sources = (config?.sources ?? []).map((s) => ({ locator: s.locator, kind: s.kind }));

  const connectionString = process.env[connectionEnv];
  if (!connectionString) {
    throw new Error(
      `Environment variable ${connectionEnv} is not set. Export your read-only connection string as ${connectionEnv} and re-run.`,
    );
  }

  const reader = readerFactory(connectionString);
  reader.setSystemSeed(systemName);
  try {
    let mapping: MappingV1;
    let stackMeta: StackMeta;
    let telemetryRecipeId: TelemetryRecipeId | null = null;

    if (config?.mapping) {
      mapping = config.mapping;
      stackMeta = await stackMetaForMapping(reader, mapping);
    } else {
      stderr("Introspecting database…\n");
      const intro = await introspect(reader, {
        yes: yes || nonInteractive,
        allowInteractive: !nonInteractive,
        prompts,
      });
      mapping = intro.mapping;
      stackMeta = {
        fingerprintHash: intro.fingerprintHash,
        frameworkGuess: intro.frameworkGuess,
        embeddingDims: intro.embeddingDims,
        embeddingModelGuess: intro.embeddingModelGuess,
      };
      telemetryRecipeId = intro.recipeId === "manual" ? null : (intro.recipeId as TelemetryRecipeId);
      await writeConfig(
        { version: 1, system: { name: systemName }, connection: { env: connectionEnv }, mapping },
        dir,
      );
    }

    reader.setMapping(mapping);
    const { thresholds, limits } = resolveThresholds(config);
    const totalChunks = await reader.countChunks();
    const distinctDocuments = await reader.countDistinctDocuments();
    const documents = distinctDocuments ?? totalChunks;

    const ctx: DetectorContext = {
      systemId: systemName,
      mapping,
      reader,
      sourceSnapshots: [],
      thresholds,
      limits,
      totalChunks,
      sampled: totalChunks > limits.maxChunks,
      inventory: config?.inventory
        ? {
            ...config.inventory,
            observedDocuments: distinctDocuments,
          }
        : undefined,
    };

    stderr("Running detectors…\n");
    const startedAt = new Date().toISOString();
    const detector = await runHeuristicDetectors(ctx);
    const finishedAt = new Date().toISOString();

    const report = buildReport({
      mapping,
      stackMeta,
      detector,
      totals: { documents, chunks: totalChunks, sources: sources.length },
      sources,
      startedAt,
      finishedAt,
      cliVersion: readPackageVersion(),
    });

    if (render) {
      if (json) {
        stdout(`${renderJson(report)}\n`);
      } else {
        stdout(`${renderTerminal(report)}\n`);
      }
    }

    if (htmlPath) {
      await writeFile(htmlPath, renderHtml(report), "utf8");
      stderr(`Wrote HTML report to ${htmlPath}\n`);
    }

    if (render && offerSync && !json && !ci) {
      const credentials = await readCredentials();
      if (credentials && (await syncPrompt("Sync this scan to ChunkFunk?"))) {
        const response = await syncReport({
          credentials,
          report,
          apiUrl: config?.sync?.apiUrl ?? DEFAULT_API_URL,
        });
        stderr(`Synced scan ${response.scanId}\n`);
      }
    }

    let telemetryEnabled = telemetryConfigured && config?.telemetry === true;
    if (offerTelemetry && !json && !ci && !nonInteractive && !telemetryConfigured) {
      const consent = await telemetryPrompt("Send anonymous CLI telemetry to ChunkFunk?");
      telemetryConfigured = true;
      telemetryEnabled = consent;
      const configToWrite: ChunkfunkConfigV1Input = {
        version: 1,
        system: { name: systemName },
        connection: { env: connectionEnv },
        mapping,
        ...(config?.sources ? { sources: config.sources } : {}),
        ...(config?.inventory ? { inventory: config.inventory } : {}),
        ...(config?.sync ? { sync: config.sync } : {}),
        telemetry: consent,
        ...(config?.thresholds ? { thresholds: config.thresholds } : {}),
      };
      await writeConfig(configToWrite, dir);
    }

    if (offerTelemetry && telemetryEnabled) {
      await sendTelemetry({
        payload: buildTelemetryPayload(report, { recipeId: telemetryRecipeId }),
        apiUrl: config?.sync?.apiUrl ?? DEFAULT_API_URL,
        fetchFn: telemetryFetchFn,
      });
    }

    const exitCode = ci && report.health.score < minScore ? 1 : 0;
    return { report, exitCode };
  } finally {
    await reader.close();
  }
}
