import { Request, Response } from "express";
import { prisma } from "../../Models/context";
import {
  ensureMainBranch,
  normalizeBranchListItem,
  parseBranchId,
} from "./branchService";

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

  return res.status(200).json({
    message: "Branch created successfully",
    data: mapBranch(created),
  });
};

export const updateBranch = async (req: Request, res: Response) => {
  const branchId = parseBranchId(req.body?.id ?? req.query?.id);
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

export const deleteBranch = async (req: Request, res: Response) => {
  const branchId = parseBranchId(req.query?.id);

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

  const scopedRecordCounts = await Promise.all([
    prisma.user.count({ where: { branch_id: branchId } }),
    prisma.department.count({ where: { branch_id: branchId } }),
    prisma.assets.count({ where: { branch_id: branchId } }),
    prisma.event_mgt.count({ where: { branch_id: branchId } }),
    prisma.request.count({ where: { branch_id: branchId } }),
    prisma.event_reports.count({ where: { branch_id: branchId } }),
    prisma.program.count({ where: { branch_id: branchId } }),
    prisma.visitor.count({ where: { branch_id: branchId } }),
    prisma.life_center.count({ where: { branch_id: branchId } }),
    prisma.markets.count({ where: { branch_id: branchId } }),
    prisma.annualTheme.count({ where: { branch_id: branchId } }),
    prisma.receiptConfig.count({ where: { branch_id: branchId } }),
    prisma.paymentConfig.count({ where: { branch_id: branchId } }),
    prisma.bankAccountConfig.count({ where: { branch_id: branchId } }),
    prisma.titheBreakdownConfig.count({ where: { branch_id: branchId } }),
    prisma.financials.count({ where: { branch_id: branchId } }),
    prisma.finance_approval_config.count({ where: { branch_id: branchId } }),
    prisma.availability.count({ where: { branch_id: branchId } }),
    prisma.appointment.count({ where: { branch_id: branchId } }),
  ]);

  if (scopedRecordCounts.some((count) => count > 0)) {
    return res.status(400).json({
      message:
        "This branch has assigned records and cannot be deleted. Move or delete those records first.",
      data: null,
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
