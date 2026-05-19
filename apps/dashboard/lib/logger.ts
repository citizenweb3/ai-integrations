import pino, { type DestinationStream, type Logger } from "pino";
import { getRequestId } from "./request-context";

export function createDashboardLogger(destination?: DestinationStream): Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
      base: { service: "dashboard" },
      timestamp: () => `,"ts":"${new Date().toISOString()}"`,
      formatters: {
        level(label) {
          return { level: label };
        }
      },
      mixin() {
        const requestId = getRequestId();
        return requestId ? { requestId } : {};
      }
    },
    destination
  );
}

export const logger = createDashboardLogger();
