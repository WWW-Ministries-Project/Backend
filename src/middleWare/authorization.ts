import { Request, Response, NextFunction } from "express";

import JWT from "jsonwebtoken";

export class Permissions {
  protect = (req: any, res: Response, next: NextFunction) => {
    const token = req.headers["authorization"]?.split(" ")[1];
    if (!token)
      return res
        .status(401)
        .json({ message: "Not authorized. Token not found", data: null });

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      req.user = decoded;
      next();
    } catch (error) {
      return res
        .status(401)
        .json({ message: "Session Expired", data: "Session Expired" });
    }
  };

  // Users/members
  can_view_users = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;
      if (
        permission.Members === "Can_View" ||
        permission.Members === "Can_Manage" ||
        permission.Members === "Super_Admin"
      ) {
        next();
      } else {
        return res
          .status(401)
          .json({ message: "Not authorized to view members", data: null });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };
  can_Manage_Members = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (
        permission.Members === "Can_Manage" ||
        permission.Members === "Super_Admin"
      ) {
        next();
      } else {
        return res
          .status(401)
          .json({ message: "Not authorized to create users", data: null });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };

  // Departments
  can_view_department = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];
    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (
        permission.Departments === "Can_View" ||
        permission.Departments === "Can_Manage" ||
        permission.Departments === "Super_Admin"
      ) {
        next();
      } else {
        return res
          .status(401)
          .json({ message: "Not authorized to view departments", data: null });
      }
    } catch (error) {
      return res
        .status(401)
        .json({ message: "Session Expired / Invalid Token", data: null });
    }
  };
  can_manage_department = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];
    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (
        permission.Departments === "Can_Manage" ||
        permission.Departments === "Super_Admin"
      ) {
        next();
      } else {
        return res
          .status(401)
          .json({ message: "Not authorized to view departments", data: null });
      }
    } catch (error) {
      return res
        .status(401)
        .json({ message: "Session Expired / Invalid Token", data: null });
    }
  };

  // Positions
  can_view_positions = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (
        permission.Positions === "Can_View" ||
        permission.Positions === "Can_Manage" ||
        permission.Positions === "Super_Admin"
      ) {
        next();
      } else {
        return res
          .status(401)
          .json({ message: "Not authorized to view positions", data: null });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };
  can_manage_positions = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (
        permission.Positions === "Can_Manage" ||
        permission.Positions === "Super_Admin"
      ) {
        next();
      } else {
        return res
          .status(401)
          .json({ message: "Not authorized to edit positions", data: null });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };

  // Access Levels
  can_manage_access = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (
        permission.Access_rights === "Can_Manage" ||
        permission.Access_rights === "Super_Admin"
      ) {
        next();
      } else {
        return res.status(401).json({
          message: "Not authorized to delete access levels",
          data: null,
        });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };
  can_view_access = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (
        permission.Access_rights === "Can_View" ||
        permission.Access_rights === "Can_Manage" ||
        permission.Access_rights === "Super_Admin"
      ) {
        next();
      } else {
        return res.status(401).json({
          message: "Not authorized to view access levels",
          data: null,
        });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };
  // Asset Levels
  can_manage_asset = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (
        permission.Asset === "Can_Manage" ||
        permission.Asset === "Super_Admin"
      ) {
        next();
      } else {
        return res.status(401).json({
          message: "Not authorized to edit asset",
          data: null,
        });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };
  can_view_asset = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (
        permission.Asset === "Can_View" ||
        permission.Asset === "Can_Manage" ||
        permission.Asset === "Super_Admin"
      ) {
        next();
      } else {
        return res.status(401).json({
          message: "Not authorized to view asset",
          data: null,
        });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };

  // Events
  can_view_events = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (
        permission.Events === "Can_View" ||
        permission.Events === "Can_Manage" ||
        permission.Events === "Super_Admin"
      ) {
        next();
      } else {
        return res.status(401).json({
          message: "Not authorized to view events",
          data: null,
        });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };
  can_manage_events = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (
        permission.Events === "Can_Manage" ||
        permission.Events === "Super_Admin"
      ) {
        next();
      } else {
        return res.status(401).json({
          message: "Not authorized to edit events",
          data: null,
        });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };

  can_manage_requisitions = (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];
    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;
      if (
        permission.Requisitions === "Can_Manage" ||
        permission.Requisitions === "Super_Admin"
      ) {
        next();
      } else {
        return res.status(401).json({
          message: "Not authorized to edit requisitions",
          data: null,
        });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };
  can_view_requisitions = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];
    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;
      if (
        permission.Requisitions === "Can_View" ||
        permission.Requisitions === "Super_Admin" ||
        permission.Requisitions === "Can_Manage"
      ) {
        next();
      } else {
        return res.status(401).json({
          message: "Not authorized to edit requisitions",
          data: null,
        });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };
}
