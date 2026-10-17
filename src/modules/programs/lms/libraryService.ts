import { Prisma } from "@prisma/client";
import { prisma } from "../../../Models/context";
import { ProgramService } from "../programService";
import { LmsError } from "./lmsHttp";

export const LIBRARY_TYPES = ["VIDEO", "PDF", "SLIDES", "DOCUMENT", "LINK", "IMAGE"] as const;
export type LibraryType = (typeof LIBRARY_TYPES)[number];

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const httpUrl = (value: unknown) => {
  const raw = typeof value === "string" ? value.trim() : "";
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch {
    // fall through
  }
  throw new LmsError("url must be an http(s) link");
};

const optionalInt = (value: unknown, field: string) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new LmsError(`${field} must be a whole number`);
  return n;
};

/** Learning unit created from a library item. URL edits on the item are re-applied with this. */
export const unitFromItem = (item: { type: string; url: string; title: string }) => {
  switch (item.type as LibraryType) {
    case "VIDEO":
      return { type: "video", data: { url: item.url, value: item.url } };
    case "PDF":
    case "DOCUMENT":
      return { type: "pdf", data: { link: item.url } };
    case "SLIDES":
      return { type: "ppt", data: { link: item.url } };
    case "IMAGE":
      return {
        type: "lesson-note",
        data: { content: `<p><img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.title)}" /></p>` },
      };
    default:
      return {
        type: "lesson-note",
        data: {
          content: `<p><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></p>`,
        },
      };
  }
};

export class LibraryService {
  private programs = new ProgramService();

  private normalize(body: Record<string, unknown>, partial: boolean) {
    const data: Prisma.lms_library_itemUncheckedCreateInput | Record<string, unknown> = {};
    if (!partial || body.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) throw new LmsError("title is required");
      data.title = title.slice(0, 191);
    }
    if (!partial || body.type !== undefined) {
      if (!LIBRARY_TYPES.includes(body.type as LibraryType)) {
        throw new LmsError(`type must be one of ${LIBRARY_TYPES.join(", ")}`);
      }
      data.type = body.type;
    }
    if (!partial || body.url !== undefined) data.url = httpUrl(body.url);
    const size = optionalInt(body.size_bytes, "size_bytes");
    if (size !== undefined) data.size_bytes = size;
    const duration = optionalInt(body.duration_minutes, "duration_minutes");
    if (duration !== undefined) data.duration_minutes = duration;
    const pages = optionalInt(body.pages, "pages");
    if (pages !== undefined) data.pages = pages;
    if (body.tags !== undefined) {
      data.tags = (Array.isArray(body.tags) ? body.tags : [])
        .map((t) => String(t).trim())
        .filter(Boolean)
        .slice(0, 20) as unknown as Prisma.InputJsonValue;
    }
    return data;
  }

  async list(filters: { search?: string; type?: string; tag?: string }) {
    const tag = filters.tag?.trim().toLowerCase();
    const rows = await prisma.lms_library_item.findMany({
      where: {
        ...(filters.search ? { title: { contains: filters.search } } : {}),
        ...(filters.type && LIBRARY_TYPES.includes(filters.type as LibraryType) ? { type: filters.type } : {}),
      },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { units: true } } },
    });
    return rows
      .filter((r) => !tag || (Array.isArray(r.tags) ? r.tags : []).some((t) => String(t).toLowerCase() === tag))
      .map(({ _count, ...r }) => ({ ...r, usedBy: _count.units }));
  }

  async create(body: Record<string, unknown>, userId: number | null) {
    const data = this.normalize(body, false) as Prisma.lms_library_itemUncheckedCreateInput;
    return prisma.lms_library_item.create({ data: { ...data, created_by: userId } });
  }

  /** Changing the link updates every unit created from this item ("edit once, updates everywhere"). */
  async update(id: number, body: Record<string, unknown>) {
    const existing = await prisma.lms_library_item.findUnique({ where: { id } });
    if (!existing) throw new LmsError("Library item not found", 404);
    const data = this.normalize(body, true) as Prisma.lms_library_itemUpdateInput;
    const updated = await prisma.lms_library_item.update({ where: { id }, data });

    if (updated.url !== existing.url || updated.title !== existing.title || updated.type !== existing.type) {
      const units = await prisma.learningUnit.findMany({ where: { libraryItemId: id }, select: { id: true } });
      const unit = unitFromItem(updated);
      if (units.length) {
        await prisma.learningUnit.updateMany({
          where: { libraryItemId: id },
          data: { type: unit.type, data: JSON.stringify(unit.data), version: { increment: 1 } },
        });
      }
      return { ...updated, unitsUpdated: units.length };
    }
    return { ...updated, unitsUpdated: 0 };
  }

  /** Units created from the item keep their content; they just stop following the item. */
  async remove(id: number) {
    const existing = await prisma.lms_library_item.findUnique({ where: { id } });
    if (!existing) throw new LmsError("Library item not found", 404);
    await prisma.lms_library_item.delete({ where: { id } });
    return { id };
  }

  /** Adds a unit to a program from a library item, optionally inside a module. */
  async useInProgram(args: { itemId: number; programId: number; moduleId: number | null; title: string | null }) {
    const item = await prisma.lms_library_item.findUnique({ where: { id: args.itemId } });
    if (!item) throw new LmsError("Library item not found", 404);
    if (args.moduleId) {
      const mod = await prisma.program_module.findUnique({ where: { id: args.moduleId }, select: { programId: true } });
      if (!mod || mod.programId !== args.programId) throw new LmsError("Module belongs to a different program");
    }

    const topic = await this.programs.createTopic(args.programId, args.title?.trim() || item.title, "", unitFromItem(item));
    await prisma.$transaction([
      prisma.learningUnit.update({ where: { topicId: topic.id }, data: { libraryItemId: item.id } }),
      ...(args.moduleId ? [prisma.topic.update({ where: { id: topic.id }, data: { moduleId: args.moduleId } })] : []),
    ]);
    return { topicId: topic.id, name: topic.name };
  }
}

export const libraryService = new LibraryService();
