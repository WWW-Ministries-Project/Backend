import { Request, Response } from "express";
import { prisma } from "../../Models/context";
import {
  ensureMainBranch,
  normalizeBranchListItem,
  parseBranchId,
} from "./branchService";
import {
  BRANCH_FORBIDDEN_MESSAGE,
  getBranchScope,
  isBranchAllowed,
} from "./branchScope";
import { setBranchGrants } from "../accessLevels/branchAccessService";
import { sessionChanged } from "../realtime/realtimeSession";

const mapBranch = (branch: {
  id: number;
  name: string;
  description: string | null;
  location: string | null;
  pastor_in_charge_id: number | null;
  pastor_in_charge?: { id: number; name: string; member_id: string | null } | null;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}) => normalizeBranchListItem(branch);

const readOptionalString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const readPastorInChargeId = (value: unknown) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return parseBranchId(value);
};

const branchInclude = {
  pastor_in_charge: {
    select: {
      id: true,
      name: true,
      member_id: true,
    },
  },
};

export const listBranches = async (_req: Request, res: Response) => {
  await ensureMainBranch();

  const branches = await prisma.branch.findMany({
    orderBy: [{ is_default: "desc" }, { name: "asc" }],
    include: branchInclude,
  });

  return res.status(200).json({
    message: "Branches fetched successfully",
    data: branches.map(mapBranch),
  });
};

export const createBranch = async (req: Request, res: Response) => {
  const name = String(req.body?.name ?? "").trim();
  const description =
    readOptionalString(req.body?.description);
  const location = readOptionalString(req.body?.location);
  const pastorInChargeId = readPastorInChargeId(req.body?.pastor_in_charge_id);

  if (!name) {
    return res.status(400).json({
      message: "Branch name is required",
      data: null,
    });
  }

  const existing = await prisma.branch.findFirst({
    where: {
      name,
    },
  });

  if (existing) {
    return res.status(400).json({
      message: "Branch name already exists",
      data: null,
    });
  }

  if (req.body?.pastor_in_charge_id !== undefined && !pastorInChargeId) {
    return res.status(400).json({
      message: "Pastor in-charge must be a valid member",
      data: null,
    });
  }

  if (pastorInChargeId) {
    const pastor = await prisma.user.findUnique({
      where: { id: pastorInChargeId },
      select: { id: true },
    });

    if (!pastor) {
      return res.status(400).json({
        message: "Pastor in-charge not found",
        data: null,
      });
    }
  }

  const created = await prisma.branch.create({
    data: {
      name,
      description,
      location,
      pastor_in_charge_id: pastorInChargeId,
    },
    include: branchInclude,
  });

  // An admin limited to some branches keeps their current role in the branch
  // they just created; otherwise they could not see it.
  const scope = getBranchScope();
  const creatorId = Number((req as any).user?.id);
  if (scope?.allowedBranchIds && Number.isInteger(creatorId) && creatorId > 0) {
    const sourceBranchId = scope.activeBranchId ?? scope.allowedBranchIds[0];
    const sourceGrant = sourceBranchId
      ? await prisma.user_branch_access.findUnique({
          where: {
            user_id_branch_id: { user_id: creatorId, branch_id: sourceBranchId },
          },
          select: { access_level_id: true },
        })
      : null;
    if (sourceGrant) {
      await setBranchGrants([creatorId], [created.id], sourceGrant.access_level_id);
      void sessionChanged([creatorId], ["permissions"]);
    }
  }

  return res.status(200).json({
    message: "Branch created successfully",
    data: mapBranch(created),
  });
};

export const updateBranch = async (req: Request, res: Response) => {
  const branchId = parseBranchId(req.body?.id ?? req.query?.id);
  if (branchId && !isBranchAllowed(getBranchScope(), branchId)) {
    return res
      .status(403)
      .json({ message: BRANCH_FORBIDDEN_MESSAGE, data: null, code: "BRANCH_FORBIDDEN" });
  }
  const name = String(req.body?.name ?? "").trim();
  const description =
    readOptionalString(req.body?.description);
  const location = readOptionalString(req.body?.location);
  const pastorInChargeId = readPastorInChargeId(req.body?.pastor_in_charge_id);

  if (!branchId) {
    return res.status(400).json({
      message: "Branch id is required",
      data: null,
    });
  }

  if (!name) {
    return res.status(400).json({
      message: "Branch name is required",
      data: null,
    });
  }

  const existing = await prisma.branch.findUnique({
    where: { id: branchId },
  });

  if (!existing) {
    return res.status(404).json({
      message: "Branch not found",
      data: null,
    });
  }

  const duplicate = await prisma.branch.findFirst({
    where: {
      name,
      NOT: {
        id: branchId,
      },
    },
  });

  if (duplicate) {
    return res.status(400).json({
      message: "Branch name already exists",
      data: null,
    });
  }

  if (req.body?.pastor_in_charge_id !== undefined && !pastorInChargeId) {
    return res.status(400).json({
      message: "Pastor in-charge must be a valid member",
      data: null,
    });
  }

  if (pastorInChargeId) {
    const pastor = await prisma.user.findUnique({
      where: { id: pastorInChargeId },
      select: { id: true },
    });

    if (!pastor) {
      return res.status(400).json({
        message: "Pastor in-charge not found",
        data: null,
      });
    }
  }

  const updated = await prisma.branch.update({
    where: { id: branchId },
    data: {
      name,
      description,
      location,
      pastor_in_charge_id: pastorInChargeId,
    },
    include: branchInclude,
  });

  return res.status(200).json({
    message: "Branch updated successfully",
    data: mapBranch(updated),
  });
};

const BRANCH_RECORD_CHECKS: {
  key: string;
  singular: string;
  plural: string;
  count: (branchId: number) => Promise<number>;
}[] = [
  { key: "members", singular: "member", plural: "members", count: (id) => prisma.user.count({ where: { branch_id: id } }) },
  { key: "departments", singular: "department", plural: "departments", count: (id) => prisma.department.count({ where: { branch_id: id } }) },
  { key: "assets", singular: "asset", plural: "assets", count: (id) => prisma.assets.count({ where: { branch_id: id } }) },
  { key: "events", singular: "event", plural: "events", count: (id) => prisma.event_mgt.count({ where: { branch_id: id } }) },
  { key: "requisitions", singular: "requisition", plural: "requisitions", count: (id) => prisma.request.count({ where: { branch_id: id } }) },
  { key: "event_reports", singular: "event report", plural: "event reports", count: (id) => prisma.event_reports.count({ where: { branch_id: id } }) },
  { key: "programs", singular: "program", plural: "programs", count: (id) => prisma.program.count({ where: { branch_id: id } }) },
  { key: "visitors", singular: "visitor", plural: "visitors", count: (id) => prisma.visitor.count({ where: { branch_id: id } }) },
  { key: "life_centers", singular: "life center", plural: "life centers", count: (id) => prisma.life_center.count({ where: { branch_id: id } }) },
  { key: "markets", singular: "market", plural: "markets", count: (id) => prisma.markets.count({ where: { branch_id: id } }) },
  { key: "annual_themes", singular: "annual theme", plural: "annual themes", count: (id) => prisma.annualTheme.count({ where: { branch_id: id } }) },
  { key: "receipt_configs", singular: "receipt setting", plural: "receipt settings", count: (id) => prisma.receiptConfig.count({ where: { branch_id: id } }) },
  { key: "payment_configs", singular: "payment setting", plural: "payment settings", count: (id) => prisma.paymentConfig.count({ where: { branch_id: id } }) },
  { key: "bank_accounts", singular: "bank account", plural: "bank accounts", count: (id) => prisma.bankAccountConfig.count({ where: { branch_id: id } }) },
  { key: "tithe_breakdowns", singular: "tithe breakdown", plural: "tithe breakdowns", count: (id) => prisma.titheBreakdownConfig.count({ where: { branch_id: id } }) },
  { key: "financials", singular: "finance record", plural: "finance records", count: (id) => prisma.financials.count({ where: { branch_id: id } }) },
  { key: "finance_approvals", singular: "finance approval setting", plural: "finance approval settings", count: (id) => prisma.finance_approval_config.count({ where: { branch_id: id } }) },
  { key: "availability", singular: "availability slot", plural: "availability slots", count: (id) => prisma.availability.count({ where: { branch_id: id } }) },
  { key: "appointments", singular: "appointment", plural: "appointments", count: (id) => prisma.appointment.count({ where: { branch_id: id } }) },
];

type BranchDeleteBlocker = { key: string; label: string; count: number };

/** Records still scoped to a branch, which must be moved before it can be deleted. */
const getBranchDeleteBlockers = async (
  branchId: number,
): Promise<BranchDeleteBlocker[]> => {
  const counts = await Promise.all(
    BRANCH_RECORD_CHECKS.map((check) => check.count(branchId)),
  );
  return BRANCH_RECORD_CHECKS.flatMap((check, index) =>
    counts[index] > 0
      ? [
          {
            key: check.key,
            label: `${counts[index]} ${counts[index] === 1 ? check.singular : check.plural}`,
            count: counts[index],
          },
        ]
      : [],
  );
};

const describeBlockers = (blockers: BranchDeleteBlocker[]) => {
  const labels = blockers.map((blocker) => blocker.label);
  const listed =
    labels.length <= 3
      ? labels.join(", ")
      : `${labels.slice(0, 3).join(", ")} and ${labels.length - 3} more record types`;
  return `This branch still has ${listed}. Move them to another branch first.`;
};

export const getBranchDeleteImpact = async (req: Request, res: Response) => {
  const branchId = parseBranchId(req.query?.id);
  if (branchId && !isBranchAllowed(getBranchScope(), branchId)) {
    return res
      .status(403)
      .json({ message: BRANCH_FORBIDDEN_MESSAGE, data: null, code: "BRANCH_FORBIDDEN" });
  }

  if (!branchId) {
    return res.status(400).json({ message: "Branch id is required", data: null });
  }

  const existing = await prisma.branch.findUnique({ where: { id: branchId } });

  if (!existing) {
    return res.status(404).json({ message: "Branch not found", data: null });
  }

  const blockers = existing.is_default
    ? []
    : await getBranchDeleteBlockers(branchId);

  return res.status(200).json({
    message: "Branch delete impact",
    data: {
      branch_id: branchId,
      name: existing.name,
      is_default: existing.is_default,
      deletable: !existing.is_default && blockers.length === 0,
      blockers,
    },
  });
};

export const deleteBranch = async (req: Request, res: Response) => {
  const branchId = parseBranchId(req.query?.id);
  if (branchId && !isBranchAllowed(getBranchScope(), branchId)) {
    return res
      .status(403)
      .json({ message: BRANCH_FORBIDDEN_MESSAGE, data: null, code: "BRANCH_FORBIDDEN" });
  }

  if (!branchId) {
    return res.status(400).json({
      message: "Branch id is required",
      data: null,
    });
  }

  const existing = await prisma.branch.findUnique({
    where: { id: branchId },
  });

  if (!existing) {
    return res.status(404).json({
      message: "Branch not found",
      data: null,
    });
  }

  if (existing.is_default) {
    return res.status(400).json({
      message: "The default branch cannot be deleted",
      data: null,
    });
  }

  const blockers = await getBranchDeleteBlockers(branchId);

  if (blockers.length > 0) {
    return res.status(409).json({
      message: describeBlockers(blockers),
      data: { blockers },
    });
  }

  await prisma.branch.delete({
    where: { id: branchId },
  });

  return res.status(200).json({
    message: "Branch deleted successfully",
    data: null,
  });
};
