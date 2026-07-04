import pc from "picocolors";
import type { FindingSeverity, ReportV1 } from "@chunkfunk/core";
import { SEVERITY_ORDER, groupFindings, severityCount } from "./group";

function scoreColor(score: number): (s: string) => string {
  if (score >= 80) return pc.green;
  if (score >= 60) return pc.yellow;
  return pc.red;
}

function fmtSub(value: number | null): string {
  return value === null ? " --" : String(Math.round(value)).padStart(3);
}

const SEVERITY_LABEL: Record<FindingSeverity, (s: string) => string> = {
  critical: pc.red,
  warning: pc.yellow,
  info: pc.dim,
};

/**
 * Terminal renderer (§4.4): big health score, subscore line, findings grouped by
 * severity (≤5 per type + overflow count), per-source freshness table, a
 * "Fix first" top-5 list, and a sync/share footer. Consumes ReportV1 only.
 */
export function renderTerminal(report: ReportV1): string {
  const lines: string[] = [];
  const color = scoreColor(report.health.score);

  lines.push("");
  lines.push(
    `  ${pc.bold("ChunkFunk")}   ${color(pc.bold(`${report.health.score}/100`))}  ` +
      pc.dim(`health · ${report.totals.chunks} chunks · ${report.totals.sources} sources`),
  );

  const s = report.health.subscores;
  lines.push(
    pc.dim(
      `  freshness ${fmtSub(s.freshness)}  duplication ${fmtSub(s.duplication)}  ` +
        `quality ${fmtSub(s.quality)}  risk ${fmtSub(s.risk)}  coverage ${fmtSub(s.coverage)}`,
    ),
  );

  const grouped = groupFindings(report);
  for (const severity of SEVERITY_ORDER) {
    const groups = grouped.get(severity) ?? [];
    if (groups.length === 0) continue;
    lines.push("");
    lines.push(
      SEVERITY_LABEL[severity](pc.bold(`${severity.toUpperCase()} (${severityCount(report, severity)})`)),
    );
    for (const group of groups) {
      for (const finding of group.shown) {
        lines.push(`  ${pc.dim(group.type)}  ${finding.title}`);
      }
      if (group.total > group.shown.length) {
        lines.push(pc.dim(`  ${group.type}  … +${group.total - group.shown.length} more`));
      }
    }
  }

  if (report.sources.length > 0) {
    lines.push("");
    lines.push(pc.bold("Sources"));
    for (const source of report.sources) {
      lines.push(`  ${source.locator}  ${pc.dim(`[${source.status}]`)}`);
    }
  }

  if (report.nextActions.length > 0) {
    lines.push("");
    lines.push(pc.bold("Fix first"));
    for (const action of report.nextActions) {
      lines.push(`  ${action.rank}. ${action.title}`);
    }
  }

  lines.push("");
  lines.push(pc.dim("  Run `chunkfunk sync` to track your health score over time."));
  lines.push("");
  return lines.join("\n");
}
