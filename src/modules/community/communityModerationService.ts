/**
 * Community moderation and admin endpoints (Community permission). These are
 * the only places that return the real author of anonymous content, and
 * every time they do a VIEW_ANON_AUTHOR row is written to the audit log.
 */
import { Prisma, community_content_status, community_post_type, community_report_status } from "@prisma/client";
import { prisma } from "../../Models/context";
import { InputValidationError, NotFoundError } from "../../utils/custom-error-handlers";
import { POST_TYPES, parseEnum, parsePaging } from "./communityHelpers";
import { Viewer, audienceLabel, buildPostDtos, postInclude } from "./communityQueries";
import { notifyWarning } from "./communityNotifications";

const REPORT_STATUSES: community_report_status[] = ["PENDING", "REMOVED", "RESTORED"];
const CONTENT_STATUSES: community_content_status[] = ["ACTIVE", "REMOVED"];
/** Upper bound on reports read for one queue page; the queue is grouped in memory. */
const MAX_REPORTS_SCANNED = 2000;

type AnonView = { post_id: number | null; comment_id: number | null };

const logAnonymousViews = async (viewer: Viewer, views: AnonView[]) => {
  if (!views.length) return;
  await prisma.community_moderation_log.createMany({
    data: views.map((view) => ({
      actor_id: viewer.id,
      action: "VIEW_ANON_AUTHOR" as const,
      post_id: view.post_id,
      comment_id: view.comment_id,
    })),
  });
};

/* ------------------------------------------------------------------ */
/* Report queue                                                        */
/* ------------------------------------------------------------------ */

const postSummarySelect = {
  id: true,
  body: true,
  audience: true,
  is_anonymous: true,
  author: { select: { id: true, name: true } },
  department: { select: { name: true } },
  _count: { select: { recipients: true } },
} satisfies Prisma.community_postSelect;

export const listReports = async (viewer: Viewer, query: Record<string, unknown>) => {
  const rawStatus = String(query.status ?? "PENDING").trim().toUpperCase() || "PENDING";
  if (rawStatus !== "ALL" && !(REPORT_STATUSES as string[]).includes(rawStatus)) {
    throw new InputValidationError("status must be one of PENDING, REMOVED, RESTORED, ALL");
  }

  const reports = await prisma.community_report.findMany({
    where: rawStatus === "ALL" ? {} : { status: rawStatus as community_report_status },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    take: MAX_REPORTS_SCANNED,
    select: {
      id: true,
      reason: true,
      details: true,
      status: true,
      warned_at: true,
      created_at: true,
      post_id: true,
      comment_id: true,
      reporter: { select: { name: true } },
      post: { select: postSummarySelect },
      comment: {
        select: {
          id: true,
          post_id: true,
          body: true,
          is_anonymous: true,
          author: { select: { id: true, name: true } },
          post: { select: postSummarySelect },
        },
      },
    },
  });

  type Item = {
    key: string;
    kind: "POST" | "COMMENT";
    postId: number;
    commentId: number | null;
    shownAs: string;
    author: { id: number; name: string };
    isAnonymous: boolean;
    audienceLabel: string;
    body: string;
    status: community_report_status;
    warned: boolean;
    reports: { reason: string; details: string | null; createdAt: string; reporterName: string }[];
  };

  const items = new Map<string, Item>();
  for (const report of reports) {
    const isComment = report.comment_id !== null;
    const target = isComment ? report.comment : report.post;
    if (!target) continue;
    const post = isComment ? report.comment!.post : report.post!;
    const key = isComment ? `COMMENT:${report.comment_id}` : `POST:${report.post_id}`;

    let item = items.get(key);
    if (!item) {
      item = {
        key,
        kind: isComment ? "COMMENT" : "POST",
        postId: post.id,
        commentId: isComment ? report.comment_id : null,
        shownAs: target.is_anonymous ? "Anonymous" : target.author.name,
        author: { id: target.author.id, name: target.author.name },
        isAnonymous: target.is_anonymous,
        audienceLabel: audienceLabel(post),
        body: target.body,
        // Reports are newest first, so the first one seen sets the status
        // unless an older one is still pending (below).
        status: report.status,
        warned: false,
        reports: [],
      };
      items.set(key, item);
    }
    if (report.status === "PENDING") item.status = "PENDING";
    if (report.warned_at) item.warned = true;
    item.reports.push({
      reason: report.reason,
      details: report.details,
      createdAt: report.created_at.toISOString(),
      reporterName: report.reporter.name,
    });
  }

  const data = Array.from(items.values());
  await logAnonymousViews(
    viewer,
    data
      .filter((item) => item.isAnonymous)
      .map((item) => ({ post_id: item.postId, comment_id: item.commentId })),
  );
  return { data, total: data.length };
};

/* ------------------------------------------------------------------ */
/* Remove / restore / warn                                             */
/* ------------------------------------------------------------------ */

type ModerationAction = "remove" | "restore" | "warn";

const parseKind = (kind: unknown): "posts" | "comments" => {
  if (kind === "posts" || kind === "comments") return kind;
  throw new NotFoundError("Unknown moderation target");
};

export const moderate = async (
  viewer: Viewer,
  kindParam: unknown,
  idParam: unknown,
  action: ModerationAction,
) => {
  const kind = parseKind(kindParam);
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) throw new NotFoundError("Content not found");

  const target =
    kind === "posts"
      ? await prisma.community_post
          .findUnique({ where: { id }, select: { id: true, author_id: true, status: true } })
          .then((post) => post && { postId: post.id, commentId: null, authorId: post.author_id, status: post.status })
      : await prisma.community_comment
          .findUnique({ where: { id }, select: { id: true, post_id: true, author_id: true, status: true } })
          .then(
            (comment) =>
              comment && {
                postId: comment.post_id,
                commentId: comment.id,
                authorId: comment.author_id,
                status: comment.status,
              },
          );
  if (!target) throw new NotFoundError("Content not found");

  const reportWhere: Prisma.community_reportWhereInput =
    kind === "posts" ? { post_id: id } : { comment_id: id };
  const log = {
    actor_id: viewer.id,
    post_id: target.postId,
    comment_id: target.commentId,
  };

  if (action === "warn") {
    await prisma.$transaction([
      prisma.community_report.updateMany({ where: reportWhere, data: { warned_at: new Date() } }),
      prisma.community_moderation_log.create({ data: { ...log, action: "WARN" } }),
    ]);
    notifyWarning({ authorId: target.authorId, postId: target.postId, commentId: target.commentId });
    return { id, kind: kind === "posts" ? "POST" : "COMMENT", status: target.status, warned: true };
  }

  const status: community_content_status = action === "remove" ? "REMOVED" : "ACTIVE";
  const reportStatus: community_report_status = action === "remove" ? "REMOVED" : "RESTORED";
  const contentUpdate =
    kind === "posts"
      ? prisma.community_post.update({ where: { id }, data: { status } })
      : prisma.community_comment.update({ where: { id }, data: { status } });

  await prisma.$transaction([
    contentUpdate,
    prisma.community_report.updateMany({ where: reportWhere, data: { status: reportStatus } }),
    prisma.community_moderation_log.create({
      data: { ...log, action: action === "remove" ? "REMOVE" : "RESTORE" },
    }),
  ]);

  const warned = Boolean(
    await prisma.community_report.findFirst({
      where: { AND: [reportWhere, { warned_at: { not: null } }] },
      select: { id: true },
    }),
  );
  return { id, kind: kind === "posts" ? "POST" : "COMMENT", status, warned };
};

/* ------------------------------------------------------------------ */
/* Admin posts list                                                    */
/* ------------------------------------------------------------------ */

export const listAdminPosts = async (viewer: Viewer, query: Record<string, unknown>) => {
  const { skip, take } = parsePaging(query);
  const conditions: Prisma.community_postWhereInput[] = [
    { deleted_at: null },
    // ONLY_ME posts are private notes: moderators only see one once it is reported.
    { OR: [{ audience: { not: "ONLY_ME" } }, { reports: { some: {} } }] },
  ];
  if (query.type !== undefined && query.type !== "") {
    conditions.push({ type: parseEnum<community_post_type>(query.type, POST_TYPES, "type") });
  }
  if (query.status !== undefined && query.status !== "") {
    conditions.push({ status: parseEnum(query.status, CONTENT_STATUSES, "status") });
  }
  const q = typeof query.q === "string" ? query.q.trim() : "";
  if (q) conditions.push({ body: { contains: q } });

  const where = { AND: conditions };
  const [rows, total] = await prisma.$transaction([
    prisma.community_post.findMany({
      where,
      include: postInclude,
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      skip,
      take,
    }),
    prisma.community_post.count({ where }),
  ]);

  const dtos = await buildPostDtos(viewer, rows);
  await logAnonymousViews(
    viewer,
    rows.filter((row) => row.is_anonymous).map((row) => ({ post_id: row.id, comment_id: null })),
  );

  const data = dtos.map((dto, index) => ({
    ...dto,
    realAuthor: { id: rows[index].author.id, name: rows[index].author.name },
  }));
  return { data, total };
};

/* ------------------------------------------------------------------ */
/* Audit log                                                           */
/* ------------------------------------------------------------------ */

export const listAuditLog = async (query: Record<string, unknown>) => {
  const { skip, take } = parsePaging(query);
  const [rows, total] = await prisma.$transaction([
    prisma.community_moderation_log.findMany({
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      skip,
      take,
      select: {
        id: true,
        action: true,
        post_id: true,
        comment_id: true,
        created_at: true,
        actor: { select: { name: true } },
      },
    }),
    prisma.community_moderation_log.count(),
  ]);

  return {
    data: rows.map((row) => ({
      id: row.id,
      actorName: row.actor.name,
      action: row.action,
      postId: row.post_id,
      commentId: row.comment_id,
      createdAt: row.created_at.toISOString(),
    })),
    total,
  };
};
