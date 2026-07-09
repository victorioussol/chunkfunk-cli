/**
 * Deterministic text generators. Healthy chunks are long enough (> 200 chars),
 * capitalized, and terminated so no detector flags them; planted-problem text is
 * crafted to trip exactly one detector.
 */

const TOPICS = [
  "onboarding",
  "billing",
  "retrieval",
  "embeddings",
  "deployment",
  "security",
  "analytics",
  "webhooks",
  "rate limits",
  "data retention",
];

const BODY_SENTENCES = [
  "The service ingests documents and splits them into overlapping chunks before embedding.",
  "Each request is authenticated with a workspace-scoped token and rate limited per plan.",
  "Retrieval ranks candidate chunks by cosine similarity and returns the top matches.",
  "Configuration is validated at startup so misconfigured deployments fail fast.",
  "Background workers reconcile source snapshots and refresh stale indexes on a schedule.",
];

/** A healthy, non-thin, secret-free chunk keyed deterministically by index. */
export function healthyChunk(i: number): string {
  const topic = TOPICS[i % TOPICS.length];
  const a = BODY_SENTENCES[i % BODY_SENTENCES.length];
  const b = BODY_SENTENCES[(i + 2) % BODY_SENTENCES.length];
  return `Guide to ${topic} (section ${i}). ${a} ${b} See the reference documentation for the full list of options and defaults.`;
}

/** Base text for an exact-duplicate group. */
export function duplicateBase(group: number): string {
  return `Our refund policy allows cancellation within thirty days of purchase for a full refund. Contact support to start the process for group ${group}.`;
}

/**
 * A member of an exact-duplicate group. For "normalization-only" groups the raw
 * text differs only by letter case and *internal* whitespace runs between copies,
 * so any reasonable normalizer (lowercase + collapse whitespace) groups them —
 * without relying on leading/trailing trimming, which is not guaranteed.
 */
export function duplicateMember(
  group: number,
  copy: number,
  normalizationOnly: boolean,
): string {
  const base = duplicateBase(group);
  if (!normalizationOnly) return base;
  if (copy === 0) return base;
  if (copy === 1) return base.toUpperCase();
  return base.replace(/ /g, "  "); // double internal spaces, same case
}

/**
 * Distinct text for the two members of a near-duplicate pair. Kept well over 120
 * characters so a near-duplicate is NOT also flagged as a thin chunk — the two
 * planted counts must not overlap.
 */
export function nearDuplicateText(pair: number, member: number): string {
  const variants = [
    `Release ${pair}: the background scheduler now retries failed source polls using exponential backoff with randomized jitter, which smooths out load spikes and avoids the thundering-herd problem when many watchers wake at once.`,
    `Release ${pair} notes: the background scheduler retries failed source polls with exponentially increasing delays and randomized jitter, smoothing load spikes and preventing a thundering herd when many watchers wake simultaneously.`,
  ];
  return variants[member];
}

/** A thin chunk (< 120 chars after normalization). */
export function thinChunk(i: number): string {
  return `Note ${i}.`;
}

/** A chunk that embeds a fake secret in otherwise normal, long-enough prose. */
export function secretChunk(secret: string): string {
  return `Example configuration for local development. Set the credential in your environment file: ${secret}. Never commit real credentials to a source repository, and rotate them if exposed.`;
}

/** A second long text column value (fixture C uses two text-like columns). */
export function summaryText(i: number): string {
  const topic = TOPICS[i % TOPICS.length];
  return `Summary of the ${topic} section: covers setup, common pitfalls, and the recommended defaults for production use across typical workspace sizes.`;
}

/** A markdown-table-like chunk for structured-data health fixtures. */
export function tableLikeChunk(i: number): string {
  const code = 1000 + i;
  return [
    "| product_code | region | renewal_status | owner_group |",
    "| --- | --- | --- | --- |",
    `| SKU-${code} | EU | active | support-${i % 3} |`,
    `| SKU-${code + 1} | US | paused | success-${i % 2} |`,
    `| SKU-${code + 2} | APAC | review | operations-${i % 4} |`,
    "This structured extract is used by retrieval to answer account and renewal questions.",
  ].join("\n");
}

/** A long-enough chunk that looks like it was cut out of the middle of prose. */
export function boundaryFragmentChunk(i: number): string {
  return `and continues the handbook explanation from the previous paragraph with enough procedural detail for retrieval to rank it, but without the opening sentence or a clean ending marker ${i}`;
}

export function sourceUrl(i: number): string {
  return `https://docs.example.com/${TOPICS[i % TOPICS.length].replace(/ /g, "-")}/${i}`;
}
