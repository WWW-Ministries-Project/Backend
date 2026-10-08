/**
 * Community — member endpoints. Visibility rules live in communityQueries;
 * every read goes through them so a post or comment a member may not see is
 * indistinguishable from one that does not exist (404).
 */
import { Prisma, community_audience, community_post_type, community_reaction_type } from "@prisma/client";
import { prisma } from "../../Models/context";
import {
  InputValidationError,
  NotFoundError,
  UnauthorizedError,
} from "../../utils/custom-error-handlers";
import {
  AUDIENCES,
  COMMENT_REACTIONS,
  IMPORTANT_PIN_DAYS,
  MAX_IMAGES,
  MAX_IMAGE_URL_LENGTH,
  MAX_MEMBER_SEARCH,
  MAX_REPORT_DETAILS_LENGTH,
  POST_REACTIONS,
  POST_TYPES,
  REPORT_REASONS,
  distinctIds,
  parseBody,
  parseBoolean,
  parseEnum,
  parsePaging,
  toPositiveInt,
} from "./communityHelpers";
import {
  CommunityPostDto,
  Viewer,
  activeUserWhere,
  audienceWhere,
  buildCommentTree,
  buildPostDtos,
  commentInclude,
  departmentMemberIds,
  personSelect,
  postInclude,
  reactionSummaries,
  toPerson,
  visibleCommentWhere,
  visiblePostWhere,
} from "./communityQueries";
import { notifyMentions, notifyNewComment, notifyNewPost, notifyReaction } from "./communityNotifications";
import { bodyToPlainText } from "./communityRichText";

const COMMUNITY_NOTIFICATION_PREFIX = "community.";

// Status codes: 403 (UnauthorizedError) is reserved for real authorization
// failures — guests / deactivated accounts (loadViewer) and non-managers
// posting MESSAGE or important posts. The web dashboard treats any 403 as
// "access denied" and leaves the page, so business-rule rejections are 400
// (InputValidationError) and content the viewer can't see is 404.

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

const findVisiblePost = async (viewer: Viewer, postId: unknown) => {
  const id = toPositiveInt(postId);
  if (!id) throw new NotFoundError("Post not found");
  const post = await prisma.community_post.findFirst({
    where: { AND: [{ id }, visiblePostWhere(viewer)] },
    include: postInclude,
  });
  if (!post) throw new NotFoundError("Post not found");
  return post;
};

const findVisibleComment = async (viewer: Viewer, commentId: unknown) => {
  const id = toPositiveInt(commentId);
  if (!id) throw new NotFoundError("Comment not found");
  const comment = await prisma.community_comment.findFirst({
    where: { AND: [{ id }, visibleCommentWhere(viewer), { post: visiblePostWhere(viewer) }] },
    include: commentInclude,
  });
  if (!comment) throw new NotFoundError("Comment not found");
  return comment;
};

const postDto = async (viewer: Viewer, postId: number): Promise<CommunityPostDto> => {
  const row = await prisma.community_post.findUnique({ where: { id: postId }, include: postInclude });
  if (!row) throw new NotFoundError("Post not found");
  const [dto] = await buildPostDtos(viewer, [row]);
  return dto;
};

/* ------------------------------------------------------------------ */
/* Departments and /me                                                 */
/* ------------------------------------------------------------------ */

export const listDepartments = async (viewer: Viewer) => {
  if (!viewer.departmentIds.length) return [];
  const [departments, members] = await Promise.all([
    prisma.department.findMany({
      where: { id: { in: viewer.departmentIds } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    departmentMemberIds(viewer.departmentIds),
  ]);

  const latest = await Promise.all(
    departments.map((department) =>
      prisma.community_post.findFirst({
        where: {
          AND: [visiblePostWhere(viewer), { audience: "DEPARTMENT", department_id: department.id }],
        },
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
        select: { body: true, created_at: true, is_anonymous: true, author: { select: { name: true } } },
      }),
    ),
  );

  return departments.map((department, index) => {
    const post = latest[index];
    return {
      id: department.id,
      name: department.name,
      memberCount: members.get(department.id)?.length ?? 0,
      latest: post
        ? {
            authorName: post.is_anonymous ? null : post.author.name,
            body: bodyToPlainText(post.body),
            createdAt: post.created_at.toISOString(),
          }
        : null,
    };
  });
};

const communityNotificationWhere = (viewer: Viewer): Prisma.in_app_notificationWhereInput => ({
  recipient_user_id: viewer.id,
  type: { startsWith: COMMUNITY_NOTIFICATION_PREFIX },
});

export const getMe = async (viewer: Viewer) => {
  const [departments, pendingTargets, unreadNotifications] = await Promise.all([
    listDepartments(viewer),
    viewer.canView
      ? prisma.community_report.groupBy({
          by: ["post_id", "comment_id"],
          where: { status: "PENDING" },
        })
      : Promise.resolve([]),
    prisma.in_app_notification.count({
      where: { ...communityNotificationWhere(viewer), is_read: false },
    }),
  ]);

  return {
    canManage: viewer.canManage,
    canModerate: viewer.canView,
    departments,
    pendingReports: viewer.canView ? pendingTargets.length : 0,
    unreadNotifications,
  };
};

/* ------------------------------------------------------------------ */
/* Feed                                                                */
/* ------------------------------------------------------------------ */

const FEED_FILTERS = ["all", "prayer", "testimony", "discussion", "department"] as const;

export const listFeed = async (viewer: Viewer, query: Record<string, unknown>) => {
  const filter = String(query.filter ?? "all").trim().toLowerCase() || "all";
  if (!(FEED_FILTERS as readonly string[]).includes(filter)) {
    throw new InputValidationError(`filter must be one of ${FEED_FILTERS.join(", ")}`);
  }
  const { skip, take } = parsePaging(query);

  const conditions: Prisma.community_postWhereInput[] = [visiblePostWhere(viewer)];
  if (filter === "prayer") conditions.push({ type: "PRAYER" });
  if (filter === "testimony") conditions.push({ type: "TESTIMONY" });
  if (filter === "discussion") conditions.push({ type: { in: ["DISCUSSION", "QUESTION"] } });
  if (filter === "department") {
    conditions.push({ audience: "DEPARTMENT", department_id: { in: viewer.departmentIds } });
  }

  if (query.departmentId !== undefined && query.departmentId !== "") {
    const departmentId = toPositiveInt(query.departmentId);
    if (!departmentId) throw new InputValidationError("departmentId must be a positive integer");
    if (!viewer.departmentIds.includes(departmentId)) {
      throw new InputValidationError("You are not a member of that department");
    }
    conditions.push({ audience: "DEPARTMENT", department_id: departmentId });
  }

  // Important posts from the last week are pinned above everything else.
  const since = new Date(Date.now() - IMPORTANT_PIN_DAYS * 86_400_000);
  const pinned: Prisma.community_postWhereInput = { is_important: true, created_at: { gte: since } };
  const pinnedWhere = { AND: [...conditions, pinned] };
  const restWhere = { AND: [...conditions, { NOT: pinned }] };
  const orderBy: Prisma.community_postOrderByWithRelationInput[] = [
    { created_at: "desc" },
    { id: "desc" },
  ];

  const [pinnedTotal, restTotal] = await prisma.$transaction([
    prisma.community_post.count({ where: pinnedWhere }),
    prisma.community_post.count({ where: restWhere }),
  ]);

  const pinnedTake = skip < pinnedTotal ? Math.min(take, pinnedTotal - skip) : 0;
  const restTake = take - pinnedTake;
  const restSkip = Math.max(0, skip - pinnedTotal);

  const [pinnedRows, restRows] = await prisma.$transaction([
    prisma.community_post.findMany({
      where: pinnedWhere,
      include: postInclude,
      orderBy,
      skip: Math.min(skip, pinnedTotal),
      take: pinnedTake,
    }),
    prisma.community_post.findMany({
      where: restWhere,
      include: postInclude,
      orderBy,
      skip: restSkip,
      take: restTake,
    }),
  ]);

  return {
    data: await buildPostDtos(viewer, [...pinnedRows, ...restRows]),
    total: pinnedTotal + restTotal,
  };
};

/* ------------------------------------------------------------------ */
/* Posts                                                               */
/* ------------------------------------------------------------------ */

export const getPost = async (viewer: Viewer, postId: unknown) => {
  const post = await findVisiblePost(viewer, postId);
  const commentRows = await prisma.community_comment.findMany({
    where: { AND: [{ post_id: post.id }, visibleCommentWhere(viewer)] },
    include: commentInclude,
    orderBy: [{ created_at: "asc" }, { id: "asc" }],
  });
  const [[dto], comments] = await Promise.all([
    buildPostDtos(viewer, [post]),
    buildCommentTree(viewer, post, commentRows),
  ]);
  return { post: dto, comments };
};

const parseImageUrls = (value: unknown): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new InputValidationError("imageUrls must be an array of URLs");
  const urls = value.map((item) => (typeof item === "string" ? item.trim() : ""));
  if (urls.some((url) => !url || url.length > MAX_IMAGE_URL_LENGTH || !/^https?:\/\//i.test(url))) {
    throw new InputValidationError("imageUrls must be http(s) URLs from POST /upload");
  }
  if (urls.length > MAX_IMAGES) {
    throw new InputValidationError(`A post can have at most ${MAX_IMAGES} images`);
  }
  return urls;
};

export const createPost = async (viewer: Viewer, input: Record<string, unknown>) => {
  const type = parseEnum<community_post_type>(input.type, POST_TYPES, "type");
  const body = parseBody(input.body);
  const audience = parseEnum<community_audience>(input.audience, AUDIENCES, "audience");
  const isImportant = parseBoolean(input.isImportant);
  let isAnonymous = parseBoolean(input.isAnonymous);
  const imageUrls = parseImageUrls(input.imageUrls);

  if ((type === "MESSAGE" || isImportant) && !viewer.canManage) {
    throw new UnauthorizedError("Only Community managers can post church messages or important posts");
  }

  let departmentId: number | null = null;
  let recipientIds: number[] = [];

  if (audience === "DEPARTMENT") {
    departmentId = toPositiveInt(input.departmentId);
    if (!departmentId) throw new InputValidationError("departmentId is required for a DEPARTMENT audience");
    if (!viewer.canManage && !viewer.departmentIds.includes(departmentId)) {
      throw new InputValidationError("You can only post to a department you belong to");
    }
    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      select: { id: true },
    });
    if (!department) throw new NotFoundError("Department not found");
  }

  if (audience === "SELECTED") {
    const requested = Array.isArray(input.memberIds)
      ? distinctIds(input.memberIds.map((id) => toPositiveInt(id))).filter((id) => id !== viewer.id)
      : [];
    if (requested.length) {
      const users = await prisma.user.findMany({
        // Same pool as GET /community/members: active members of the viewer's branch.
        where: {
          AND: [
            { id: { in: requested } },
            activeUserWhere,
            viewer.branchId ? { branch_id: viewer.branchId } : {},
          ],
        },
        select: { id: true },
      });
      recipientIds = users.map((user) => user.id);
    }
    if (!recipientIds.length) {
      throw new InputValidationError("Choose at least one member for a SELECTED audience");
    }
  }

  if (audience === "ONLY_ME") isAnonymous = false;

  const created = await prisma.community_post.create({
    data: {
      type,
      body,
      audience,
      department_id: departmentId,
      author_id: viewer.id,
      is_anonymous: isAnonymous,
      is_important: isImportant,
      branch_id: viewer.branchId,
      images: {
        create: imageUrls.map((url, position) => ({ url, position })),
      },
      recipients: {
        create: recipientIds.map((user_id) => ({ user_id })),
      },
    },
  });

  notifyNewPost(created, viewer.name);
  notifyMentions({ post: created, writerName: viewer.name });
  return postDto(viewer, created.id);
};

/** Author or Community manager; the post must not be deleted. */
const findEditablePost = async (viewer: Viewer, postId: unknown) => {
  const id = toPositiveInt(postId);
  if (!id) throw new NotFoundError("Post not found");
  const post = await prisma.community_post.findFirst({
    where: viewer.canManage ? { id, deleted_at: null } : { AND: [{ id }, visiblePostWhere(viewer)] },
    select: { id: true, author_id: true, body: true },
  });
  if (!post) throw new NotFoundError("Post not found");
  if (post.author_id !== viewer.id && !viewer.canManage) {
    throw new InputValidationError("You can only change your own posts");
  }
  return post;
};

export const updatePost = async (viewer: Viewer, postId: unknown, input: Record<string, unknown>) => {
  const post = await findEditablePost(viewer, postId);
  const body = parseBody(input.body);
  const updated = await prisma.community_post.update({
    where: { id: post.id },
    data: { body },
    include: { author: { select: { name: true } } },
  });
  // The body is the author's even when a manager edits it, so mentions are
  // sent in the author's name (or anonymously).
  notifyMentions({ post: updated, previousBody: post.body, writerName: updated.author.name });
  return postDto(viewer, post.id);
};

export const deletePost = async (viewer: Viewer, postId: unknown) => {
  const post = await findEditablePost(viewer, postId);
  await prisma.community_post.update({ where: { id: post.id }, data: { deleted_at: new Date() } });
  return { id: post.id };
};

/* ------------------------------------------------------------------ */
/* Reactions                                                           */
/* ------------------------------------------------------------------ */

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** Adds the reaction, or removes it if the viewer already reacted with that type. Returns true when added. */
const toggleReaction = async (
  target: { post_id: number } | { comment_id: number },
  userId: number,
  type: community_reaction_type,
): Promise<boolean> => {
  const existing = await prisma.community_reaction.findFirst({
    where: { ...target, user_id: userId, type },
    select: { id: true },
  });
  if (existing) {
    await prisma.community_reaction.deleteMany({ where: { id: existing.id } });
    return false;
  }
  try {
    await prisma.community_reaction.create({ data: { ...target, user_id: userId, type } });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false; // a double tap raced us; it is set
    throw error;
  }
};

export const togglePostReaction = async (viewer: Viewer, postId: unknown, input: Record<string, unknown>) => {
  const post = await findVisiblePost(viewer, postId);
  const type = parseEnum<community_reaction_type>(input.type, POST_REACTIONS, "type");
  const added = await toggleReaction({ post_id: post.id }, viewer.id, type);
  if (added) {
    notifyReaction({ post, reactorId: viewer.id, reactorName: viewer.name, type });
  }
  return (await reactionSummaries("post", [post.id], viewer.id)).get(post.id) ?? [];
};

export const toggleCommentReaction = async (
  viewer: Viewer,
  commentId: unknown,
  input: Record<string, unknown>,
) => {
  const comment = await findVisibleComment(viewer, commentId);
  const type = parseEnum<community_reaction_type>(input.type, COMMENT_REACTIONS, "type");
  await toggleReaction({ comment_id: comment.id }, viewer.id, type);
  return (await reactionSummaries("comment", [comment.id], viewer.id)).get(comment.id) ?? [];
};

const listReactions = async (where: Prisma.community_reactionWhereInput) => {
  const rows = await prisma.community_reaction.findMany({
    where,
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    select: { type: true, user: { select: personSelect } },
  });
  return rows.map((row) => ({ type: row.type, user: toPerson(row.user) }));
};

export const listPostReactions = async (viewer: Viewer, postId: unknown) => {
  const post = await findVisiblePost(viewer, postId);
  return listReactions({ post_id: post.id });
};

export const listCommentReactions = async (viewer: Viewer, commentId: unknown) => {
  const comment = await findVisibleComment(viewer, commentId);
  return listReactions({ comment_id: comment.id });
};

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

export const createComment = async (viewer: Viewer, postId: unknown, input: Record<string, unknown>) => {
  const post = await findVisiblePost(viewer, postId);
  const body = parseBody(input.body);
  const isAnonymous = parseBoolean(input.isAnonymous);

  let parentId: number | null = null;
  let parentAuthorId: number | null = null;
  if (input.parentId !== undefined && input.parentId !== null && input.parentId !== "") {
    const requestedParentId = toPositiveInt(input.parentId);
    if (!requestedParentId) throw new InputValidationError("parentId must be a positive integer");
    const parent = await prisma.community_comment.findFirst({
      where: { AND: [{ id: requestedParentId, post_id: post.id }, visibleCommentWhere(viewer)] },
      select: { id: true, parent_id: true, author_id: true },
    });
    if (!parent) throw new NotFoundError("Comment not found");
    // One level of replies: replying to a reply attaches to its top-level
    // comment, which must itself still be visible to the viewer.
    if (parent.parent_id !== null) {
      const topLevel = await prisma.community_comment.findFirst({
        where: {
          AND: [{ id: parent.parent_id, post_id: post.id, parent_id: null }, visibleCommentWhere(viewer)],
        },
        select: { id: true },
      });
      if (!topLevel) throw new NotFoundError("Comment not found");
    }
    parentId = parent.parent_id ?? parent.id;
    parentAuthorId = parent.author_id;
  }

  const created = await prisma.community_comment.create({
    data: {
      post_id: post.id,
      parent_id: parentId,
      author_id: viewer.id,
      body,
      is_anonymous: isAnonymous,
    },
    include: commentInclude,
  });

  notifyNewComment({ post, comment: created, parentAuthorId, commenterName: viewer.name });
  notifyMentions({
    post,
    comment: created,
    // They already hear about this comment as the post or parent author.
    excludeIds: [post.author_id, parentAuthorId],
    writerName: viewer.name,
  });
  const [dto] = await buildCommentTree(viewer, post, [{ ...created, parent_id: null }]);
  return { ...dto, parentId };
};

export const deleteComment = async (viewer: Viewer, commentId: unknown) => {
  const id = toPositiveInt(commentId);
  if (!id) throw new NotFoundError("Comment not found");
  const comment = await prisma.community_comment.findFirst({
    where: viewer.canManage
      ? { id, deleted_at: null }
      : { AND: [{ id }, visibleCommentWhere(viewer), { post: audienceWhere(viewer) }] },
    select: { id: true, author_id: true },
  });
  if (!comment) throw new NotFoundError("Comment not found");
  if (comment.author_id !== viewer.id && !viewer.canManage) {
    throw new InputValidationError("You can only delete your own comments");
  }
  await prisma.community_comment.update({ where: { id: comment.id }, data: { deleted_at: new Date() } });
  return { id: comment.id };
};

/* ------------------------------------------------------------------ */
/* Hide                                                                */
/* ------------------------------------------------------------------ */

export const hidePost = async (viewer: Viewer, postId: unknown) => {
  const post = await findVisiblePost(viewer, postId);
  await prisma.community_hidden.upsert({
    where: { user_id_post_id: { user_id: viewer.id, post_id: post.id } },
    update: {},
    create: { user_id: viewer.id, post_id: post.id },
  });
  return { id: post.id };
};

export const unhidePost = async (viewer: Viewer, postId: unknown) => {
  const id = toPositiveInt(postId);
  if (!id) throw new NotFoundError("Post not found");
  await prisma.community_hidden.deleteMany({ where: { user_id: viewer.id, post_id: id } });
  return { id };
};

export const hideComment = async (viewer: Viewer, commentId: unknown) => {
  const comment = await findVisibleComment(viewer, commentId);
  await prisma.community_hidden.upsert({
    where: { user_id_comment_id: { user_id: viewer.id, comment_id: comment.id } },
    update: {},
    create: { user_id: viewer.id, comment_id: comment.id },
  });
  return { id: comment.id };
};

export const unhideComment = async (viewer: Viewer, commentId: unknown) => {
  const id = toPositiveInt(commentId);
  if (!id) throw new NotFoundError("Comment not found");
  await prisma.community_hidden.deleteMany({ where: { user_id: viewer.id, comment_id: id } });
  return { id };
};

/* ------------------------------------------------------------------ */
/* Reports and blocks                                                  */
/* ------------------------------------------------------------------ */

/** Exactly one of the given keys must hold a positive id. */
const singleTarget = <K extends string>(input: Record<string, unknown>, keys: K[]) => {
  const present = keys
    .map((key) => ({ key, id: toPositiveInt(input[key]) }))
    .filter((entry): entry is { key: K; id: number } => entry.id !== null);
  const supplied = keys.filter(
    (key) => input[key] !== undefined && input[key] !== null && input[key] !== "",
  );
  if (present.length !== 1 || supplied.length !== 1) {
    throw new InputValidationError(`Send exactly one of ${keys.join(", ")}`);
  }
  return present[0];
};

export const createReport = async (viewer: Viewer, input: Record<string, unknown>) => {
  const target = singleTarget(input, ["postId", "commentId"]);
  const reason = parseEnum(input.reason, REPORT_REASONS, "reason");
  const details =
    typeof input.details === "string" && input.details.trim()
      ? input.details.trim().slice(0, MAX_REPORT_DETAILS_LENGTH)
      : null;

  if (target.key === "postId") {
    const post = await findVisiblePost(viewer, target.id);
    const [report] = await prisma.$transaction([
      prisma.community_report.create({
        data: { reporter_id: viewer.id, post_id: post.id, reason, details },
        select: { id: true },
      }),
      prisma.community_hidden.upsert({
        where: { user_id_post_id: { user_id: viewer.id, post_id: post.id } },
        update: {},
        create: { user_id: viewer.id, post_id: post.id },
      }),
    ]);
    return { id: report.id };
  }

  const comment = await findVisibleComment(viewer, target.id);
  const [report] = await prisma.$transaction([
    prisma.community_report.create({
      data: { reporter_id: viewer.id, comment_id: comment.id, reason, details },
      select: { id: true },
    }),
    prisma.community_hidden.upsert({
      where: { user_id_comment_id: { user_id: viewer.id, comment_id: comment.id } },
      update: {},
      create: { user_id: viewer.id, comment_id: comment.id },
    }),
  ]);
  return { id: report.id };
};

/**
 * Resolves the real author server-side so an anonymous author can be blocked
 * without the blocker ever learning who it is. Content the viewer has hidden
 * or reported still resolves, since "report, then block" is the usual flow.
 */
export const createBlock = async (viewer: Viewer, input: Record<string, unknown>) => {
  const target = singleTarget(input, ["postId", "commentId", "userId"]);
  let blockedId: number;
  let viaAnonymous = false;
  let sourcePostId: number | null = null;
  let sourceCommentId: number | null = null;

  if (target.key === "postId") {
    const post = await prisma.community_post.findFirst({
      where: { AND: [{ id: target.id, deleted_at: null }, audienceWhere(viewer)] },
      select: { author_id: true, is_anonymous: true },
    });
    if (!post) throw new NotFoundError("Post not found");
    blockedId = post.author_id;
    viaAnonymous = post.is_anonymous;
    sourcePostId = target.id;
  } else if (target.key === "commentId") {
    const comment = await prisma.community_comment.findFirst({
      where: { id: target.id, deleted_at: null, post: { AND: [{ deleted_at: null }, audienceWhere(viewer)] } },
      select: { author_id: true, is_anonymous: true },
    });
    if (!comment) throw new NotFoundError("Comment not found");
    blockedId = comment.author_id;
    viaAnonymous = comment.is_anonymous;
    sourceCommentId = target.id;
  } else {
    const user = await prisma.user.findUnique({ where: { id: target.id }, select: { id: true } });
    if (!user) throw new NotFoundError("Member not found");
    blockedId = user.id;
  }

  if (blockedId === viewer.id) {
    throw new InputValidationError("You can't block yourself");
  }

  // A named block is one row per member. An anonymous block is one row per
  // source post/comment and is never merged with another row or given a
  // name: if two anonymous posts by the same author shared a row, the block
  // list not growing would tell the blocker the posts have one author.
  const sourceKey = !viaAnonymous
    ? "MEMBER"
    : sourcePostId
      ? `POST:${sourcePostId}`
      : `COMMENT:${sourceCommentId}`;
  await prisma.community_block.upsert({
    where: {
      blocker_id_blocked_id_source_key: {
        blocker_id: viewer.id,
        blocked_id: blockedId,
        source_key: sourceKey,
      },
    },
    update: {},
    create: {
      blocker_id: viewer.id,
      blocked_id: blockedId,
      via_anonymous: viaAnonymous,
      source_post_id: viaAnonymous ? sourcePostId : null,
      source_comment_id: viaAnonymous ? sourceCommentId : null,
      source_key: sourceKey,
    },
  });
  return { ok: true as const };
};

export const listBlocks = async (viewer: Viewer) => {
  const rows = await prisma.community_block.findMany({
    where: { blocker_id: viewer.id },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    select: { id: true, via_anonymous: true, blocked: { select: { name: true } } },
  });
  return rows.map((row) => ({ id: row.id, name: row.via_anonymous ? null : row.blocked.name }));
};

export const deleteBlock = async (viewer: Viewer, blockId: unknown) => {
  const id = toPositiveInt(blockId);
  if (!id) throw new NotFoundError("Block not found");
  const result = await prisma.community_block.deleteMany({ where: { id, blocker_id: viewer.id } });
  if (!result.count) throw new NotFoundError("Block not found");
  return { id };
};

/* ------------------------------------------------------------------ */
/* Member search                                                       */
/* ------------------------------------------------------------------ */

export const searchMembers = async (viewer: Viewer, query: Record<string, unknown>) => {
  const q = typeof query.q === "string" ? query.q.trim() : "";
  if (!q) throw new InputValidationError("q must be at least 1 character");
  const take = Math.min(toPositiveInt(query.take) ?? 10, MAX_MEMBER_SEARCH);

  const users = await prisma.user.findMany({
    where: {
      AND: [
        activeUserWhere,
        { id: { not: viewer.id } },
        { name: { contains: q } },
        viewer.branchId ? { branch_id: viewer.branchId } : {},
      ],
    },
    orderBy: { name: "asc" },
    take,
    select: personSelect,
  });
  return users.map(toPerson);
};

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

const commentIdFromUrl = (url: string | null): number | null => {
  const match = url ? /[?&]comment=(\d+)/.exec(url) : null;
  return match ? toPositiveInt(match[1]) : null;
};

export const listNotifications = async (viewer: Viewer, query: Record<string, unknown>) => {
  const { skip, take } = parsePaging(query);
  const where = communityNotificationWhere(viewer);
  const [rows, total, unreadCount] = await prisma.$transaction([
    prisma.in_app_notification.findMany({
      where,
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      skip,
      take,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        entity_type: true,
        entity_id: true,
        action_url: true,
        is_read: true,
        created_at: true,
        actor: { select: { name: true } },
      },
    }),
    prisma.in_app_notification.count({ where }),
    prisma.in_app_notification.count({ where: { ...where, is_read: false } }),
  ]);

  const data = rows.map((row) => {
    const actorName = row.actor?.name && row.title.startsWith(row.actor.name) ? row.actor.name : null;
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      actorName,
      body: row.body && row.body !== row.title ? row.body : null,
      postId: row.entity_type === "COMMUNITY_POST" ? toPositiveInt(row.entity_id) : null,
      commentId: commentIdFromUrl(row.action_url),
      isRead: row.is_read,
      createdAt: row.created_at.toISOString(),
    };
  });
  return { data, total, unreadCount };
};

export const markAllNotificationsRead = async (viewer: Viewer) => {
  const result = await prisma.in_app_notification.updateMany({
    where: { ...communityNotificationWhere(viewer), is_read: false },
    data: { is_read: true, read_at: new Date() },
  });
  return { count: result.count };
};

export const markNotificationRead = async (viewer: Viewer, notificationId: unknown) => {
  const id = toPositiveInt(notificationId);
  if (!id) throw new NotFoundError("Notification not found");
  const result = await prisma.in_app_notification.updateMany({
    where: { ...communityNotificationWhere(viewer), id },
    data: { is_read: true, read_at: new Date() },
  });
  if (!result.count) throw new NotFoundError("Notification not found");
  return { id };
};
