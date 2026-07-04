import { describe, expect, it } from "vitest";
import { chunkfunkConfigV1Schema } from "../src/schemas/config";
import { mappingV1Schema } from "../src/schemas/mapping";
import { reportV1Schema } from "../src/schemas/report";
import configFixture from "./fixtures/chunkfunk-config.fixture.json";
import reportFixture from "./fixtures/report-v1.fixture.json";

describe("schema round-trips", () => {
  it("ReportV1 fixture parses and round-trips unchanged", () => {
    const parsed = reportV1Schema.parse(reportFixture);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(reportFixture);
  });

  it("MappingV1 fixture parses and round-trips unchanged", () => {
    const mappingFixture = reportFixture.stack.mapping;
    const parsed = mappingV1Schema.parse(mappingFixture);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(mappingFixture);
  });

  it("chunkfunk.yaml config fixture parses and round-trips unchanged", () => {
    const parsed = chunkfunkConfigV1Schema.parse(configFixture);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(configFixture);
  });

  it("rejects a report with an unknown finding type", () => {
    const bad = structuredClone(reportFixture) as Record<string, unknown>;
    (bad.findings as { type: string }[])[0].type = "made_up_type";
    expect(() => reportV1Schema.parse(bad)).toThrow();
  });

  it("rejects a report with an out-of-range health score", () => {
    const bad = structuredClone(reportFixture) as {
      health: { score: number };
    };
    bad.health.score = 101;
    expect(() => reportV1Schema.parse(bad)).toThrow();
  });

  it("applies telemetry/sync defaults for a minimal config", () => {
    const parsed = chunkfunkConfigV1Schema.parse({
      version: 1,
      system: { name: "my-rag" },
      connection: { env: "DATABASE_URL" },
    });
    expect(parsed.telemetry).toBe(false);
    expect(parsed.sync).toBeUndefined();
  });
});
