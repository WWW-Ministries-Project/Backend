import { createLogger, format, transports, Logger } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import * as dotenv from "dotenv";
dotenv.config();

const logTimeFormat = "MMM-DD-YYYY HH:mm:ss";

const consoleFormat = format.combine(
  format.label({ label: "\n" }),
  format.timestamp({ format: logTimeFormat }),
  format.printf(
    ({ level, message, timestamp }) => `[${timestamp}] ${level}: ${message}`,
  ),
);

const consoleTransport = new transports.Console({
  format: consoleFormat,
  level: process.env.NODE_ENV === "development" ? "debug" : "info",
});
const logger = createLogger({
  transports: [consoleTransport],
});

export const createCustomLogger = (options: any) =>
  createLogger({
    level: "info",
    format: format.combine(
      format.label({ label: "\n" }),
      format.timestamp({ format: logTimeFormat }),
      format.json(),
    ),
    transports: [
      new transports.Console({
        level: "warn",
        format: format.combine(
          format.label({ label: "\n" }),
          format.timestamp({ format: logTimeFormat }),
          format.printf(
            (warn) =>
              `${warn.level}: ${warn.label}: ${[warn.timestamp]}: ${
                warn.message
              }`,
          ),
          format.colorize({ all: true }),
        ),
      }),
      new DailyRotateFile(options),
    ],
  });

export default logger;
