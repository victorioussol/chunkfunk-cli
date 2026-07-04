import { telemetryV1Schema, type TelemetryV1 } from "@chunkfunk/core";
import { serializeTelemetryPayload } from "./payload";

export interface SendTelemetryOptions {
  payload: TelemetryV1;
  apiUrl: string;
  fetchFn?: typeof fetch;
}

export interface SendTelemetryResult {
  sent: boolean;
  status?: number;
}

function telemetryUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, "")}/api/telemetry`;
}

export async function sendTelemetry(options: SendTelemetryOptions): Promise<SendTelemetryResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const body = serializeTelemetryPayload(telemetryV1Schema.parse(options.payload));

  try {
    const response = await fetchFn(telemetryUrl(options.apiUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    return { sent: response.ok, status: response.status };
  } catch {
    return { sent: false };
  }
}
