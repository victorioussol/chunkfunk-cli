import { z } from "zod";
import { reportV1Schema } from "./report";

const isoDatetime = z.iso.datetime({ offset: true });

export const scanSyncRequestSchema = z.object({
  report: reportV1Schema,
});

export type ScanSyncRequest = z.infer<typeof scanSyncRequestSchema>;

export const scanSyncResponseSchema = z.object({
  scanId: z.uuid(),
  dashboardUrl: z.url(),
  delta: z
    .object({
      previousScore: z.number().int().min(0).max(100),
      previousScanAt: isoDatetime,
    })
    .optional(),
});

export type ScanSyncResponse = z.infer<typeof scanSyncResponseSchema>;
