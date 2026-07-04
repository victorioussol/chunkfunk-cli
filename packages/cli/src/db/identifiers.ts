const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;

/**
 * Quotes a possibly schema-qualified identifier (e.g. `public.langchain_pg_embedding`)
 * after whitelist-validating every segment. Identifiers only ever come from the
 * Postgres catalog, but they are validated + quoted anyway as defense in depth.
 */
export function quoteIdent(identifier: string): string {
  const parts = identifier.split(".");
  return parts
    .map((part) => {
      if (!SAFE_IDENTIFIER.test(part)) {
        throw new Error(`Unsafe identifier: ${identifier}`);
      }
      return `"${part}"`;
    })
    .join(".");
}
