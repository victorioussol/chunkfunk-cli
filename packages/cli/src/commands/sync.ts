import pc from "picocolors";
import type { ReportV1, ScanSyncResponse } from "@chunkfunk/core";
import { DEFAULT_API_URL, readCredentials, type CliCredentials } from "../auth/credentials";
import { loadConfig } from "../config/yaml";
import { runScan } from "./scan";
import { syncReport } from "../sync/client";

export interface SyncOptions {
  dir?: string;
  yes?: boolean;
  apiUrl?: string;
  report?: ReportV1;
  credentials?: CliCredentials;
  fetchFn?: typeof fetch;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export async function runSync(options: SyncOptions = {}): Promise<ScanSyncResponse> {
  const stdout = options.stdout ?? ((text) => process.stdout.write(text));
  const stderr = options.stderr ?? ((text) => process.stderr.write(text));
  const credentials = options.credentials ?? (await readCredentials());
  if (!credentials) throw new Error("Not logged in. Run chunkfunk login first.");
  const config = await loadConfig(options.dir);
  const apiUrl = options.apiUrl ?? config?.sync?.apiUrl ?? DEFAULT_API_URL;

  const report =
    options.report ??
    (
      await runScan({
        dir: options.dir,
        yes: options.yes,
        nonInteractive: true,
        render: false,
        stdout: () => undefined,
        stderr,
      })
    ).report;

  const response = await syncReport({ credentials, report, apiUrl, fetchFn: options.fetchFn });
  stdout(`${pc.green("✓")} Synced scan ${response.scanId}\n`);
  if (response.delta) {
    stdout(
      pc.dim(
        `  Previous score ${response.delta.previousScore} from ${response.delta.previousScanAt}\n`,
      ),
    );
  }
  stdout(pc.dim(`  ${response.dashboardUrl}\n`));
  return response;
}
