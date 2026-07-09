import { createHash } from "node:crypto";
import { buildColumnExpr } from "../../sql/build-column-expr";
import type { FindingV1 } from "../../schemas/report";
import type { DetectorContext } from "./types";

export interface FreshnessResult {
  findings: FindingV1[];
  /** Percentage of documents considered stale, or null when unmeasurable. */
  staleDocsPct: number | null;
}

const MISSING_TIMESTAMP_WARNING_PCT = 20;

function hashLocator(locator: string): string {
  return `sha256:${createHash("sha256").update(locator).digest("hex").slice(0, 16)}`;
}

/**
 * §5.5 — freshness needs a mapped `updatedAt` column AND/OR source snapshots.
 * When no timestamp is mapped, emit a single `architecture` finding with a
 * copy-paste ALTER TABLE using the real table name. Otherwise flag changed
 * sources and documents older than the newest changed source signal.
 */
export async function runFreshness(ctx: DetectorContext): Promise<FreshnessResult> {
  const hasUpdatedAt = buildColumnExpr(ctx.mapping, "updatedAt") !== null;
  const changedSnapshots = ctx.sourceSnapshots.filter((s) => s.changed);
  const findings: FindingV1[] = [];

  if (!hasUpdatedAt) {
    findings.push({
      type: "architecture",
      severity: "warning",
      title: "Your index has no timestamps — staleness can't be measured",
      evidence: { table: ctx.mapping.table },
      suggestedRepair: {
        kind: "add_column",
        description:
          "Add an updated_at column so document and source freshness can be measured.",
        sql: `ALTER TABLE ${ctx.mapping.table} ADD COLUMN updated_at timestamptz default now();`,
      },
      affectedCount: 1,
    });
  }

  if (!hasUpdatedAt && changedSnapshots.length === 0) {
    return { findings, staleDocsPct: null };
  }

  // A source whose watcher signal changed since the last snapshot is stale.
  for (const snapshot of changedSnapshots) {
    findings.push({
      type: "stale_source",
      severity: "warning",
      title: "Source changed since last scan",
      evidence: {
        locatorHash: hashLocator(snapshot.locator),
        signalKind: snapshot.signalKind,
        observedAt: snapshot.observedAt,
      },
      affectedCount: 1,
    });
  }

  let staleDocsPct: number | null = null;
  if (hasUpdatedAt) {
    const newestChange = changedSnapshots
      .map((s) => Date.parse(s.observedAt))
      .filter((t) => !Number.isNaN(t))
      .reduce((max, t) => Math.max(max, t), Number.NEGATIVE_INFINITY);

    let stale = 0;
    let measured = 0;
    let missingTimestamps = 0;
    for await (const chunk of ctx.reader.streamChunks({ maxChunks: ctx.limits.maxChunks })) {
      if (chunk.updatedAt === null) {
        missingTimestamps += 1;
        continue;
      }
      measured += 1;
      const indexed = Date.parse(chunk.updatedAt);
      if (
        newestChange !== Number.NEGATIVE_INFINITY &&
        !Number.isNaN(indexed) &&
        indexed < newestChange
      ) {
        stale += 1;
      }
    }
    const scanned = measured + missingTimestamps;
    const missingTimestampPct = scanned > 0 ? (missingTimestamps / scanned) * 100 : 0;
    if (scanned > 0 && missingTimestampPct >= MISSING_TIMESTAMP_WARNING_PCT) {
      findings.push({
        type: "architecture",
        severity: "warning",
        title: measured === 0
          ? "Mapped timestamp column is empty"
          : "Many chunks have no timestamp, so freshness is partial",
        evidence: {
          scannedChunks: scanned,
          timestampedChunks: measured,
          missingTimestampChunks: missingTimestamps,
          missingTimestampPct: Number(missingTimestampPct.toFixed(1)),
          sampled: Boolean(ctx.sampled),
        },
        suggestedRepair: {
          kind: "backfill_timestamps",
          description: "Backfill the mapped timestamp column so stale and latest-data retrieval problems can be measured reliably.",
        },
        affectedCount: missingTimestamps,
      });
    }
    staleDocsPct = measured > 0 ? ((stale + missingTimestamps) / scanned) * 100 : null;
    if (stale > 0) {
      findings.push({
        type: "stale_document",
        severity: "warning",
        title: `${stale} documents are older than a changed source`,
        evidence: { staleDocuments: stale, measuredDocuments: measured },
        affectedCount: stale,
      });
    }
  }

  return { findings, staleDocsPct };
}
