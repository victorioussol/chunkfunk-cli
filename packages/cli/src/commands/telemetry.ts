import { buildTelemetryPayload, serializeTelemetryPayload } from "../telemetry/payload";
import { runScan } from "./scan";

export interface ShowTelemetryOptions {
  dir?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export async function runShowTelemetry(options: ShowTelemetryOptions = {}) {
  const stdout = options.stdout ?? ((text) => process.stdout.write(text));
  const stderr = options.stderr ?? ((text) => process.stderr.write(text));
  const { report } = await runScan({
    dir: options.dir,
    nonInteractive: true,
    render: false,
    offerTelemetry: false,
    stdout: () => undefined,
    stderr,
  });
  const payload = buildTelemetryPayload(report);
  stdout(serializeTelemetryPayload(payload));
  return payload;
}
