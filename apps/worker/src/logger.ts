import pino, { type DestinationStream, type Logger } from "pino";

export type WorkerLogLevel = "debug" | "info" | "warn" | "error";

export function createWorkerLogger(
  service = "worker",
  destination?: DestinationStream
): Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
      base: { service },
      timestamp: () => `,"ts":"${new Date().toISOString()}"`,
      formatters: {
        level(label) {
          return { level: label };
        }
      }
    },
    destination
  );
}
