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

// The admin form leaves the verse, reference and message optional; the
// columns are NOT NULL, so store an empty string rather than failing.
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Only the editable columns, so a client echoing back a fetched row (id,
 *  createdAt, …) cannot make Prisma reject the update. */
const pickEditable = (data: AnnualThemeUpdatePayload) => {
  const out: {
    year?: number;
    title?: string;
    verseReference?: string;
    verse?: string;
    message?: string;
    isActive?: boolean;
  } = {};
  if (data.year !== undefined && data.year !== null && data.year !== "") out.year = Number(data.year);
  if (data.title !== undefined) out.title = text(data.title);
  if (data.verseReference !== undefined) out.verseReference = text(data.verseReference);
  if (data.verse !== undefined) out.verse = text(data.verse);
  if (data.message !== undefined) out.message = text(data.message);
  if (data.isActive !== undefined) out.isActive = Boolean(data.isActive);
  return out;
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
        title: text(data.title),
        verseReference: text(data.verseReference),
        verse: text(data.verse),
        message: text(data.message),
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
    const { branch_id } = data;

    return prisma.annualTheme.update({
      where: { id },
      data: {
        ...pickEditable(data),
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
