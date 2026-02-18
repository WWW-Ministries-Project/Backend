import { Prisma } from "@prisma/client";
import { prisma } from "../../../Models/context";
import { FinanceHttpError, FinancialPayload, PaginationQuery } from "../common";

type FinancialEntity = {
  id: string;
  periodDate: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

export class FinancialsService {
  private mapResponse(financial: {
    id: string;
    periodDate: string | null;
    payload: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }): FinancialEntity {
    return {
      id: financial.id,
      periodDate: financial.periodDate,
      payload: financial.payload,
      createdAt: financial.createdAt,
      updatedAt: financial.updatedAt,
    };
  }

  async create(payload: FinancialPayload): Promise<FinancialEntity> {
    const periodDate = payload.metaData.periodDate;

    const existingForPeriod = await prisma.financials.findFirst({
      where: { periodDate },
      select: { id: true },
    });

    if (existingForPeriod) {
      throw new FinanceHttpError(
        409,
        `Financial record for period ${periodDate} already exists`,
      );
    }

    const created = await prisma.financials.create({
      data: { payload, periodDate },
      select: {
        id: true,
        periodDate: true,
        payload: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return this.mapResponse(created);
  }

  async findAll(pagination: PaginationQuery): Promise<{
    data: FinancialEntity[];
    total: number;
  }> {
    const [total, financials] = await Promise.all([
      prisma.financials.count(),
      prisma.financials.findMany({
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
        select: {
          id: true,
          periodDate: true,
          payload: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      total,
      data: financials.map((financial) => this.mapResponse(financial)),
    };
  }

  async findOne(id: string): Promise<FinancialEntity> {
    const existing = await prisma.financials.findUnique({
      where: { id },
      select: {
        id: true,
        periodDate: true,
        payload: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!existing) {
      throw new FinanceHttpError(404, "Financial record not found");
    }

    return this.mapResponse(existing);
  }

  async update(id: string, payload: FinancialPayload): Promise<FinancialEntity> {
    const periodDate = payload.metaData.periodDate;

    const existing = await prisma.financials.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new FinanceHttpError(404, "Financial record not found");
    }

    const duplicateForPeriod = await prisma.financials.findFirst({
      where: {
        periodDate,
        id: { not: id },
      },
      select: { id: true },
    });

    if (duplicateForPeriod) {
      throw new FinanceHttpError(
        409,
        `Financial record for period ${periodDate} already exists`,
      );
    }

    const updated = await prisma.financials.update({
      where: { id },
      data: { payload, periodDate },
      select: {
        id: true,
        periodDate: true,
        payload: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return this.mapResponse(updated);
  }

  async delete(id: string): Promise<{ id: string; deleted: true }> {
    const existing = await prisma.financials.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new FinanceHttpError(404, "Financial record not found");
    }

    await prisma.financials.delete({ where: { id } });

    return {
      id,
      deleted: true,
    };
  }
}
