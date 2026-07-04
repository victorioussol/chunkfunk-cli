import { scanSyncResponseSchema, type ReportV1, type ScanSyncResponse } from "@chunkfunk/core";
import type { CliCredentials } from "../auth/credentials";

export interface SyncReportOptions {
  credentials: CliCredentials;
  report: ReportV1;
  apiUrl: string;
  fetchFn?: typeof fetch;
}

function endpoint(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/api/scans`;
}

function errorMessage(status: number, body: unknown): string {
  const detail =
    body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? ` ${body.error}`
      : "";

  if (status === 401) return "Sync failed: invalid or revoked token. Run chunkfunk login first.";
  if (status === 413) return "Sync failed: report is larger than 1 MB.";
  if (status === 429) return "Sync failed: rate limit exceeded. Try again later.";
  return `Sync failed with HTTP ${status}.${detail}`;
}

export async function syncReport(options: SyncReportOptions): Promise<ScanSyncResponse> {
  const fetchImpl = options.fetchFn ?? fetch;
  const response = await fetchImpl(endpoint(options.apiUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.credentials.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ report: options.report }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(response.status, body));

  return scanSyncResponseSchema.parse(body);
}
