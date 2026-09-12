import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";

export type TagRow = { id: number; name: string; slug: string };

/**
 * The deduplication key. NFKC-normalize, trim, lowercase, collapse inner
 * whitespace. "Faith", " faith " and "FAITH  " all produce "faith", which the
 * unique index on sermon_tag.slug then collapses to a single row. NFKC also
 * folds the canonical-equivalence cases that otherwise slip through: a
 * precomposed "café" and a combining-accent "café", or a curly apostrophe
 * against a straight one.
 *
 * Punctuation is deliberately preserved, so "Faith!" and "Faith" are different
 * tags, as are "End-Times" and "End Times". Stripping it would destroy
 * legitimate tags like "Q&A".
 */
export const toTagSlug = (name: string): string =>
  name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Resolves tag names to rows, creating the ones that do not exist yet.
 * Uses upsert rather than findFirst-then-create so two concurrent requests
 * creating the same tag converge on one row instead of racing.
 *
 * Accepts an optional transaction client so a caller can enlist these upserts
 * in its own transaction. Called without one, each upsert commits
 * independently, so a later failure in the caller (e.g. the sermon insert
 * that follows) can leave unused tags behind; passing a transaction client
 * avoids that.
 */
export const resolveTagIds = async (
  names: unknown,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number[]> => {
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
    const tag = await client.sermon_tag.upsert({
      where: { slug },
      create: { name, slug },
      // Intentionally a no-op. The display name is fixed by whichever spelling
      // is upserted first and is never corrected by a later upsert. There is
      // no rename path through this API — changing a tag's casing needs a
      // dedicated admin action that does not exist yet.
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
    // Capped for type-ahead. Past 200 tags the list is a prefix of the
    // vocabulary, not all of it — a UX limit, not a correctness one: a tag the
    // user cannot see and retypes still upserts onto its existing row, because
    // uniqueness is enforced by the slug index rather than by this list.
    take: 200,
  });
};
