import { prisma } from "../../Models/context";

/**
 * The streaming platforms an event can carry a link for. Adding one here is
 * the whole change — `platform` is a VARCHAR, not a DB enum, precisely so a
 * new platform needs no migration and no mobile release. `label` and
 * `join_label` ship in the API response so already-installed clients render a
 * platform they have never heard of correctly.
 */
export const ONLINE_PLATFORMS: Record<
  string,
  { label: string; join_label: string; host_hints: string[] }
> = {
  zoom: {
    label: "Zoom",
    join_label: "Join on Zoom",
    host_hints: ["zoom.us", "zoom.com"],
  },
  youtube: {
    label: "YouTube",
    join_label: "Watch on YouTube",
    host_hints: ["youtube.com", "youtu.be"],
  },
};

export type OnlineLinkInput = { platform: string; url: string };

const normalizePlatform = (value: unknown) =>
  String(value ?? "").trim().toLowerCase();

const isValidHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

/** Prisma select for the relation — kept next to the serializer that reads it. */
export const onlineLinkSelect = {
  platform: true,
  url: true,
} as const;

/**
 * Turns stored rows into the client-facing shape. Rows for a platform no
 * longer in the registry are dropped rather than returned label-less.
 */
export const serializeOnlineLinks = (rows: unknown) => {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row: any) => {
      const platform = normalizePlatform(row?.platform);
      const meta = ONLINE_PLATFORMS[platform];
      const url = String(row?.url ?? "").trim();
      if (!meta || !url) return null;
      return {
        platform,
        label: meta.label,
        join_label: meta.join_label,
        url,
      };
    })
    .filter(
      (link): link is {
        platform: string;
        label: string;
        join_label: string;
        url: string;
      } => link !== null,
    );
};

/**
 * Validates a request body's `links` array. Returns `{ links }` on success or
 * `{ error }` with a message safe to hand straight back as a 400.
 * An entry with an empty url is kept — it means "delete this platform's link".
 */
export const parseOnlineLinksInput = (
  value: unknown,
): { links: OnlineLinkInput[] } | { error: string } => {
  if (value === undefined || value === null) {
    return { links: [] };
  }

  if (!Array.isArray(value)) {
    return { error: "links must be an array" };
  }

  const links: OnlineLinkInput[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    const platform = normalizePlatform((entry as any)?.platform);

    if (!platform) {
      return { error: "Each online link needs a platform" };
    }

    if (!ONLINE_PLATFORMS[platform]) {
      return { error: `Unsupported online platform: ${platform}` };
    }

    if (seen.has(platform)) {
      return { error: `Duplicate online link for platform: ${platform}` };
    }
    seen.add(platform);

    const url = String((entry as any)?.url ?? "").trim();

    if (url && !isValidHttpUrl(url)) {
      return {
        error: `The ${ONLINE_PLATFORMS[platform].label} link must be a valid http or https URL`,
      };
    }

    if (url.length > 2048) {
      return {
        error: `The ${ONLINE_PLATFORMS[platform].label} link is too long`,
      };
    }

    links.push({ platform, url });
  }

  return { links };
};

/**
 * Upserts every entry with a url and deletes every entry without one.
 * Platforms absent from `links` are left untouched, so a caller can update a
 * single platform without resending the others.
 */
export const applyOnlineLinks = async (
  eventId: number,
  links: OnlineLinkInput[],
  actorUserId: number | null,
) => {
  for (const link of links) {
    if (!link.url) {
      await prisma.event_online_link.deleteMany({
        where: { event_id: eventId, platform: link.platform },
      });
      continue;
    }

    await prisma.event_online_link.upsert({
      where: {
        event_id_platform: { event_id: eventId, platform: link.platform },
      },
      create: {
        event_id: eventId,
        platform: link.platform,
        url: link.url,
        updated_by: actorUserId,
        updated_at: new Date(),
      },
      update: {
        url: link.url,
        updated_by: actorUserId,
        updated_at: new Date(),
      },
    });
  }
};

/** Reads back an event's links in the serialized client shape. */
export const readOnlineLinks = async (eventId: number) => {
  const rows = await prisma.event_online_link.findMany({
    where: { event_id: eventId },
    select: onlineLinkSelect,
    orderBy: { platform: "asc" },
  });
  return serializeOnlineLinks(rows);
};
