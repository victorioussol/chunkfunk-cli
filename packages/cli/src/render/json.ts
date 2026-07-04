import type { ReportV1 } from "@chunkfunk/core";

/** ReportV1 as pretty JSON — the ONLY thing `--json` writes to stdout (§4.1). */
export function renderJson(report: ReportV1): string {
  return JSON.stringify(report, null, 2);
}
