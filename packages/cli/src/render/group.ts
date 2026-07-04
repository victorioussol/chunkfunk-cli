import type { FindingSeverity, FindingV1, ReportV1 } from "@chunkfunk/core";

export const SEVERITY_ORDER: FindingSeverity[] = ["critical", "warning", "info"];
export const MAX_PER_TYPE = 5;

export interface TypeGroup {
  type: string;
  shown: FindingV1[];
  total: number;
}

/** Groups findings by severity, then by type, capping each type at 5 shown. */
export function groupFindings(report: ReportV1): Map<FindingSeverity, TypeGroup[]> {
  const bySeverity = new Map<FindingSeverity, Map<string, FindingV1[]>>();
  for (const severity of SEVERITY_ORDER) bySeverity.set(severity, new Map());

  for (const finding of report.findings) {
    const byType = bySeverity.get(finding.severity);
    if (!byType) continue;
    const list = byType.get(finding.type) ?? [];
    list.push(finding);
    byType.set(finding.type, list);
  }

  const result = new Map<FindingSeverity, TypeGroup[]>();
  for (const severity of SEVERITY_ORDER) {
    const groups: TypeGroup[] = [];
    for (const [type, list] of bySeverity.get(severity) ?? []) {
      groups.push({ type, shown: list.slice(0, MAX_PER_TYPE), total: list.length });
    }
    result.set(severity, groups);
  }
  return result;
}

export function severityCount(report: ReportV1, severity: FindingSeverity): number {
  return report.findings.filter((f) => f.severity === severity).length;
}
