/**
 * Community notifications, delivered through the shared in-app notification
 * system. Every send happens off the request path: a failure is logged and
 * never fails the member's action.
 *
 * An anonymous author's name never appears in any notification: the title
 * says "Someone" and no actor is recorded.
 */
import { community_post_type } from "@prisma/client";
import { prisma } from "../../Models/context";
import logger from "../../utils/logger-config";
import {
  CreateNotificationInput,
  notificationService,
} from "../notifications/notificationService";
import { TYPE_LABEL, dayKey, distinctIds, preview, withArticle } from "./communityHelpers";
import { activeUserWhere, departmentMemberIds } from "./communityQueries";
import { mentionedUserIds } from "./communityRichText";

export const COMMUNITY_ENTITY_TYPE = "COMMUNITY_POST";

export const communityActionUrl = (postId: number, commentId?: number | null) =>
  `/member/community/posts/${postId}${commentId ? `?comment=${commentId}` : ""}`;

const runInBackground = (label: string, task: () => Promise<unknown>) => {
  setImmediate(() => {
    task().catch((error) => {
      logger.error(`[community] ${label} notification failed: ${(error as Error)?.message ?? error}`);
    });
  });
};

const send = async (input: CreateNotificationInput) => {
  try {
    await notificationService.createInAppNotification({
      entityType: COMMUNITY_ENTITY_TYPE,
      sendEmail: false,
      ...input,
    });
  } catch (error) {
    logger.error(`[community] ${input.type} to ${input.recipientUserId} failed: ${(error as Error)?.message ?? error}`);
  }
};

/** How many notifications a fan-out creates at once. */
const FAN_OUT_CONCURRENCY = 20;

/**
 * Sends a large batch in chunks of FAN_OUT_CONCURRENCY. notificationService
 * has no bulk insert (createManyInAppNotifications is a sequential loop), so
 * bounded parallelism keeps a church-wide fan-out from either taking minutes
 * one user at a time or exhausting the connection pool all at once.
 */
const sendAll = async (inputs: CreateNotificationInput[]) => {
  for (let index = 0; index < inputs.length; index += FAN_OUT_CONCURRENCY) {
    await Promise.all(inputs.slice(index, index + FAN_OUT_CONCURRENCY).map(send));
  }
};

/** Members who blocked `authorId` — they never hear about that member's activity. */
const blockersOf = async (authorId: number): Promise<Set<number>> => {
  const rows = await prisma.community_block.findMany({
    where: { blocked_id: authorId },
    select: { blocker_id: true },
  });
  return new Set(rows.map((row) => row.blocker_id));
};

/**
 * Creates the notification, or — when today's row for the same dedupe key
 * already exists — refreshes its copy in place ("3 people are praying…")
 * instead of sending another one.
 */
const sendOrRefresh = async (input: CreateNotificationInput & { dedupeKey: string }) => {
  const existing = await prisma.in_app_notification.findUnique({
    where: { dedupe_key: input.dedupeKey },
    select: { id: true },
  });
  if (existing) {
    // Resurface it: unread again and moved to the top of the inbox.
    await prisma.in_app_notification.update({
      where: { id: existing.id },
      data: {
        title: input.title,
        body: input.body,
        actor_user_id: input.actorUserId ?? null,
        is_read: false,
        read_at: null,
        created_at: new Date(),
      },
    });
    return;
  }
  await send(input);
};

type PostForNotify = {
  id: number;
  type: community_post_type;
  body: string;
  status: string;
  deleted_at: Date | null;
  audience: string;
  department_id: number | null;
  branch_id: number | null;
  author_id: number;
  is_anonymous: boolean;
  is_important: boolean;
};

/** Everyone in the post's audience except its author, or [] for ONLY_ME. */
const audienceRecipientIds = async (post: PostForNotify): Promise<number[]> => {
  switch (post.audience) {
    case "CHURCH": {
      const users = await prisma.user.findMany({
        where: {
          AND: [activeUserWhere, post.branch_id ? { branch_id: post.branch_id } : {}],
        },
        select: { id: true },
      });
      return users.map((user) => user.id);
    }
    case "DEPARTMENT": {
      if (!post.department_id) return [];
      const members = await departmentMemberIds([post.department_id]);
      return members.get(post.department_id) ?? [];
    }
    case "SELECTED": {
      const rows = await prisma.community_post_recipient.findMany({
        where: { post_id: post.id },
        select: { user_id: true },
      });
      return rows.map((row) => row.user_id);
    }
    default:
      return [];
  }
};

/**
 * Of `candidateIds`, the active members who can open the post: in its
 * audience (or its author), not hiding it, and not blocking its author.
 * Mirrors visiblePostWhere for a handful of users, without loading a
 * church-wide audience to check a few mentions.
 */
const membersWhoCanSee = async (post: PostForNotify, candidateIds: number[]): Promise<number[]> => {
  if (!candidateIds.length || post.status !== "ACTIVE" || post.deleted_at) return [];
  const [users, hidden, postAuthorBlockers] = await Promise.all([
    prisma.user.findMany({
      where: { AND: [{ id: { in: candidateIds } }, activeUserWhere] },
      select: { id: true, branch_id: true },
    }),
    prisma.community_hidden.findMany({
      where: { post_id: post.id, user_id: { in: candidateIds } },
      select: { user_id: true },
    }),
    blockersOf(post.author_id),
  ]);
  const hiddenBy = new Set(hidden.map((row) => row.user_id));

  let inAudience: (user: { id: number; branch_id: number | null }) => boolean;
  switch (post.audience) {
    case "CHURCH":
      inAudience = (user) => post.branch_id === null || user.branch_id === post.branch_id;
      break;
    case "DEPARTMENT": {
      const members = post.department_id
        ? (await departmentMemberIds([post.department_id])).get(post.department_id) ?? []
        : [];
      const memberSet = new Set(members);
      inAudience = (user) => memberSet.has(user.id);
      break;
    }
    case "SELECTED": {
      const rows = await prisma.community_post_recipient.findMany({
        where: { post_id: post.id, user_id: { in: candidateIds } },
        select: { user_id: true },
      });
      const recipientSet = new Set(rows.map((row) => row.user_id));
      inAudience = (user) => recipientSet.has(user.id);
      break;
    }
    default:
      inAudience = () => false;
  }

  return users
    .filter((user) => user.id === post.author_id || inAudience(user))
    .filter((user) => !hiddenBy.has(user.id) && !postAuthorBlockers.has(user.id))
    .map((user) => user.id);
};

/**
 * community.mention to each member tagged in a post or comment body. Only
 * ids not in `previousBody` (an edit re-notifies nobody), never the writer,
 * never `excludeIds` (members this comment already notified as post or
 * parent author), and only members who can see the post and haven't blocked
 * the writer. Deduped per post (or comment) per recipient.
 */
export const notifyMentions = (args: {
  post: PostForNotify;
  comment?: { id: number; body: string; author_id: number; is_anonymous: boolean } | null;
  previousBody?: string | null;
  excludeIds?: (number | null)[];
  writerName: string;
}) => {
  const { post, comment } = args;
  const body = comment ? comment.body : post.body;
  const writerId = comment ? comment.author_id : post.author_id;
  const previous = new Set(args.previousBody ? mentionedUserIds(args.previousBody) : []);
  const excluded = new Set(distinctIds([writerId, ...(args.excludeIds ?? [])]));
  const candidateIds = mentionedUserIds(body).filter((id) => !previous.has(id) && !excluded.has(id));
  if (!candidateIds.length) return;

  runInBackground("mention", async () => {
    const [visible, blockers] = await Promise.all([
      membersWhoCanSee(post, candidateIds),
      blockersOf(writerId),
    ]);
    const recipientIds = visible.filter((id) => !blockers.has(id));
    if (!recipientIds.length) return;

    const anonymous = comment ? comment.is_anonymous : post.is_anonymous;
    const actor = anonymous ? null : args.writerName;
    const title = comment
      ? `${actor ?? "Someone"} mentioned you in a comment`
      : `${actor ?? "Someone"} mentioned you in ${withArticle(TYPE_LABEL[post.type])}`;
    const excerpt = comment ? `“${preview(comment.body, 120)}”` : preview(post.body, 160);
    const actionUrl = communityActionUrl(post.id, comment?.id);

    await sendAll(
      recipientIds.map((recipientUserId) => ({
        type: "community.mention",
        title,
        body: excerpt,
        recipientUserId,
        actorUserId: actor ? writerId : null,
        entityId: post.id,
        actionUrl,
        dedupeKey: comment
          ? `community:comment:${comment.id}:mention:${recipientUserId}`
          : `community:post:${post.id}:mention:${recipientUserId}`,
      })),
    );
  });
};

/** community.important to the whole audience, or community.department_post to the department. */
export const notifyNewPost = (post: PostForNotify, authorName: string) => {
  if (!post.is_important && post.audience !== "DEPARTMENT") return;

  runInBackground("new post", async () => {
    const [audience, blockers] = await Promise.all([
      audienceRecipientIds(post),
      blockersOf(post.author_id),
    ]);
    const recipientIds = distinctIds(audience).filter(
      (id) => id !== post.author_id && !blockers.has(id),
    );
    if (!recipientIds.length) return;

    const actor = post.is_anonymous ? null : authorName;
    const actionUrl = communityActionUrl(post.id);

    if (post.is_important) {
      const title = actor ? `${actor} shared an important message` : "New important message";
      await sendAll(
        recipientIds.map((recipientUserId) => ({
          type: "community.important",
          title,
          body: preview(post.body, 160),
          recipientUserId,
          actorUserId: actor ? post.author_id : null,
          entityId: post.id,
          actionUrl,
          priority: "HIGH" as const,
          dedupeKey: `community:post:${post.id}:important:${recipientUserId}`,
          // The only community type that emails, per the contract.
          sendEmail: true,
        })),
      );
      return;
    }

    const department = post.department_id
      ? await prisma.department.findUnique({
          where: { id: post.department_id },
          select: { name: true },
        })
      : null;
    const title = `${actor ?? "Someone"} shared ${withArticle(TYPE_LABEL[post.type])}`;
    await sendAll(
      recipientIds.map((recipientUserId) => ({
        type: "community.department_post",
        title,
        body: department?.name ?? preview(post.body, 160),
        recipientUserId,
        actorUserId: actor ? post.author_id : null,
        entityId: post.id,
        actionUrl,
        dedupeKey: `community:post:${post.id}:department:${recipientUserId}`,
      })),
    );
  });
};

/** community.reply to the parent comment's author, community.comment to the post's author. */
export const notifyNewComment = (args: {
  post: { id: number; type: community_post_type; author_id: number };
  comment: { id: number; body: string; author_id: number; is_anonymous: boolean };
  parentAuthorId: number | null;
  commenterName: string;
}) => {
  const { post, comment, parentAuthorId } = args;
  runInBackground("comment", async () => {
    const blockers = await blockersOf(comment.author_id);
    const actor = comment.is_anonymous ? null : args.commenterName;
    const body = `“${preview(comment.body, 120)}”`;
    const actionUrl = communityActionUrl(post.id, comment.id);

    if (parentAuthorId && parentAuthorId !== comment.author_id && !blockers.has(parentAuthorId)) {
      await send({
        type: "community.reply",
        title: `${actor ?? "Someone"} replied to your comment`,
        body,
        recipientUserId: parentAuthorId,
        actorUserId: actor ? comment.author_id : null,
        entityId: post.id,
        actionUrl,
        dedupeKey: `community:comment:${comment.id}:reply`,
      });
    }

    if (
      post.author_id !== comment.author_id &&
      post.author_id !== parentAuthorId &&
      !blockers.has(post.author_id)
    ) {
      await send({
        type: "community.comment",
        title: `${actor ?? "Someone"} commented on your ${TYPE_LABEL[post.type]}`,
        body,
        recipientUserId: post.author_id,
        actorUserId: actor ? comment.author_id : null,
        entityId: post.id,
        actionUrl,
        dedupeKey: `community:comment:${comment.id}:post-author`,
      });
    }
  });
};

/**
 * PRAY on a prayer request -> community.praying ("3 people are praying…");
 * any other reaction -> community.reaction. Both are one notification per
 * post per day, refreshed as more people react.
 */
export const notifyReaction = (args: {
  post: { id: number; type: community_post_type; body: string; author_id: number };
  reactorId: number;
  reactorName: string;
  type: string;
}) => {
  const { post, reactorId } = args;
  if (post.author_id === reactorId) return;

  runInBackground("reaction", async () => {
    const blockers = await blockersOf(reactorId);
    if (blockers.has(post.author_id)) return;
    const today = dayKey();
    const actionUrl = communityActionUrl(post.id);

    if (post.type === "PRAYER" && args.type === "PRAY") {
      const praying = await prisma.community_reaction.count({
        where: { post_id: post.id, type: "PRAY", user_id: { not: post.author_id } },
      });
      await sendOrRefresh({
        type: "community.praying",
        title:
          praying > 1
            ? `${praying} people are praying for your request`
            : "Someone is praying for your request",
        body: preview(post.body, 160),
        recipientUserId: post.author_id,
        actorUserId: null,
        entityType: COMMUNITY_ENTITY_TYPE,
        entityId: post.id,
        actionUrl,
        sendEmail: false,
        dedupeKey: `community:praying:${post.id}:${today}`,
      });
      return;
    }

    const reactors = await prisma.community_reaction.findMany({
      where: { post_id: post.id, user_id: { not: post.author_id } },
      distinct: ["user_id"],
      select: { user_id: true },
    });
    const others = Math.max(0, reactors.length - 1);
    const label = TYPE_LABEL[post.type];
    await sendOrRefresh({
      type: "community.reaction",
      title:
        others > 0
          ? `${args.reactorName} and ${others} ${others === 1 ? "other" : "others"} reacted to your ${label}`
          : `${args.reactorName} reacted to your ${label}`,
      body: preview(post.body, 160),
      recipientUserId: post.author_id,
      actorUserId: reactorId,
      entityType: COMMUNITY_ENTITY_TYPE,
      entityId: post.id,
      actionUrl,
      sendEmail: false,
      dedupeKey: `community:reaction:${post.id}:${today}`,
    });
  });
};

/** community.warning to the real author of moderated content. No actor. */
export const notifyWarning = (args: {
  authorId: number;
  postId: number;
  commentId: number | null;
}) => {
  runInBackground("warning", async () => {
    const what = args.commentId ? "comment" : "post";
    await send({
      type: "community.warning",
      title: `A moderator reviewed your ${what}`,
      body:
        "It was reported by other members. Please keep Community kind, respectful and safe for everyone.",
      recipientUserId: args.authorId,
      actorUserId: null,
      entityId: args.postId,
      actionUrl: communityActionUrl(args.postId, args.commentId),
      priority: "HIGH",
      dedupeKey: `community:warning:${what}:${args.commentId ?? args.postId}:${dayKey()}`,
    });
  });
};
