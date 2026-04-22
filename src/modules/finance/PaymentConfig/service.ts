import { prisma } from "../../../Models/context";
import { BaseConfigPayload, FinanceHttpError, PaginationQuery } from "../common";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../../branches/branchService";

type PaymentConfigEntity = {
  id: string;
  name: string;
  description: string | null;
};

export class PaymentConfigurationService {
  private mapResponse(config: {
    id: string;
    name: string;
    description: string | null;
  }): PaymentConfigEntity {
    return {
      id: config.id,
      name: config.name,
      description: config.description,
    };
  }

  async create(data: BaseConfigPayload): Promise<PaymentConfigEntity> {
    const existing = await prisma.paymentConfig.findFirst({
      where: { name: data.name },
      select: { id: true },
    });

    if (existing) {
      throw new FinanceHttpError(409, "Payment config name already exists");
    }

    const created = await prisma.paymentConfig.create({
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
    data: PaymentConfigEntity[];
    total: number;
  }> {
    const [total, configs] = await Promise.all([
      prisma.paymentConfig.count({
        where: getBranchScopedWhere(branchId),
      }),
      prisma.paymentConfig.findMany({
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

  async update(id: string, data: BaseConfigPayload): Promise<PaymentConfigEntity> {
    const existing = await prisma.paymentConfig.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new FinanceHttpError(404, "Payment config not found");
    }

    const duplicate = await prisma.paymentConfig.findFirst({
      where: {
        name: data.name,
        id: { not: id },
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new FinanceHttpError(409, "Payment config name already exists");
    }

    const updated = await prisma.paymentConfig.update({
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
    const existing = await prisma.paymentConfig.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new FinanceHttpError(404, "Payment config not found");
    }

    await prisma.paymentConfig.delete({ where: { id } });

    return {
      id,
      deleted: true,
    };
  }
}
