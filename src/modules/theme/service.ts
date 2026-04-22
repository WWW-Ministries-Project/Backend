import { prisma } from "../../Models/context";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../branches/branchService";

export class AnnualThemeService {
  async create(data: {
    year: number | string;
    title: string;
    verseReference: string;
    verse: string;
    message: string;
    imageUrl?: string;
    isActive?: boolean;
    branch_id?: number | string | null;
  }) {
    if (data.isActive) {
      await prisma.annualTheme.updateMany({
        where: getBranchScopedWhere(data.branch_id),
        data: { isActive: false },
      });
    }

    const result = await prisma.annualTheme.create({
      data: {
        year: Number(data.year),
        title: data.title,
        verseReference: data.verseReference,
        verse: data.verse,
        message: data.message,
        imageUrl: data.imageUrl,
        isActive: data.isActive,
        branch_id: await resolveBranchIdOrDefault(data.branch_id),
      },
    });
  }

  async findAll(branchId?: unknown) {
    return prisma.annualTheme.findMany({
      where: getBranchScopedWhere(branchId),
      orderBy: { year: "desc" },
    });
  }

  async findActive(branchId?: unknown) {
    return prisma.annualTheme.findFirst({
      where: {
        isActive: true,
        ...(getBranchScopedWhere(branchId) || {}),
      },
    });
  }

  async findById(id: number) {
    return prisma.annualTheme.findUnique({
      where: { id },
    });
  }

  async update(
    id: number,
    data: Partial<{
      year: string | number;
      title: string;
      verseReference: string;
      verse: string;
      message: string;
      imageUrl: string;
      isActive: boolean;
      branch_id: number | string | null;
    }>,
  ) {
    if (data.isActive) {
      await prisma.annualTheme.updateMany({
        where: {
          id: { not: id },
          ...(getBranchScopedWhere(data.branch_id) || {}),
        },
        data: { isActive: false },
      });
    }

    const { branch_id, ...themeData } = data;

    return prisma.annualTheme.update({
      where: { id },
      data: {
        ...themeData,
        year: themeData.year ? Number(themeData.year) : undefined,
        ...(branch_id !== undefined
          ? {
              branch_id: await resolveBranchIdOrDefault(branch_id),
            }
          : {}),
      },
    });
  }

  async delete(id: number) {
    return prisma.annualTheme.delete({
      where: { id },
    });
  }
}
