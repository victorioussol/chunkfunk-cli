import { describe, expect, it } from "vitest";
import { telemetryV1Schema, type TelemetryV1 } from "../src";

const validPayload: TelemetryV1 = {
  fingerprintHash: "a".repeat(64),
  frameworkGuess: "langchain",
  embeddingDims: 1536,
  totals: { documents: 10, chunks: 100 },
  findingCounts: { byType: { exact_duplicate: 2, risky_chunk: 1 } },
  healthScore: 55,
  mappingShape: { id: "langchain-pgvector" },
  cliVersion: "0.1.0",
  os: "darwin/arm64",
};

describe("TelemetryV1 schema", () => {
  it("accepts the published content-free payload shape", () => {
    expect(telemetryV1Schema.parse(validPayload)).toEqual(validPayload);
  });

  it("rejects fields capable of carrying document content or connection details", () => {
    for (const key of ["findings", "sources", "nextActions", "connection", "connectionString", "apiToken", "documents"]) {
      expect(() => telemetryV1Schema.parse({ ...validPayload, [key]: "secret" })).toThrow();
    }
  });

  it("constrains strings to enums, hashes, versions, or fingerprints", () => {
    expect(() => telemetryV1Schema.parse({ ...validPayload, frameworkGuess: "private framework name" })).toThrow();
    expect(() =>
      telemetryV1Schema.parse({
        ...validPayload,
        mappingShape: { id: "manual", columns: [{ role: "content", name: "customer_private_column" }] },
      }),
    ).toThrow();
    expect(() => telemetryV1Schema.parse({ ...validPayload, fingerprintHash: "raw fingerprint" })).toThrow();
  });
});
