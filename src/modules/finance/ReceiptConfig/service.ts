import { prisma } from "../../../Models/context";
import { BaseConfigPayload, FinanceHttpError, PaginationQuery } from "../common";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../../branches/branchService";

type ReceiptConfigEntity = {
  id: string;
  name: string;
  description: string | null;
};

export class ReceiptConfigurationService {
  private mapResponse(config: {
    id: string;
    name: string;
    description: string | null;
  }): ReceiptConfigEntity {
    return {
      id: config.id,
      name: config.name,
      description: config.description,
    };
  }

  async create(data: BaseConfigPayload): Promise<ReceiptConfigEntity> {
    const existing = await prisma.receiptConfig.findFirst({
      where: { name: data.name },
      select: { id: true },
    });

    if (existing) {
      throw new FinanceHttpError(409, "Receipt config name already exists");
    }

    const created = await prisma.receiptConfig.create({
      data: {
        name: data.name,
        ...(data.description !== undefined && { description: data.description }),
        branch_id: await resolveBranchIdOrDefault(data.branch_id),
      },
      select: {
        id: true,
        name: true,
        description: true,
      },
    });

    return this.mapResponse(created);
  }

  async findAll(pagination: PaginationQuery, branchId?: unknown): Promise<{
    data: ReceiptConfigEntity[];
    total: number;
  }> {
    const [total, configs] = await Promise.all([
      prisma.receiptConfig.count({
        where: getBranchScopedWhere(branchId),
      }),
      prisma.receiptConfig.findMany({
        where: getBranchScopedWhere(branchId),
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
        select: {
          id: true,
          name: true,
          description: true,
        },
      }),
    ]);

    return {
      total,
      data: configs.map((config) => this.mapResponse(config)),
    };
  }

  async update(id: string, data: BaseConfigPayload): Promise<ReceiptConfigEntity> {
    const existing = await prisma.receiptConfig.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new FinanceHttpError(404, "Receipt config not found");
    }

    const duplicate = await prisma.receiptConfig.findFirst({
      where: {
        name: data.name,
        id: { not: id },
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new FinanceHttpError(409, "Receipt config name already exists");
    }

    const updated = await prisma.receiptConfig.update({
      where: { id },
      data: {
        name: data.name,
        ...(data.description !== undefined && { description: data.description }),
        ...(data.branch_id !== undefined
          ? {
              branch_id: await resolveBranchIdOrDefault(data.branch_id),
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        description: true,
      },
    });

    return this.mapResponse(updated);
  }

  async delete(id: string): Promise<{ id: string; deleted: true }> {
    const existing = await prisma.receiptConfig.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new FinanceHttpError(404, "Receipt config not found");
    }

    await prisma.receiptConfig.delete({ where: { id } });

    return {
      id,
      deleted: true,
    };
  }
}
