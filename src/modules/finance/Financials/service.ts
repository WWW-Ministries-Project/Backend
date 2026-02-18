import { Prisma } from "@prisma/client";
import { prisma } from "../../../Models/context";
import { FinanceHttpError, PaginationQuery } from "../common";

type FinancialEntity = {
  id: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

export class FinancialsService {
  private mapResponse(financial: {
    id: string;
    payload: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }): FinancialEntity {
    return {
      id: financial.id,
      payload: financial.payload,
      createdAt: financial.createdAt,
      updatedAt: financial.updatedAt,
    };
  }

  async create(payload: Prisma.JsonObject): Promise<FinancialEntity> {
    const created = await prisma.financials.create({
      data: { payload },
      select: {
        id: true,
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

  async update(id: string, payload: Prisma.JsonObject): Promise<FinancialEntity> {
    const existing = await prisma.financials.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new FinanceHttpError(404, "Financial record not found");
    }

    const updated = await prisma.financials.update({
      where: { id },
      data: { payload },
      select: {
        id: true,
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
