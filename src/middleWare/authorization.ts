import { Request, Response, NextFunction } from "express";

import JWT from "jsonwebtoken";

// Define permission levels and common messages
const VIEW_PERMISSIONS = ["Can_View", "Can_Manage", "Super_Admin"];
const MANAGE_PERMISSIONS = ["Can_Manage", "Super_Admin"];
const ADMIN_PERMISSIONS = ["Super_Admin"];

export class Permissions {
  // Keep the protect method as is
  protect = (req: any, res: Response, next: NextFunction) => {
    const token = req.headers["authorization"]?.split(" ")[1];
    if (!token)
      return res
        .status(401)
        .json({ message: "Not authorized. Token not found", data: null });

    try {
      const decoded = JWT.verify(
        token,
        process.env.JWT_SECRET as string,
      ) as any;
      req.user = decoded;
      next();
    } catch (error) {
      return res
        .status(401)
        .json({ message: "Session Expired", data: "Session Expired" });
    }
  };

  // Generic permission checker function
  checkPermission = (
    permissionType: string,
    action: "view" | "manage" | "admin",
    errorMessage: string,
  ) => {
    return (req: Request, res: Response, next: NextFunction) => {
      const token: any = req.headers["authorization"]?.split(" ")[1];

      try {
        const decoded = JWT.verify(
          token,
          process.env.JWT_SECRET as string,
        ) as any;
        const permission = decoded.permissions?.[permissionType];
        let allowedPermissions;

        // Select appropriate permission level based on action
        if (action === "view") {
          allowedPermissions = VIEW_PERMISSIONS; // Can_View, Can_Manage, Super_Admin
        } else if (action === "manage") {
          allowedPermissions = MANAGE_PERMISSIONS; // Can_Manage, Super_Admin
        } else {
          allowedPermissions = ADMIN_PERMISSIONS; // Super_Admin only
        }

        if (allowedPermissions.includes(permission)) {
          // For requisitions middleware, we need to set the user
          if (permissionType === "Requisition") {
            (req as any).user = decoded;
          }
          next();
        } else {
          return res.status(401).json({ message: errorMessage, data: null });
        }
      } catch (error) {
        return res.status(401).json({
          message: "Session Expired",
          data: null,
        });
      }
    };
  };

  // Users/members
  can_view_users = this.checkPermission(
    "Members",
    "view",
    "Not authorized to view members",
  );

  can_Manage_Members = this.checkPermission(
    "Members",
    "manage",
    "Not authorized to create or update users",
  );

  can_delete_users = this.checkPermission(
    "Members",
    "admin",
    "Not authorized to delete users",
  );

  // Departments
  can_view_department = this.checkPermission(
    "Departments",
    "view",
    "Not authorized to view departments",
  );

  can_manage_department = this.checkPermission(
    "Departments",
    "manage",
    "Not authorized to manage departments",
  );

  can_delete_department = this.checkPermission(
    "Departments",
    "admin",
    "Not authorized to delete departments",
  );

  // Positions
  can_view_positions = this.checkPermission(
    "Positions",
    "view",
    "Not authorized to view positions",
  );

  can_manage_positions = this.checkPermission(
    "Positions",
    "manage",
    "Not authorized to edit positions",
  );

  can_delete_positions = this.checkPermission(
    "Positions",
    "admin",
    "Not authorized to delete positions",
  );

  // Access Levels
  can_view_access = this.checkPermission(
    "Access_rights",
    "view",
    "Not authorized to view access levels",
  );

  can_manage_access = this.checkPermission(
    "Access_rights",
    "manage",
    "Not authorized to manage access levels",
  );

  can_delete_access = this.checkPermission(
    "Access_rights",
    "admin",
    "Not authorized to delete access levels",
  );

  // Asset Levels
  can_view_asset = this.checkPermission(
    "Asset",
    "view",
    "Not authorized to view asset",
  );

  can_manage_asset = this.checkPermission(
    "Asset",
    "manage",
    "Not authorized to edit asset",
  );

  can_delete_asset = this.checkPermission(
    "Asset",
    "admin",
    "Not authorized to delete asset",
  );

  // Events
  can_view_events = this.checkPermission(
    "Events",
    "view",
    "Not authorized to view events",
  );

  can_manage_events = this.checkPermission(
    "Events",
    "manage",
    "Not authorized to edit events",
  );

  can_delete_events = this.checkPermission(
    "Events",
    "admin",
    "Not authorized to delete events",
  );

  // Requisitions
  can_view_requisitions = this.checkPermission(
    "Requisitions",
    "view",
    "Not authorized to view requisitions",
  );

  can_manage_requisitions = this.checkPermission(
    "Requisition",
    "manage",
    "Not authorized to edit requisitions",
  );

  can_delete_requisitions = this.checkPermission(
    "Requisition",
    "admin",
    "Not authorized to delete requisitions",
  );

  // Programs
  can_view_programs = this.checkPermission(
    "Program",
    "view",
    "Not authorized to view programs",
  );

  can_manage_programs = this.checkPermission(
    "Program",
    "manage",
    "Not authorized to edit programs",
  );

  can_delete_programs = this.checkPermission(
    "Program",
    "admin",
    "Not authorized to delete programs",
  );
  // Life Center
  can_view_life_center = this.checkPermission(
    "Life Center",
    "view",
    "Not authorized to view programs",
  );

  can_manage_life_center = this.checkPermission(
    "Life Center",
    "manage",
    "Not authorized to edit programs",
  );

  can_delete_life_center = this.checkPermission(
    "Life Center",
    "admin",
    "Not authorized to delete programs",
  );
}
