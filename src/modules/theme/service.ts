import { prisma } from "../../Models/context";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../branches/branchService";

type AnnualThemePayload = {
  year: number | string;
  title: string;
  verseReference: string;
  verse: string;
  message: string;
  imageUrl?: string | null;
  image?: string | null;
  isActive?: boolean;
  branch_id?: number | string | null;
};

type AnnualThemeUpdatePayload = Partial<AnnualThemePayload>;

const resolveImageUrl = (data: AnnualThemeUpdatePayload) => {
  if (Object.prototype.hasOwnProperty.call(data, "imageUrl")) {
    return data.imageUrl || null;
  }

  if (Object.prototype.hasOwnProperty.call(data, "image")) {
    return data.image || null;
  }

  return undefined;
};

export class AnnualThemeService {
  async create(data: AnnualThemePayload) {
    if (data.isActive) {
      await prisma.annualTheme.updateMany({
        where: getBranchScopedWhere(data.branch_id),
        data: { isActive: false },
      });
    }

    return prisma.annualTheme.create({
      data: {
        year: Number(data.year),
        title: data.title,
        verseReference: data.verseReference,
        verse: data.verse,
        message: data.message,
        imageUrl: resolveImageUrl(data),
        isActive: data.isActive ?? false,
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
    data: AnnualThemeUpdatePayload,
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

    const imageUrl = resolveImageUrl(data);
    const { branch_id, image: _legacyImage, ...themeData } = data;

    return prisma.annualTheme.update({
      where: { id },
      data: {
        ...themeData,
        year: themeData.year ? Number(themeData.year) : undefined,
        imageUrl,
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
