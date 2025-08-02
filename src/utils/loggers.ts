import { Logger } from "winston";
import { createCustomLogger } from "./logger-config";

const commonOptions = {
  levels: "warn",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  timestamp: true,
  handleExceptions: true,
  humanReadableUnhandledException: true,
  prettyPrint: true,
  json: true,
  maxSize: "20m",
  colorize: true,
  maxFiles: "7d",
};
/**
 * @description This object contains the configurations for the logger
 */
export const logs = {
  requisition: {
    ...commonOptions,
    filename: "./logs/mails" + "/%DATE%.log",
  },
  requests: {
    ...commonOptions,
    filename: "./logs/requests/%DATE%.log",
  },
};


export const warnOptions = {
  ...logs,
};

export const loggers: Record<string, Logger> = {
  requisitionLogger: createCustomLogger(warnOptions.requisition),
  requestLogger: createCustomLogger(logs.requests),
};

export const { requisitionLogger, requestLogger } = loggers;
