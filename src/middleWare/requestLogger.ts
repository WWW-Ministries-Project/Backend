import { Request, Response, NextFunction } from "express";
import { requestLogger } from "../utils/loggers";

export function logRequests(req: Request, res: Response, next: NextFunction) {
  if (req.originalUrl.startsWith("/metrics")) {
    return next();
  }
  const start = Date.now();

  const oldSend = res.send;

  let responseBody: any;
  res.send = function (body?: any): Response {
    responseBody = body;
    return oldSend.apply(this, arguments as any);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;

    let parsedBody: any;
    try {
      parsedBody =
        typeof responseBody === "string"
          ? JSON.parse(responseBody)
          : responseBody;
    } catch {
      parsedBody = responseBody;
    }

    requestLogger.info({
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      request: {
        headers: req.headers,
        query: req.query,
        body: req.body,
      },
      response: parsedBody,
    });
  });

  next();
}
