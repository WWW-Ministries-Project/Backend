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

      if (permission.view_Members) {
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
  can_create_Members = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (permission.create_Members) {
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
  edit_Members = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (permission.edit_Members) {
        next();
      } else {
        return res
          .status(401)
          .json({ message: "Not authorized to update users", data: null });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };
  delete_Members = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (permission.delete_Members) {
        next();
      } else {
        return res
          .status(401)
          .json({ message: "Not authorized to delete users", data: null });
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

      if (permission.view_Departments) {
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
  can_create_department = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];
    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (permission.create_Departments) {
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
  can_edit_department = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (permission.edit_Departments) {
        next();
      } else {
        return res.status(401).json({
          message: "Not authorized to manage departments",
          data: null,
        });
      }
    } catch (error) {
      return res
        .status(401)
        .json({ message: "Session Expired / Invalid Token", data: null });
    }
  };
  can_delete_department = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (permission.delete_Departments) {
        next();
      } else {
        return res.status(401).json({
          message: "Not authorized to manage departments",
          data: null,
        });
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

      if (permission.view_Positions) {
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
  can_edit_positions = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (permission.edit_Positions) {
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
  can_create_positions = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (permission.create_Positions) {
        next();
      } else {
        return res
          .status(401)
          .json({ message: "Not authorized to create positions", data: null });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };
  can_delete_positions = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (permission.delete_Positions) {
        next();
      } else {
        return res
          .status(401)
          .json({ message: "Not authorized to delete positions", data: null });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };

  // Access Levels
  can_delete_access = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (permission.delete_Access_Rights) {
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
  can_create_access = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (permission.create_Access_Rights) {
        next();
      } else {
        return res.status(401).json({
          message: "Not authorized to create access levels",
          data: null,
        });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };
  can_edit_access = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (permission.edit_Access_Rights) {
        next();
      } else {
        return res.status(401).json({
          message: "Not authorized to edit access levels",
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

      if (permission.view_Access_Rights) {
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
  can_delete_asset = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (permission.delete_Assets) {
        next();
      } else {
        return res.status(401).json({
          message: "Not authorized to delete assets",
          data: null,
        });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };
  can_create_asset = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (permission.create_Assets) {
        next();
      } else {
        return res.status(401).json({
          message: "Not authorized to create asset",
          data: null,
        });
      }
    } catch (error) {
      return res.status(401).json({ message: "Session Expired", data: null });
    }
  };
  can_edit_asset = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (permission.edit_Assets) {
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

      if (permission.view_Assets) {
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

      if (permission.view_Events) {
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
  can_edit_events = (req: Request, res: Response, next: NextFunction) => {
    const token: any = req.headers["authorization"]?.split(" ")[1];

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string
      ) as any;
      const permission = decoded.permissions;

      if (permission.edit_Events) {
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
}
