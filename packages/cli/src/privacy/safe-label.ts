import { createHash } from "node:crypto";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function safeLocatorLabel(locator: string): string {
  let prefix = "source";
  try {
    const parsed = new URL(locator);
    prefix = `${parsed.protocol.replace(":", "")} source`;
  } catch {
    // Keep non-URL locators private too; the hash is enough to compare reports.
  }
  return `${prefix} sha256:${hash(locator)}`;
}
