import "express";

declare global {
  namespace Express {
    interface Request {
      /**
       * Raw request bytes, captured by the express.json verify hook in index.ts.
       * Paystack signs these bytes, and a re-serialised body does not reproduce
       * the same digest.
       */
      rawBody?: Buffer;
    }
  }
}

export {};
