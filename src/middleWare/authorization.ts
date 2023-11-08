import { Request, Response, NextFunction } from "express";

import JWT from "jsonwebtoken";


export const protect = (req: any, res: Response, next: NextFunction) => {
    const token = req.headers["authorization"]?.split(" ")[1];
  
    if (!token) return res.status(401).send("Not authorized. Token not found");
  
    try {
      const decoded = JWT.verify(token, process.env.JWT_SECRET as string) as any;
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).send({ error: "Session expired" });
    }
  };