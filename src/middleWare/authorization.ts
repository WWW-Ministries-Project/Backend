import { Request, Response, NextFunction } from "express";

import JWT from "jsonwebtoken";
import { prisma } from "../Models/context";

const VIEW_PERMISSIONS = ["Can_View", "Can_Manage", "Super_Admin"];
const MANAGE_PERMISSIONS = ["Can_Manage", "Super_Admin"];
const ADMIN_PERMISSIONS = ["Super_Admin"];
const PERMISSION_KEY_ALIASES: Record<string, string[]> = {
  Members: ["Members"],
  Visitors: ["Visitors", "Members"],
  Appointments: ["Appointments", "Members"],
  Departments: ["Departments"],
  Positions: ["Positions"],
  Access_rights: ["Access_rights", "Access rights"],
  Events: ["Events"],
  Church_Attendance: ["Church_Attendance", "Church Attendance", "Events"],
  Theme: ["Theme", "Program"],
  Asset: ["Asset"],
  Requisition: ["Requisition", "Requisitions"],
  Program: ["Program"],
  School_of_ministry: ["School_of_ministry", "School of ministry", "Program"],
  Financials: ["Financials", "Access_rights", "Access rights"],
  Settings: ["Settings", "Access_rights", "Access rights"],
  Marketplace: ["Marketplace", "Program"],
  "Life Center": ["Life Center"],
};

const resolvePermissionValue = (permissions: any, permissionType: string) => {
  if (!permissions || typeof permissions !== "object") {
    return null;
  }

  const aliasKeys = PERMISSION_KEY_ALIASES[permissionType] || [permissionType];
  for (const key of aliasKeys) {
    const value = permissions?.[key];
    if (typeof value === "string") {
      return value;
    }
  }

  return null;
};

const toPositiveInt = (value: any) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const parsePositiveIntArray = (value: any): number[] => {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((item) => toPositiveInt(item))
    .filter((item): item is number => Boolean(item));

  return Array.from(new Set(ids));
};

const parseResponsibleMembers = (responsibleMembers: any): number[] => {
  if (!Array.isArray(responsibleMembers)) {
    return [];
  }

  const ids = responsibleMembers
    .map((memberId) => toPositiveInt(memberId))
    .filter((memberId): memberId is number => Boolean(memberId));

  return Array.from(new Set(ids));
};

const getNestedExclusionSource = (permissions: any) => {
  if (!permissions || typeof permissions !== "object") return null;

  const candidates = [
    permissions?.Exclusions,
    permissions?.exclusions,
    permissions?.exclusion_list,
    permissions?.exclusionList,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate;
    }
  }

  return null;
};

const resolveDomainExclusions = (permissions: any, permissionType: string) => {
  if (!permissions || typeof permissions !== "object") {
    return [];
  }

  const aliasKeys = PERMISSION_KEY_ALIASES[permissionType] || [permissionType];
  const nestedSource = getNestedExclusionSource(permissions);

  const allCandidateKeys = Array.from(
    new Set(
      aliasKeys.flatMap((key) => [
        key,
        key.replace(/\s+/g, "_"),
        `${key}_exclusions`,
        `${key.replace(/\s+/g, "_")}_exclusions`,
      ]),
    ),
  );

  for (const key of allCandidateKeys) {
    const directIds = parsePositiveIntArray(permissions?.[key]);
    if (directIds.length > 0) {
      return directIds;
    }
  }

  if (!nestedSource) return [];

  for (const key of allCandidateKeys) {
    const nestedIds = parsePositiveIntArray((nestedSource as any)?.[key]);
    if (nestedIds.length > 0) {
      return nestedIds;
    }
  }

  return [];
};

const hasActionPermission = (
  permissions: any,
  permissionType: string,
  action: "view" | "manage" | "admin",
) => {
  const permission = resolvePermissionValue(permissions, permissionType);
  if (!permission) return false;

  if (action === "view") return VIEW_PERMISSIONS.includes(permission);
  if (action === "manage") return MANAGE_PERMISSIONS.includes(permission);

  return ADMIN_PERMISSIONS.includes(permission);
};

export class Permissions {
  private extractToken(req: Request | any) {
    return req.headers["authorization"]?.split(" ")[1];
  }

  private unauthorized(res: Response, message: string) {
    return res.status(401).json({ message, data: null });
  }

  private async getAccessContext(
    req: Request | any,
    res: Response,
    errorMessage: string,
  ) {
    const token = this.extractToken(req);
    if (!token) {
      this.unauthorized(res, "Not authorized. Token not found");
      return null;
    }

    let decoded: any;
    try {
      decoded = JWT.verify(token, process.env.JWT_SECRET as string) as any;
    } catch (error) {
      this.unauthorized(res, "Session Expired");
      return null;
    }

    const userId = toPositiveInt(decoded?.id);
    if (!userId) {
      this.unauthorized(res, errorMessage);
      return null;
    }

    let currentUser: any;
    try {
      currentUser = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          is_user: true,
          access_level_id: true,
          department_id: true,
          department_positions: {
            select: {
              department_id: true,
            },
          },
          life_center_member: {
            select: {
              lifeCenterId: true,
            },
          },
          access: {
            select: {
              permissions: true,
            },
          },
        },
      });
    } catch (error) {
      this.unauthorized(res, errorMessage);
      return null;
    }

    if (!currentUser) {
      this.unauthorized(res, errorMessage);
      return null;
    }

    const livePermissions = currentUser?.access?.permissions || {};
    const departmentIds = Array.from(
      new Set(
        [currentUser?.department_id, ...(currentUser?.department_positions || []).map((item: any) => item.department_id)]
          .map((id) => toPositiveInt(id))
          .filter((id): id is number => Boolean(id)),
      ),
    );
    const lifeCenterIds = Array.from(
      new Set(
        (currentUser?.life_center_member || [])
          .map((item: any) => toPositiveInt(item?.lifeCenterId))
          .filter((id: number | null): id is number => Boolean(id)),
      ),
    );

    const isPrivilegedUser = Boolean(
      currentUser?.is_user && currentUser?.access_level_id && currentUser?.access,
    );

    req.user = {
      ...decoded,
      id: userId,
      permissions: livePermissions,
      ministry_worker: Boolean(currentUser?.is_user),
      user_category: isPrivilegedUser ? "admin" : "member",
    };

    return {
      userId,
      decoded,
      currentUser,
      permissions: livePermissions,
      isPrivilegedUser,
      departmentIds,
      lifeCenterIds,
    };
  }

  private isExcluded(
    permissions: any,
    permissionType: string,
    targetUserId: number,
  ) {
    const exclusions = resolveDomainExclusions(permissions, permissionType);
    return exclusions.includes(targetUserId);
  }

  private getTargetUserId(req: Request | any) {
    return (
      toPositiveInt(req.query?.user_id) ||
      toPositiveInt(req.query?.id) ||
      toPositiveInt(req.params?.id) ||
      toPositiveInt(req.body?.user_id) ||
      toPositiveInt(req.body?.id)
    );
  }

  protect = (req: any, res: Response, next: NextFunction) => {
    const token = this.extractToken(req);
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
    return async (req: Request, res: Response, next: NextFunction) => {
      const context = await this.getAccessContext(req, res, errorMessage);
      if (!context) {
        return;
      }

      if (
        context.isPrivilegedUser &&
        hasActionPermission(context.permissions, permissionType, action)
      ) {
        return next();
      }

      return res.status(401).json({ message: errorMessage, data: null });
    };
  };

  can_view_member_details = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const errorMessage = "Not authorized to view members";
    const context = await this.getAccessContext(req, res, errorMessage);
    if (!context) return;

    const targetUserId = this.getTargetUserId(req);
    const isSingleProfileRoute = String((req as any).originalUrl || req.path || "")
      .toLowerCase()
      .includes("get-user");
    const canViewAll =
      context.isPrivilegedUser &&
      hasActionPermission(context.permissions, "Members", "view");

    if (canViewAll) {
      if (
        targetUserId &&
        targetUserId !== context.userId &&
        this.isExcluded(context.permissions, "Members", targetUserId)
      ) {
        return this.unauthorized(res, errorMessage);
      }

      (req as any).memberScope = {
        mode: "all",
        exclusions: resolveDomainExclusions(context.permissions, "Members"),
      };
      return next();
    }

    const resolvedTargetUserId =
      targetUserId || (isSingleProfileRoute ? context.userId : null);
    if (!resolvedTargetUserId || resolvedTargetUserId !== context.userId) {
      return this.unauthorized(res, errorMessage);
    }

    (req as any).memberScope = {
      mode: "own",
      userId: context.userId,
    };
    return next();
  };

  can_manage_member_details = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const errorMessage = "Not authorized to create or update users";
    const context = await this.getAccessContext(req, res, errorMessage);
    if (!context) return;

    if (
      !context.isPrivilegedUser ||
      !hasActionPermission(context.permissions, "Members", "manage")
    ) {
      return this.unauthorized(res, errorMessage);
    }

    const targetUserId = this.getTargetUserId(req);
    if (
      targetUserId &&
      targetUserId !== context.userId &&
      this.isExcluded(context.permissions, "Members", targetUserId)
    ) {
      return this.unauthorized(res, errorMessage);
    }

    return next();
  };

  can_delete_member_details = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const errorMessage = "Not authorized to delete users";
    const context = await this.getAccessContext(req, res, errorMessage);
    if (!context) return;

    if (
      !context.isPrivilegedUser ||
      !hasActionPermission(context.permissions, "Members", "admin")
    ) {
      return this.unauthorized(res, errorMessage);
    }

    const targetUserId = this.getTargetUserId(req);
    if (
      targetUserId &&
      targetUserId !== context.userId &&
      this.isExcluded(context.permissions, "Members", targetUserId)
    ) {
      return this.unauthorized(res, errorMessage);
    }

    return next();
  };

  can_view_visitors_scoped = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const errorMessage = "Not authorized to view visitors";
    const context = await this.getAccessContext(req, res, errorMessage);
    if (!context) return;

    const canViewAll =
      context.isPrivilegedUser &&
      hasActionPermission(context.permissions, "Visitors", "view");
    const visitorId =
      toPositiveInt(req.query?.id) ||
      toPositiveInt(req.params?.id) ||
      toPositiveInt(req.body?.id);

    if (canViewAll) {
      (req as any).visitorScope = { mode: "all" };
      return next();
    }

    if (!visitorId) {
      (req as any).visitorScope = {
        mode: "responsible",
        memberId: context.userId,
      };
      return next();
    }

    const visitor = await prisma.visitor.findUnique({
      where: { id: visitorId },
      select: { id: true, responsibleMembers: true },
    });
    if (!visitor) return next();

    const responsibleMembers = parseResponsibleMembers(visitor.responsibleMembers);
    if (!responsibleMembers.includes(context.userId)) {
      return this.unauthorized(res, errorMessage);
    }

    (req as any).visitorScope = {
      mode: "responsible",
      memberId: context.userId,
    };
    return next();
  };

  can_manage_visitors_scoped = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const errorMessage = "Not authorized to update visitors";
    const context = await this.getAccessContext(req, res, errorMessage);
    if (!context) return;

    const canManageAll =
      context.isPrivilegedUser &&
      hasActionPermission(context.permissions, "Visitors", "manage");
    const visitorId =
      toPositiveInt(req.query?.id) ||
      toPositiveInt(req.params?.id) ||
      toPositiveInt(req.body?.id);

    if (canManageAll) return next();
    if (!visitorId) return this.unauthorized(res, errorMessage);

    const visitor = await prisma.visitor.findUnique({
      where: { id: visitorId },
      select: { id: true, responsibleMembers: true },
    });
    if (!visitor) return next();

    const responsibleMembers = parseResponsibleMembers(visitor.responsibleMembers);
    if (!responsibleMembers.includes(context.userId)) {
      return this.unauthorized(res, errorMessage);
    }

    return next();
  };

  can_delete_visitors_scoped = this.checkPermission(
    "Visitors",
    "admin",
    "Not authorized to delete visitors",
  );

  can_view_appointments_scoped = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const errorMessage = "Not authorized to view appointments";
    const context = await this.getAccessContext(req, res, errorMessage);
    if (!context) return;

    const hasGlobalView =
      context.isPrivilegedUser &&
      hasActionPermission(context.permissions, "Appointments", "view");
    const exclusions = resolveDomainExclusions(context.permissions, "Appointments");
    const bookingId = toPositiveInt(req.params?.id);

    if (bookingId) {
      const booking = await prisma.appointment.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          requesterId: true,
          userId: true,
        },
      });
      if (!booking) return next();

      if (hasGlobalView) {
        if (this.isExcluded(context.permissions, "Appointments", booking.userId)) {
          return this.unauthorized(res, errorMessage);
        }
        (req as any).appointmentScope = {
          mode: "all",
          excludedAttendeeIds: exclusions,
        };
        return next();
      }

      if (
        booking.requesterId === context.userId ||
        booking.userId === context.userId
      ) {
        (req as any).appointmentScope = {
          mode: "own",
          userId: context.userId,
        };
        return next();
      }

      return this.unauthorized(res, errorMessage);
    }

    if (hasGlobalView) {
      (req as any).appointmentScope = {
        mode: "all",
        excludedAttendeeIds: exclusions,
      };
      return next();
    }

    (req as any).appointmentScope = {
      mode: "own",
      userId: context.userId,
    };
    return next();
  };

  can_manage_appointments_scoped = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const errorMessage = "Not authorized to manage appointments";
    const context = await this.getAccessContext(req, res, errorMessage);
    if (!context) return;

    if (
      !context.isPrivilegedUser ||
      !hasActionPermission(context.permissions, "Appointments", "manage")
    ) {
      return this.unauthorized(res, errorMessage);
    }

    const attendeeFromRequest =
      toPositiveInt(req.body?.userId) ||
      toPositiveInt(req.body?.staffId) ||
      toPositiveInt(req.body?.attendeeId) ||
      toPositiveInt(req.body?.attendee_id) ||
      toPositiveInt(req.query?.userId) ||
      toPositiveInt(req.query?.staffId) ||
      toPositiveInt(req.query?.attendeeId) ||
      toPositiveInt(req.query?.attendee_id);

    const bookingIdFromParams = toPositiveInt(req.params?.id);
    const bookingIdFromQuery = toPositiveInt(req.query?.id);
    const isAvailabilityPath = String(req.path || "").includes("availability");

    let targetAttendeeId = attendeeFromRequest;

    if (!targetAttendeeId && bookingIdFromParams) {
      if (isAvailabilityPath) {
        const availability = await prisma.availability.findUnique({
          where: { id: bookingIdFromParams },
          select: { userId: true },
        });
        targetAttendeeId = availability?.userId || null;
      } else {
        const booking = await prisma.appointment.findUnique({
          where: { id: bookingIdFromParams },
          select: { userId: true },
        });
        targetAttendeeId = booking?.userId || null;
      }
    }

    if (!targetAttendeeId && bookingIdFromQuery) {
      const booking = await prisma.appointment.findUnique({
        where: { id: bookingIdFromQuery },
        select: { userId: true },
      });
      targetAttendeeId = booking?.userId || null;
    }

    if (
      targetAttendeeId &&
      this.isExcluded(context.permissions, "Appointments", targetAttendeeId)
    ) {
      return this.unauthorized(res, errorMessage);
    }

    return next();
  };

  can_delete_appointments_scoped = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const errorMessage = "Not authorized to delete appointments";
    const context = await this.getAccessContext(req, res, errorMessage);
    if (!context) return;

    if (
      !context.isPrivilegedUser ||
      !hasActionPermission(context.permissions, "Appointments", "admin")
    ) {
      return this.unauthorized(res, errorMessage);
    }

    const bookingIdFromParams = toPositiveInt(req.params?.id);
    const isAvailabilityPath = String(req.path || "").includes("availability");
    if (bookingIdFromParams) {
      if (isAvailabilityPath) {
        const availability = await prisma.availability.findUnique({
          where: { id: bookingIdFromParams },
          select: { userId: true },
        });
        if (
          availability?.userId &&
          this.isExcluded(context.permissions, "Appointments", availability.userId)
        ) {
          return this.unauthorized(res, errorMessage);
        }
      } else {
        const booking = await prisma.appointment.findUnique({
          where: { id: bookingIdFromParams },
          select: { userId: true },
        });
        if (
          booking?.userId &&
          this.isExcluded(context.permissions, "Appointments", booking.userId)
        ) {
          return this.unauthorized(res, errorMessage);
        }
      }
    }

    return next();
  };

  can_view_assets_scoped = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const errorMessage = "Not authorized to view asset";
    const context = await this.getAccessContext(req, res, errorMessage);
    if (!context) return;

    const canViewAll =
      context.isPrivilegedUser &&
      hasActionPermission(context.permissions, "Asset", "view");

    if (canViewAll) {
      (req as any).assetScope = { mode: "all" };
      return next();
    }

    if (!context.departmentIds.length) {
      return this.unauthorized(res, errorMessage);
    }

    const assetId = toPositiveInt(req.query?.id);
    if (assetId) {
      const asset = await prisma.assets.findUnique({
        where: { id: assetId },
        select: { id: true, department_assigned: true },
      });
      if (!asset) return next();

      if (
        !asset.department_assigned ||
        !context.departmentIds.includes(asset.department_assigned)
      ) {
        return this.unauthorized(res, errorMessage);
      }
    }

    (req as any).assetScope = {
      mode: "department",
      departmentIds: context.departmentIds,
    };
    return next();
  };

  can_view_life_center_scoped = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const errorMessage = "Not authorized to view life center";
    const context = await this.getAccessContext(req, res, errorMessage);
    if (!context) return;

    const canViewAll =
      context.isPrivilegedUser &&
      hasActionPermission(context.permissions, "Life Center", "view");

    if (canViewAll) {
      (req as any).lifeCenterScope = { mode: "all", lifeCenterIds: [] };
      return next();
    }

    if (!context.lifeCenterIds.length) {
      return this.unauthorized(res, errorMessage);
    }

    (req as any).lifeCenterScope = {
      mode: "member",
      lifeCenterIds: context.lifeCenterIds,
    };
    return next();
  };

  can_manage_life_center_scoped = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const errorMessage = "Not authorized to manage life center data";
    const context = await this.getAccessContext(req, res, errorMessage);
    if (!context) return;

    const canManageAll =
      context.isPrivilegedUser &&
      hasActionPermission(context.permissions, "Life Center", "manage");
    if (canManageAll) {
      (req as any).lifeCenterScope = { mode: "all", lifeCenterIds: [] };
      return next();
    }

    if (!context.lifeCenterIds.length) {
      return this.unauthorized(res, errorMessage);
    }

    const explicitLifeCenterId =
      toPositiveInt(req.body?.lifeCenterId) || toPositiveInt(req.query?.lifeCenterId);
    const soulId = toPositiveInt(req.query?.id) || toPositiveInt(req.params?.id);

    if (explicitLifeCenterId) {
      if (!context.lifeCenterIds.includes(explicitLifeCenterId)) {
        return this.unauthorized(res, errorMessage);
      }
    } else if (soulId) {
      const soul = await prisma.soul_won.findUnique({
        where: { id: soulId },
        select: { lifeCenterId: true },
      });
      if (soul && !context.lifeCenterIds.includes(soul.lifeCenterId)) {
        return this.unauthorized(res, errorMessage);
      }
    }

    (req as any).lifeCenterScope = {
      mode: "member",
      lifeCenterIds: context.lifeCenterIds,
    };
    return next();
  };

  can_manage_programs_or_facilitator = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const errorMessage = "Not authorized to manage school of ministry data";
    const context = await this.getAccessContext(req, res, errorMessage);
    if (!context) return;

    const canManageAll =
      context.isPrivilegedUser &&
      (hasActionPermission(context.permissions, "School_of_ministry", "manage") ||
        hasActionPermission(context.permissions, "Program", "manage"));

    const isFacilitator = Boolean((req as any).user?.instructor);
    if (!canManageAll && !isFacilitator) {
      return this.unauthorized(res, errorMessage);
    }

    return next();
  };

  can_create_order_scoped = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const errorMessage = "Not authorized to create order for this user";
    const context = await this.getAccessContext(req, res, errorMessage);
    if (!context) return;

    const canManageAll =
      context.isPrivilegedUser &&
      hasActionPermission(context.permissions, "Marketplace", "manage");

    const payloadUserId = toPositiveInt((req as any).body?.user_id);
    if (payloadUserId && payloadUserId !== context.userId && !canManageAll) {
      return this.unauthorized(res, errorMessage);
    }

    if (!(req as any).body || typeof (req as any).body !== "object") {
      (req as any).body = {};
    }

    if (!payloadUserId) {
      (req as any).body.user_id = context.userId;
    }

    (req as any).orderScope = {
      mode: canManageAll ? "all" : "own",
      userId: context.userId,
    };
    return next();
  };

  can_view_orders_scoped = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const errorMessage = "Not authorized to view this order";
    const context = await this.getAccessContext(req, res, errorMessage);
    if (!context) return;

    const canViewAll =
      context.isPrivilegedUser &&
      hasActionPermission(context.permissions, "Marketplace", "view");

    if (canViewAll) {
      (req as any).orderScope = { mode: "all", userId: context.userId };
      return next();
    }

    const orderId = toPositiveInt(req.query?.id);
    if (orderId) {
      const order = await prisma.orders.findUnique({
        where: { id: orderId },
        select: { user_id: true },
      });
      if (order && order.user_id !== context.userId) {
        return this.unauthorized(res, errorMessage);
      }
    }

    const orderNumber =
      typeof req.query?.order_number === "string"
        ? String(req.query.order_number).trim()
        : "";
    if (orderNumber) {
      const order = await prisma.orders.findFirst({
        where: { order_number: orderNumber },
        select: { user_id: true },
      });
      if (order && order.user_id !== context.userId) {
        return this.unauthorized(res, errorMessage);
      }
    }

    const queryUserId = toPositiveInt(req.query?.user_id);
    if (queryUserId && queryUserId !== context.userId) {
      return this.unauthorized(res, errorMessage);
    }

    const routeKey = String((req as any).originalUrl || req.path || "").toLowerCase();
    if (!queryUserId && routeKey.includes("get-orders-by-user")) {
      (req as any).query = {
        ...(req as any).query,
        user_id: String(context.userId),
      };
    }

    (req as any).orderScope = { mode: "own", userId: context.userId };
    return next();
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

  // Church attendance
  can_view_church_attendance = this.checkPermission(
    "Church_Attendance",
    "view",
    "Not authorized to view church attendance",
  );

  can_manage_church_attendance = this.checkPermission(
    "Church_Attendance",
    "manage",
    "Not authorized to manage church attendance",
  );

  can_delete_church_attendance = this.checkPermission(
    "Church_Attendance",
    "admin",
    "Not authorized to delete church attendance",
  );

  // Requisitions
  can_view_requisitions = this.checkPermission(
    "Requisition",
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

  // Theme
  can_manage_theme = this.checkPermission(
    "Theme",
    "manage",
    "Not authorized to manage theme",
  );

  can_delete_theme = this.checkPermission(
    "Theme",
    "admin",
    "Not authorized to delete theme",
  );

  // Financials
  can_view_financials = this.checkPermission(
    "Financials",
    "view",
    "Not authorized to view financials",
  );

  can_manage_financials = this.checkPermission(
    "Financials",
    "manage",
    "Not authorized to manage financials",
  );

  can_delete_financials = this.checkPermission(
    "Financials",
    "admin",
    "Not authorized to delete financials",
  );

  // Settings
  can_view_settings = this.checkPermission(
    "Settings",
    "view",
    "Not authorized to view settings",
  );

  can_manage_settings = this.checkPermission(
    "Settings",
    "manage",
    "Not authorized to manage settings",
  );

  can_delete_settings = this.checkPermission(
    "Settings",
    "admin",
    "Not authorized to delete settings",
  );

  // Marketplace
  can_view_marketplace = this.checkPermission(
    "Marketplace",
    "view",
    "Not authorized to view marketplace data",
  );

  can_manage_marketplace = this.checkPermission(
    "Marketplace",
    "manage",
    "Not authorized to manage marketplace data",
  );

  can_delete_marketplace = this.checkPermission(
    "Marketplace",
    "admin",
    "Not authorized to delete marketplace data",
  );

  // School of ministry
  can_view_school_of_ministry = this.checkPermission(
    "School_of_ministry",
    "view",
    "Not authorized to view school of ministry data",
  );

  can_manage_school_of_ministry = this.checkPermission(
    "School_of_ministry",
    "manage",
    "Not authorized to manage school of ministry data",
  );

  can_delete_school_of_ministry = this.checkPermission(
    "School_of_ministry",
    "admin",
    "Not authorized to delete school of ministry data",
  );

  // Life Center
  can_view_life_center = this.checkPermission(
    "Life Center",
    "view",
    "Not authorized to view life center data",
  );

  can_manage_life_center = this.checkPermission(
    "Life Center",
    "manage",
    "Not authorized to manage life center data",
  );

  can_delete_life_center = this.checkPermission(
    "Life Center",
    "admin",
    "Not authorized to delete life center data",
  );
}
