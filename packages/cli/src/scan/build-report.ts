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

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

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
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity])
    .slice(0, 5)
    .map((entry, rank) => ({
      rank: rank + 1,
      title: entry.finding.title,
      findingRefs: [entry.index],
    }));
}

/**
 * Assembles a validated ReportV1 (§3.1) from the detector run. Evidence excerpts
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
      locator: s.locator,
      kind: s.kind,
      lastIndexedAt: null,
      lastChangedAt: null,
      status: "unknown" as const,
    })),
    nextActions: buildNextActions(findings),
  };

  return reportV1Schema.parse(report);
}
