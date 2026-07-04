import { createHash } from "node:crypto";

/** sha256 of canonical JSON — used for the stack fingerprint hash (§4.3). */
export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
