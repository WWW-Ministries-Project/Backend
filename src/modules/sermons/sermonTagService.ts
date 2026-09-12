import { prisma } from "../../Models/context";

export type TagRow = { id: number; name: string; slug: string };

/**
 * The deduplication key. Trim, lowercase, collapse inner whitespace.
 * "Faith", " faith " and "FAITH  " all produce "faith", which the unique index
 * on sermon_tag.slug then collapses to a single row.
 */
export const toTagSlug = (name: string): string =>
  name.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Resolves tag names to rows, creating the ones that do not exist yet.
 * Uses upsert rather than findFirst-then-create so two concurrent requests
 * creating the same tag converge on one row instead of racing.
 */
export const resolveTagIds = async (names: unknown): Promise<number[]> => {
  if (!Array.isArray(names)) return [];

  const bySlug = new Map<string, string>();
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const slug = toTagSlug(trimmed);
    // First spelling wins as the display name.
    if (!bySlug.has(slug)) bySlug.set(slug, trimmed);
  }

  const ids: number[] = [];
  for (const [slug, name] of bySlug) {
    const tag = await prisma.sermon_tag.upsert({
      where: { slug },
      create: { name, slug },
      update: {},
      select: { id: true },
    });
    ids.push(tag.id);
  }

  return ids;
};

export const listTags = async (search?: unknown): Promise<TagRow[]> => {
  const term = typeof search === "string" ? search.trim() : "";

  return prisma.sermon_tag.findMany({
    where: term ? { slug: { contains: toTagSlug(term) } } : undefined,
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
    take: 200,
  });
};
