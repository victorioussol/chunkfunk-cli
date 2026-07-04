import { createHash } from "node:crypto";

// Zero-width and BOM characters stripped before hashing (§5.1).
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

/**
 * Canonical content normalization shared by every text detector and by any
 * reader that computes `contentHash` — the SINGLE definition, so a chunk hashes
 * identically no matter who normalized it (§5.1: lowercase, collapse whitespace,
 * strip zero-width). Leading/trailing whitespace is trimmed as part of
 * "collapse whitespace".
 */
export function normalizeContent(raw: string): string {
  return raw
    .replace(ZERO_WIDTH, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** SHA-256 of the normalized content, hex-encoded. */
export function hashContent(raw: string): string {
  return createHash("sha256").update(normalizeContent(raw)).digest("hex");
}

/** Normalized character length — the value a reader reports as `length`. */
export function normalizedLength(raw: string): number {
  return normalizeContent(raw).length;
}
