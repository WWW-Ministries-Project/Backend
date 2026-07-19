import { Request, Response } from "express";
import { prisma } from "../../Models/context";
import { getBranchScopedWhere } from "../branches/branchService";
import { userHasMinimumDomainAccess } from "../../utils/permissionResolver";
import { notificationService } from "../notifications/notificationService";

const APPROVER_DOMAIN = "Membership_Management";

const toPositiveInt = (value: unknown) => {
  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return null;
  }
  return parsedValue;
};

const getRequestUserId = (req: Request) =>
  toPositiveInt((req as any)?.user?.id);

/** Load the JSON permission blob for a user. */
const getUserPermissions = async (userId: number): Promise<unknown> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { access: { select: { permissions: true } } },
  });
  return user?.access?.permissions ?? null;
};

/** A user may act on a request when they can manage membership OR head the department. */
const canActOnDepartment = (
  permissions: unknown,
  userId: number,
  departmentHead: number | null | undefined,
): boolean => {
  if (userHasMinimumDomainAccess(permissions, APPROVER_DOMAIN, "manage")) {
    return true;
  }
  return Boolean(departmentHead) && departmentHead === userId;
};

/** Find every user id that should be notified of / can act on a request for this department. */
const findApproverIds = async (
  departmentId: number,
  departmentHead: number | null | undefined,
  branchId: number | null | undefined,
): Promise<number[]> => {
  const approverIds = new Set<number>();
  if (departmentHead) {
    approverIds.add(departmentHead);
  }

  const candidates = await prisma.user.findMany({
    where: {
      is_active: true,
      access: { isNot: null },
      ...(branchId ? { branch_id: branchId } : {}),
    },
    select: {
      id: true,
      access: { select: { permissions: true } },
    },
  });

  for (const candidate of candidates) {
    if (
      userHasMinimumDomainAccess(
        candidate.access?.permissions,
        APPROVER_DOMAIN,
        "manage",
      )
    ) {
      approverIds.add(candidate.id);
    }
  }

  return Array.from(approverIds);
};

/** Departments a user heads (used to scope the list view for non-managers). */
const getHeadedDepartmentIds = async (userId: number): Promise<number[]> => {
  const departments = await prisma.department.findMany({
    where: { department_head: userId },
    select: { id: true },
  });
  return departments.map((department) => department.id);
};

/* ------------------------------------------------------------------ */
/* Member-facing                                                       */
/* ------------------------------------------------------------------ */

/** List OPEN departments a member can request to join. */
export const listOpenDepartments = async (req: Request, res: Response) => {
  try {
    const branchWhere = getBranchScopedWhere(req.query?.branch_id);
    const departments = await prisma.department.findMany({
      where: {
        status: "OPEN",
        ...(branchWhere ?? {}),
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        department_head_info: { select: { id: true, name: true } },
        position: {
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        },
      },
    });

    return res.status(200).json({ message: "Success", data: departments });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Failed to load open departments", data: error });
  }
};

/** A member submits a request to join a department. */
export const createJoinRequest = async (req: Request, res: Response) => {
  const userId = getRequestUserId(req);
  const departmentId = toPositiveInt(req.body?.department_id);

  try {
    if (!userId) {
      return res.status(401).json({ message: "Not authorized", data: null });
    }
    if (!departmentId) {
      return res
        .status(400)
        .json({ message: "Department id is required", data: null });
    }

    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      select: {
        id: true,
        name: true,
        status: true,
        branch_id: true,
        department_head: true,
      },
    });

    if (!department) {
      return res
        .status(404)
        .json({ message: "Department not found", data: null });
    }
    if (department.status !== "OPEN") {
      return res.status(400).json({
        message: "This department is not open for new members",
        data: null,
      });
    }

    const alreadyMember = await prisma.department_positions.findUnique({
      where: {
        user_id_department_id: {
          user_id: userId,
          department_id: departmentId,
        },
      },
      select: { id: true },
    });
    if (alreadyMember) {
      return res.status(400).json({
        message: "You already belong to this department",
        data: null,
      });
    }

    const pending = await prisma.department_join_request.findFirst({
      where: {
        user_id: userId,
        department_id: departmentId,
        status: "PENDING",
      },
      select: { id: true },
    });
    if (pending) {
      return res.status(400).json({
        message: "You already have a pending request for this department",
        data: null,
      });
    }

    const requester = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    const joinRequest = await prisma.department_join_request.create({
      data: {
        user_id: userId,
        department_id: departmentId,
        branch_id: department.branch_id,
        status: "PENDING",
      },
      select: { id: true },
    });

    const approverIds = await findApproverIds(
      department.id,
      department.department_head,
      department.branch_id,
    );

    if (approverIds.length) {
      await notificationService.createManyInAppNotifications(
        approverIds.map((approverId) => ({
          type: "department_join_request.created",
          title: "New department join request",
          body: `${requester?.name ?? "A member"} requested to join ${department.name}.`,
          recipientUserId: approverId,
          actorUserId: userId,
          entityType: "department_join_request",
          entityId: joinRequest.id,
          actionUrl:
            "/home/membership/membership-management/join-requests",
          priority: "MEDIUM",
          dedupeKey: `department_join_request.created:${joinRequest.id}:${approverId}`,
        })),
      );
    }

    return res.status(200).json({
      message:
        "Your request has been submitted to the Head of Department for review.",
      data: { id: joinRequest.id },
    });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Failed to submit join request", data: error });
  }
};

/* ------------------------------------------------------------------ */
/* Approver-facing                                                     */
/* ------------------------------------------------------------------ */

/** List join requests visible to the acting approver. */
export const listJoinRequests = async (req: Request, res: Response) => {
  const userId = getRequestUserId(req);

  try {
    if (!userId) {
      return res.status(401).json({ message: "Not authorized", data: null });
    }

    const permissions = await getUserPermissions(userId);
    const canManageAll = userHasMinimumDomainAccess(
      permissions,
      APPROVER_DOMAIN,
      "manage",
    );

    let departmentScope: number[] | null = null;
    if (!canManageAll) {
      departmentScope = await getHeadedDepartmentIds(userId);
      if (!departmentScope.length) {
        return res
          .status(403)
          .json({ message: "Not authorized to view join requests", data: null });
      }
    }

    const statusFilter =
      typeof req.query?.status === "string"
        ? String(req.query.status).toUpperCase()
        : "PENDING";
    const validStatuses = ["PENDING", "APPROVED", "DECLINED"];
    const branchWhere = getBranchScopedWhere(req.query?.branch_id);

    const requests = await prisma.department_join_request.findMany({
      where: {
        ...(validStatuses.includes(statusFilter)
          ? { status: statusFilter as any }
          : {}),
        ...(departmentScope ? { department_id: { in: departmentScope } } : {}),
        ...(branchWhere ?? {}),
      },
      orderBy: { requested_at: "desc" },
      select: {
        id: true,
        status: true,
        requested_at: true,
        decided_at: true,
        decline_reason: true,
        department: { select: { id: true, name: true } },
        user: {
          select: {
            id: true,
            name: true,
            user_info: { select: { primary_number: true } },
          },
        },
      },
    });

    const data = requests.map((request) => ({
      id: request.id,
      status: request.status,
      requested_at: request.requested_at,
      decided_at: request.decided_at,
      decline_reason: request.decline_reason,
      department_id: request.department?.id,
      department_name: request.department?.name,
      member_id: request.user?.id,
      member_name: request.user?.name,
      phone_number: request.user?.user_info?.primary_number ?? null,
    }));

    return res.status(200).json({ message: "Success", data });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Failed to load join requests", data: error });
  }
};

/** Shared approval routine — used by single + bulk approve. */
const approveOne = async (
  requestId: number,
  actorId: number,
  permissions: unknown,
  payload: {
    position_id?: number | null;
    start_date?: Date | null;
    instructions?: string | null;
  },
): Promise<{ ok: boolean; message: string }> => {
  const request = await prisma.department_join_request.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      user_id: true,
      department_id: true,
      department: { select: { name: true, department_head: true } },
    },
  });

  if (!request) {
    return { ok: false, message: "Request not found" };
  }
  if (request.status !== "PENDING") {
    return { ok: false, message: "Request already decided" };
  }
  if (
    !canActOnDepartment(permissions, actorId, request.department?.department_head)
  ) {
    return { ok: false, message: "Not authorized for this department" };
  }

  await prisma.department_positions.upsert({
    where: {
      user_id_department_id: {
        user_id: request.user_id,
        department_id: request.department_id,
      },
    },
    update: {
      position_id: payload.position_id ?? null,
      start_date: payload.start_date ?? null,
    },
    create: {
      user_id: request.user_id,
      department_id: request.department_id,
      position_id: payload.position_id ?? null,
      start_date: payload.start_date ?? null,
    },
  });

  await prisma.department_join_request.update({
    where: { id: requestId },
    data: {
      status: "APPROVED",
      decided_by: actorId,
      decided_at: new Date(),
      position_id: payload.position_id ?? null,
      start_date: payload.start_date ?? null,
      instructions: payload.instructions ?? null,
    },
  });

  await notificationService.createInAppNotification({
    type: "department_join_request.approved",
    title: "Join request approved",
    body: `Your request to join ${request.department?.name ?? "the department"} has been approved.${
      payload.instructions ? ` Note: ${payload.instructions}` : ""
    }`,
    recipientUserId: request.user_id,
    actorUserId: actorId,
    entityType: "department_join_request",
    entityId: requestId,
    priority: "MEDIUM",
    dedupeKey: `department_join_request.approved:${requestId}`,
  });

  return { ok: true, message: "Approved" };
};

/** Shared decline routine — used by single + bulk decline. */
const declineOne = async (
  requestId: number,
  actorId: number,
  permissions: unknown,
  reason: string | null,
): Promise<{ ok: boolean; message: string }> => {
  const request = await prisma.department_join_request.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      user_id: true,
      department: { select: { name: true, department_head: true } },
    },
  });

  if (!request) {
    return { ok: false, message: "Request not found" };
  }
  if (request.status !== "PENDING") {
    return { ok: false, message: "Request already decided" };
  }
  if (
    !canActOnDepartment(permissions, actorId, request.department?.department_head)
  ) {
    return { ok: false, message: "Not authorized for this department" };
  }

  await prisma.department_join_request.update({
    where: { id: requestId },
    data: {
      status: "DECLINED",
      decided_by: actorId,
      decided_at: new Date(),
      decline_reason: reason,
    },
  });

  await notificationService.createInAppNotification({
    type: "department_join_request.declined",
    title: "Join request declined",
    body: `Your request to join ${request.department?.name ?? "the department"} was declined.${
      reason ? ` Reason: ${reason}` : ""
    }`,
    recipientUserId: request.user_id,
    actorUserId: actorId,
    entityType: "department_join_request",
    entityId: requestId,
    priority: "MEDIUM",
    dedupeKey: `department_join_request.declined:${requestId}`,
  });

  return { ok: true, message: "Declined" };
};

export const approveJoinRequest = async (req: Request, res: Response) => {
  const actorId = getRequestUserId(req);
  const requestId = toPositiveInt(req.body?.id);

  try {
    if (!actorId) {
      return res.status(401).json({ message: "Not authorized", data: null });
    }
    if (!requestId) {
      return res
        .status(400)
        .json({ message: "Request id is required", data: null });
    }

    const permissions = await getUserPermissions(actorId);
    const result = await approveOne(requestId, actorId, permissions, {
      position_id: toPositiveInt(req.body?.position_id),
      start_date: req.body?.start_date ? new Date(req.body.start_date) : null,
      instructions: req.body?.instructions?.trim() || null,
    });

    if (!result.ok) {
      const statusCode =
        result.message === "Not authorized for this department" ? 403 : 400;
      return res
        .status(statusCode)
        .json({ message: result.message, data: null });
    }

    return res
      .status(200)
      .json({ message: "Request approved successfully", data: null });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Failed to approve request", data: error });
  }
};

export const declineJoinRequest = async (req: Request, res: Response) => {
  const actorId = getRequestUserId(req);
  const requestId = toPositiveInt(req.body?.id);

  try {
    if (!actorId) {
      return res.status(401).json({ message: "Not authorized", data: null });
    }
    if (!requestId) {
      return res
        .status(400)
        .json({ message: "Request id is required", data: null });
    }

    const permissions = await getUserPermissions(actorId);
    const result = await declineOne(
      requestId,
      actorId,
      permissions,
      req.body?.decline_reason?.trim() || null,
    );

    if (!result.ok) {
      const statusCode =
        result.message === "Not authorized for this department" ? 403 : 400;
      return res
        .status(statusCode)
        .json({ message: result.message, data: null });
    }

    return res
      .status(200)
      .json({ message: "Request declined successfully", data: null });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Failed to decline request", data: error });
  }
};

/** Bulk approve/decline. Body: { ids: number[], action, ...approve/decline fields }. */
export const bulkJoinRequestAction = async (req: Request, res: Response) => {
  const actorId = getRequestUserId(req);
  const action = String(req.body?.action ?? "").toLowerCase();
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids.map(toPositiveInt).filter((id: number | null): id is number => id !== null)
    : [];

  try {
    if (!actorId) {
      return res.status(401).json({ message: "Not authorized", data: null });
    }
    if (action !== "approve" && action !== "decline") {
      return res
        .status(400)
        .json({ message: "action must be approve or decline", data: null });
    }
    if (!ids.length) {
      return res
        .status(400)
        .json({ message: "No request ids provided", data: null });
    }

    const permissions = await getUserPermissions(actorId);
    const results: { id: number; ok: boolean; message: string }[] = [];

    for (const id of ids) {
      const result =
        action === "approve"
          ? await approveOne(id, actorId, permissions, {
              position_id: toPositiveInt(req.body?.position_id),
              start_date: req.body?.start_date
                ? new Date(req.body.start_date)
                : null,
              instructions: req.body?.instructions?.trim() || null,
            })
          : await declineOne(
              id,
              actorId,
              permissions,
              req.body?.decline_reason?.trim() || null,
            );
      results.push({ id, ...result });
    }

    const succeeded = results.filter((result) => result.ok).length;

    return res.status(200).json({
      message: `${succeeded} of ${ids.length} request(s) ${
        action === "approve" ? "approved" : "declined"
      }.`,
      data: results,
    });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Failed to process bulk action", data: error });
  }
};
