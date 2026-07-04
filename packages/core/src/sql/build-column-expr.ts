import type { MappingV1 } from "../schemas/mapping";

export type MappedField = keyof MappingV1["columns"];

const IDENTIFIER_PATTERN = /^[a-zA-Z0-9_.]+$/;
const JSON_PATH_PREFIX = "meta:";

function assertSafeIdentifier(value: string, field: MappedField): string[] {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(
      `Unsafe identifier in mapping for "${field}": identifiers must match ${IDENTIFIER_PATTERN}`,
    );
  }
  const parts = value.split(".");
  if (parts.some((part) => part.length === 0)) {
    throw new Error(
      `Unsafe identifier in mapping for "${field}": empty identifier segment`,
    );
  }
  return parts;
}

function quoteIdentifier(parts: string[]): string {
  return parts.map((part) => `"${part}"`).join(".");
}

/**
 * The ONLY place SQL expressions may be built from mapping data (§3.2).
 * Whitelist-validates every identifier against `^[a-zA-Z0-9_.]+$` to prevent
 * SQL injection. Values written as `meta:<jsonb_column>.<key>` become
 * `"jsonb_column"->>'key'`; plain column names are double-quoted.
 * Returns null when the field is not mapped.
 */
export function buildColumnExpr(
  mapping: MappingV1,
  field: MappedField,
): string | null {
  const raw = mapping.columns[field];
  if (raw === null) {
    return null;
  }
  if (raw.startsWith(JSON_PATH_PREFIX)) {
    const path = raw.slice(JSON_PATH_PREFIX.length);
    const separator = path.indexOf(".");
    if (separator <= 0 || separator === path.length - 1) {
      throw new Error(
        `Invalid JSON path mapping for "${field}": expected "meta:<jsonb_column>.<key>"`,
      );
    }
    const column = path.slice(0, separator);
    const key = path.slice(separator + 1);
    const columnParts = assertSafeIdentifier(column, field);
    assertSafeIdentifier(key, field);
    return `${quoteIdentifier(columnParts)}->>'${key}'`;
  }
  const parts = assertSafeIdentifier(raw, field);
  return quoteIdentifier(parts);
}
