/**
 * Deterministic PRNG + embedding helpers so every seed run produces byte-for-byte
 * identical fixtures — the planted-problem counts in README.md must be exact and
 * reproducible (asserted by PR-03 detector tests).
 */

/** mulberry32 — small, fast, deterministic PRNG seeded by a 32-bit integer. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random unit vector of the given dimension. */
export function unitVector(dim: number, rng: () => number): number[] {
  const v = new Array<number>(dim);
  let norm = 0;
  for (let i = 0; i < dim; i += 1) {
    // Box-Muller for a roughly gaussian component → uniform direction on the sphere.
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    v[i] = g;
    norm += g * g;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i += 1) v[i] /= norm;
  return v;
}

/**
 * A unit vector near `base`: base + t*noise, renormalized. With t≈0.1 the cosine
 * similarity to `base` is ≥ ~0.98, comfortably above the 0.97 near-duplicate
 * threshold, while the two vectors remain distinct.
 */
export function nearVector(
  base: number[],
  t: number,
  rng: () => number,
): number[] {
  const noise = unitVector(base.length, rng);
  const v = base.map((b, i) => b + t * noise[i]);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

/** Cosine similarity — used by the seed self-check to guarantee planted pairs are ≥ threshold. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** pgvector literal, e.g. "[0.1,0.2,...]". */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}
