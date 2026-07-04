export {
  jsonValueSchema,
  jsonObjectSchema,
  type JsonValue,
  type JsonObject,
} from "./schemas/json";
export { mappingV1Schema, type MappingV1 } from "./schemas/mapping";
export {
  findingTypeSchema,
  findingSeveritySchema,
  suggestedRepairSchema,
  findingV1Schema,
  healthSubscoresSchema,
  sourceStatusSchema,
  reportV1Schema,
  type FindingType,
  type FindingSeverity,
  type SuggestedRepair,
  type FindingV1,
  type HealthSubscores,
  type SourceStatus,
  type ReportV1,
} from "./schemas/report";
export {
  sourceKindSchema,
  chunkfunkConfigV1Schema,
  type SourceKind,
  type ChunkfunkConfigV1,
  type ChunkfunkConfigV1Input,
} from "./schemas/config";
export { buildColumnExpr, type MappedField } from "./sql/build-column-expr";
export {
  HEALTH_SCORE_VERSION,
  HEALTH_WEIGHTS,
  computeHealthScore,
  freshnessSubscore,
  duplicationSubscore,
  qualitySubscore,
  riskSubscore,
  coverageSubscore,
} from "./health";
export * from "./detectors/heuristic";
export {
  MAX_EVIDENCE_CHARS,
  capFindingEvidence,
  capReportEvidence,
} from "./report/evidence";
export * from "./schemas/sync";
export {
  telemetryCommonIdentifierSchema,
  telemetryHashedIdentifierSchema,
  telemetryIdentifierSchema,
  telemetryRecipeIdSchema,
  telemetryFrameworkGuessSchema,
  telemetryMappingRoleSchema,
  telemetryMappingShapeSchema,
  telemetryV1Schema,
  type TelemetryV1,
  type TelemetryMappingShape,
} from "./schemas/telemetry";
