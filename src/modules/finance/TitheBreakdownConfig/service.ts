import { prisma } from "../../../Models/context";
import {
  FinanceHttpError,
  PaginationQuery,
  PercentageConfigPayload,
} from "../common";

type TitheBreakdownConfigEntity = {
  id: string;
  name: string;
  description: string | null;
  percentage: number | null;
};

export class TitheBreakdownConfigurationService {
  private async ensurePercentageLimit(
    incomingPercentage: number,
    idToExclude?: string,
  ): Promise<void> {
    const aggregate = await prisma.titheBreakdownConfig.aggregate({
      where: {
        ...(idToExclude !== undefined && { id: { not: idToExclude } }),
      },
      _sum: { percentage: true },
    });

    const currentTotal = aggregate._sum.percentage ?? 0;
    const attemptedTotal = currentTotal + incomingPercentage;

    if (attemptedTotal > 100) {
      throw new FinanceHttpError(
        422,
        `Total tithe breakdown percentage cannot exceed 100%. Current total is ${currentTotal}%, attempted total is ${attemptedTotal}%`,
      );
    }
  }

  private mapResponse(config: {
    id: string;
    name: string;
    description: string | null;
    percentage: number | null;
  }): TitheBreakdownConfigEntity {
    return {
      id: config.id,
      name: config.name,
      description: config.description,
      percentage: config.percentage,
    };
  }

  async create(data: PercentageConfigPayload): Promise<TitheBreakdownConfigEntity> {
    const existing = await prisma.titheBreakdownConfig.findFirst({
      where: { name: data.name },
      select: { id: true },
    });

    if (existing) {
      throw new FinanceHttpError(
        409,
        "Tithe breakdown config name already exists",
      );
    }

    if (data.percentage !== undefined) {
      await this.ensurePercentageLimit(data.percentage);
    }

    const created = await prisma.titheBreakdownConfig.create({
      data: {
        name: data.name,
        ...(data.description !== undefined && { description: data.description }),
        ...(data.percentage !== undefined && { percentage: data.percentage }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        percentage: true,
      },
    });

    return this.mapResponse(created);
  }

  async findAll(pagination: PaginationQuery): Promise<{
    data: TitheBreakdownConfigEntity[];
    total: number;
  }> {
    const [total, configs] = await Promise.all([
      prisma.titheBreakdownConfig.count(),
      prisma.titheBreakdownConfig.findMany({
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
        select: {
          id: true,
          name: true,
          description: true,
          percentage: true,
        },
      }),
    ]);

    return {
      total,
      data: configs.map((config) => this.mapResponse(config)),
    };
  }

  async update(
    id: string,
    data: PercentageConfigPayload,
  ): Promise<TitheBreakdownConfigEntity> {
    const existing = await prisma.titheBreakdownConfig.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new FinanceHttpError(404, "Tithe breakdown config not found");
    }

    const duplicate = await prisma.titheBreakdownConfig.findFirst({
      where: {
        name: data.name,
        id: { not: id },
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new FinanceHttpError(
        409,
        "Tithe breakdown config name already exists",
      );
    }

    if (data.percentage !== undefined) {
      await this.ensurePercentageLimit(data.percentage, id);
    }

    const updated = await prisma.titheBreakdownConfig.update({
      where: { id },
      data: {
        name: data.name,
        ...(data.description !== undefined && { description: data.description }),
        ...(data.percentage !== undefined && { percentage: data.percentage }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        percentage: true,
      },
    });

    return this.mapResponse(updated);
  }

  async delete(id: string): Promise<{ id: string; deleted: true }> {
    const existing = await prisma.titheBreakdownConfig.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new FinanceHttpError(404, "Tithe breakdown config not found");
    }

    await prisma.titheBreakdownConfig.delete({ where: { id } });

    return {
      id,
      deleted: true,
    };
  }
}
