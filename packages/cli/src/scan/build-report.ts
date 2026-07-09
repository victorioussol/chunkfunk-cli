import { randomUUID } from "node:crypto";
import {
  reportV1Schema,
  type FindingSeverity,
  type FindingV1,
  type HeuristicRunResult,
  type MappingV1,
  type ReportV1,
} from "@chunkfunk/core";
import type { StackMeta } from "../introspect/introspect";
import { capFindingEvidence } from "./evidence";
import { safeLocatorLabel } from "../privacy/safe-label";

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function nextActionKey(finding: FindingV1): string {
  if (finding.suggestedRepair?.kind) return finding.suggestedRepair.kind;
  if (finding.type === "exact_duplicate" || finding.type === "near_duplicate") {
    return finding.type;
  }
  return `${finding.type}:${finding.title}`;
}

export interface BuildReportInput {
  mapping: MappingV1;
  stackMeta: StackMeta;
  detector: HeuristicRunResult;
  totals: { documents: number; chunks: number; sources: number };
  sources: { locator: string; kind: string }[];
  startedAt: string;
  finishedAt: string;
  cliVersion?: string;
}

/** Top-5 findings by severity → ranked next actions referencing finding indices. */
function buildNextActions(findings: FindingV1[]): ReportV1["nextActions"] {
  const grouped = new Map<string, { finding: FindingV1; refs: number[]; affectedCount: number }>();

  findings.forEach((finding, index) => {
    const key = nextActionKey(finding);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        finding,
        refs: [index],
        affectedCount: finding.affectedCount,
      });
      return;
    }

    existing.refs.push(index);
    existing.affectedCount += finding.affectedCount;
    if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[existing.finding.severity]) {
      existing.finding = finding;
    }
  });

  return [...grouped.values()]
    .sort((a, b) => {
      const severity = SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity];
      if (severity !== 0) return severity;
      return b.affectedCount - a.affectedCount;
    })
    .slice(0, 5)
    .map((entry, rank) => ({
      rank: rank + 1,
      title: entry.finding.title,
      findingRefs: entry.refs,
    }));
}

/**
 * Assembles a validated ReportV1 (§3.1) from the detector run. Evidence strings
 * are capped to 500 chars here, at emit time, and the whole report is parsed
 * through the zod schema before it can leave the process (defense in depth).
 */
export function buildReport(input: BuildReportInput): ReportV1 {
  const findings = input.detector.findings.map(capFindingEvidence);

  const report: ReportV1 = {
    version: 1,
    scan: {
      id: randomUUID(),
      origin: "cli",
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      ...(input.cliVersion ? { cliVersion: input.cliVersion } : {}),
    },
    stack: {
      fingerprintHash: input.stackMeta.fingerprintHash,
      frameworkGuess: input.stackMeta.frameworkGuess,
      embeddingDims: input.stackMeta.embeddingDims,
      embeddingModelGuess: input.stackMeta.embeddingModelGuess,
      mapping: input.mapping,
    },
    totals: input.totals,
    health: {
      score: input.detector.score,
      scoreVersion: 1,
      subscores: input.detector.subscores,
    },
    findings,
    sources: input.sources.map((s) => ({
      locator: safeLocatorLabel(s.locator),
      kind: s.kind,
      lastIndexedAt: null,
      lastChangedAt: null,
      status: "unknown" as const,
    })),
    nextActions: buildNextActions(findings),
  };

  return reportV1Schema.parse(report);
}
