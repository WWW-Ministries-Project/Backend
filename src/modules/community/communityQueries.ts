/**
 * Shared building blocks for Community: who the viewer is, the visibility
 * rules as Prisma filters, department membership, and the batch loaders that
 * turn a page of rows into the wire DTOs without N+1 queries.
 */
import { Prisma, community_reaction_type } from "@prisma/client";
import { prisma } from "../../Models/context";
import { UnauthorizedError } from "../../utils/custom-error-handlers";
import {
  COMMENT_REACTIONS,
  POST_REACTIONS,
  distinctIds,
  initialsOf,
} from "./communityHelpers";

/* ------------------------------------------------------------------ */
/* Viewer                                                              */
/* ------------------------------------------------------------------ */

export type Viewer = {
  id: number;
  name: string;
  branchId: number | null;
  /** Departments the viewer belongs to (department_positions + user_departments). */
  departmentIds: number[];
  /** Members the viewer has blocked — their posts and comments are hidden. */
  blockedIds: number[];
  canView: boolean;
  canManage: boolean;
};

const MEMBER_ONLY_MESSAGE = "Community is for church members only.";

/** Same membership rule announcements used: a department position or a user_departments row. */
export const departmentIdsOf = async (userId: number): Promise<number[]> => {
  const [positions, memberships] = await Promise.all([
    prisma.department_positions.findMany({
      where: { user_id: userId },
      select: { department_id: true },
    }),
    prisma.user_departments.findMany({
      where: { user_id: userId },
      select: { department_id: true },
    }),
  ]);
  return distinctIds([
    ...positions.map((row) => row.department_id),
    ...memberships.map((row) => row.department_id),
  ]);
};

/** Loads the signed-in member, rejecting guests and deactivated accounts with 403. */
export const loadViewer = async (
  userId: number,
  access: { canView: boolean; canManage: boolean },
): Promise<Viewer> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, branch_id: true, is_active: true, is_guest: true },
  });
  if (!user || user.is_active === false || user.is_guest) {
    throw new UnauthorizedError(MEMBER_ONLY_MESSAGE);
  }

  const [departmentIds, blocks] = await Promise.all([
    departmentIdsOf(userId),
    prisma.community_block.findMany({
      where: { blocker_id: userId },
      select: { blocked_id: true },
    }),
  ]);

  return {
    id: user.id,
    name: user.name,
    branchId: user.branch_id ?? null,
    departmentIds,
    blockedIds: distinctIds(blocks.map((block) => block.blocked_id)),
    canView: access.canView || access.canManage,
    canManage: access.canManage,
  };
};

export const activeUserWhere: Prisma.userWhereInput = {
  AND: [
    { OR: [{ is_active: true }, { is_active: null }] },
    { OR: [{ is_guest: false }, { is_guest: null }] },
  ],
};

/** Active, non-guest members of the given departments, by department. */
export const departmentMemberIds = async (
  departmentIds: number[],
): Promise<Map<number, number[]>> => {
  const result = new Map<number, number[]>();
  if (!departmentIds.length) return result;

  const [positions, memberships] = await Promise.all([
    prisma.department_positions.findMany({
      where: { department_id: { in: departmentIds }, user: activeUserWhere },
      select: { department_id: true, user_id: true },
    }),
    prisma.user_departments.findMany({
      where: { department_id: { in: departmentIds }, user: activeUserWhere },
      select: { department_id: true, user_id: true },
    }),
  ]);

  const sets = new Map<number, Set<number>>();
  for (const row of [...positions, ...memberships]) {
    if (!row.department_id) continue;
    const set = sets.get(row.department_id) ?? new Set<number>();
    set.add(row.user_id);
    sets.set(row.department_id, set);
  }
  for (const id of departmentIds) {
    result.set(id, Array.from(sets.get(id) ?? []));
  }
  return result;
};

/* ------------------------------------------------------------------ */
/* Visibility                                                          */
/* ------------------------------------------------------------------ */

/** Who may see a post at all, ignoring its status, hides and blocks. */
export const audienceWhere = (viewer: Viewer): Prisma.community_postWhereInput => {
  const or: Prisma.community_postWhereInput[] = [
    { author_id: viewer.id },
    {
      audience: "CHURCH",
      OR: [{ branch_id: viewer.branchId }, { branch_id: null }],
    },
    { audience: "SELECTED", recipients: { some: { user_id: viewer.id } } },
  ];
  if (viewer.departmentIds.length) {
    or.push({ audience: "DEPARTMENT", department_id: { in: viewer.departmentIds } });
  }
  return { OR: or };
};

/**
 * A post the viewer sees in the feed or can open: ACTIVE, not deleted, in an
 * audience they belong to, not hidden by them, and not by someone they blocked.
 */
export const visiblePostWhere = (viewer: Viewer): Prisma.community_postWhereInput => ({
  AND: [
    { status: "ACTIVE", deleted_at: null },
    audienceWhere(viewer),
    { hidden_by: { none: { user_id: viewer.id } } },
    viewer.blockedIds.length ? { author_id: { notIn: viewer.blockedIds } } : {},
  ],
});

/** Comment-level rules; the post's own visibility is checked separately. */
export const visibleCommentWhere = (viewer: Viewer): Prisma.community_commentWhereInput => ({
  status: "ACTIVE",
  deleted_at: null,
  hidden_by: { none: { user_id: viewer.id } },
  ...(viewer.blockedIds.length ? { author_id: { notIn: viewer.blockedIds } } : {}),
});

/** What commentCount counts: visible comments whose thread (top-level parent) is visible too. */
export const countedCommentWhere = (viewer: Viewer): Prisma.community_commentWhereInput => ({
  AND: [
    visibleCommentWhere(viewer),
    { OR: [{ parent_id: null }, { parent: visibleCommentWhere(viewer) }] },
  ],
});

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

export const personSelect = {
  id: true,
  name: true,
  user_info: { select: { photo: true } },
  department: { select: { department_info: { select: { name: true } } } },
  department_positions: {
    take: 1,
    orderBy: { id: "asc" },
    select: { department: { select: { name: true } } },
  },
} satisfies Prisma.userSelect;

export type PersonRow = Prisma.userGetPayload<{ select: typeof personSelect }>;

export type PersonDto = {
  id: number;
  name: string;
  initials: string;
  avatarUrl: string | null;
  department: string | null;
};

export const toPerson = (user: PersonRow): PersonDto => ({
  id: user.id,
  name: user.name,
  initials: initialsOf(user.name),
  avatarUrl: user.user_info?.photo?.trim() || null,
  department:
    user.department?.department_info?.name ??
    user.department_positions[0]?.department?.name ??
    null,
});

/* ------------------------------------------------------------------ */
/* Reactions                                                           */
/* ------------------------------------------------------------------ */

export type ReactionSummary = {
  type: community_reaction_type;
  count: number;
  reacted: boolean;
  sample: { id: number; name: string }[];
};

type ReactionRow = {
  target_id: number;
  type: community_reaction_type;
  user_id: number;
  name: string;
  rn: bigint | number;
  n: bigint | number;
  mine: bigint | number | null;
};

/**
 * One query for a page of posts or comments: per (target, type) the count,
 * whether the viewer reacted, and the three most recent reactors.
 */
export const reactionSummaries = async (
  target: "post" | "comment",
  ids: number[],
  viewerId: number,
): Promise<Map<number, ReactionSummary[]>> => {
  const types = target === "post" ? POST_REACTIONS : COMMENT_REACTIONS;
  const result = new Map<number, ReactionSummary[]>();
  const empty = () =>
    types.map((type) => ({ type, count: 0, reacted: false, sample: [] as { id: number; name: string }[] }));
  for (const id of ids) result.set(id, empty());
  if (!ids.length) return result;

  const column = Prisma.raw(target === "post" ? "`post_id`" : "`comment_id`");
  const rows = await prisma.$queryRaw<ReactionRow[]>(Prisma.sql`
    SELECT t.target_id, t.type, t.user_id, u.name, t.rn, t.n, t.mine
    FROM (
      SELECT
        r.${column} AS target_id,
        r.type,
        r.user_id,
        ROW_NUMBER() OVER (PARTITION BY r.${column}, r.type ORDER BY r.created_at DESC, r.id DESC) AS rn,
        COUNT(*) OVER (PARTITION BY r.${column}, r.type) AS n,
        MAX(CASE WHEN r.user_id = ${viewerId} THEN 1 ELSE 0 END) OVER (PARTITION BY r.${column}, r.type) AS mine
      FROM community_reaction r
      WHERE r.${column} IN (${Prisma.join(ids)})
    ) t
    JOIN \`user\` u ON u.id = t.user_id
    WHERE t.rn <= 3
    ORDER BY t.target_id, t.type, t.rn
  `);

  for (const row of rows) {
    const summaries = result.get(Number(row.target_id));
    const summary = summaries?.find((item) => item.type === row.type);
    if (!summary) continue;
    summary.count = Number(row.n);
    summary.reacted = Number(row.mine ?? 0) > 0;
    summary.sample.push({ id: Number(row.user_id), name: row.name });
  }
  return result;
};

/* ------------------------------------------------------------------ */
/* Posts                                                               */
/* ------------------------------------------------------------------ */

export const postInclude = {
  author: { select: personSelect },
  department: { select: { id: true, name: true } },
  images: { orderBy: { position: "asc" }, select: { url: true } },
  _count: { select: { recipients: true } },
} satisfies Prisma.community_postInclude;

export type PostRow = Prisma.community_postGetPayload<{ include: typeof postInclude }>;

export type CommunityPostDto = {
  id: number;
  type: string;
  body: string;
  audience: {
    kind: string;
    departmentId: number | null;
    departmentName: string | null;
    memberCount: number | null;
    members: { id: number; name: string }[] | null;
  };
  isAnonymous: boolean;
  isImportant: boolean;
  isMine: boolean;
  author: PersonDto | null;
  images: string[];
  createdAt: string;
  reactions: ReactionSummary[];
  commentCount: number;
  status: string;
};

/** Turns a page of post rows into DTOs with batched reactions, comment counts and audience sizes. */
export const buildPostDtos = async (
  viewer: Viewer,
  rows: PostRow[],
): Promise<CommunityPostDto[]> => {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const departmentIds = distinctIds(
    rows.filter((row) => row.audience === "DEPARTMENT").map((row) => row.department_id),
  );
  const ownSelectedIds = rows
    .filter((row) => row.audience === "SELECTED" && row.author_id === viewer.id)
    .map((row) => row.id);

  const [reactions, commentCounts, departmentMembers, recipients] = await Promise.all([
    reactionSummaries("post", ids, viewer.id),
    prisma.community_comment.groupBy({
      by: ["post_id"],
      where: { AND: [{ post_id: { in: ids } }, countedCommentWhere(viewer)] },
      _count: { _all: true },
    }),
    departmentMemberIds(departmentIds),
    ownSelectedIds.length
      ? prisma.community_post_recipient.findMany({
          where: { post_id: { in: ownSelectedIds } },
          orderBy: { user: { name: "asc" } },
          select: { post_id: true, user: { select: { id: true, name: true } } },
        })
      : Promise.resolve([]),
  ]);

  const commentCountOf = new Map(commentCounts.map((row) => [row.post_id, row._count._all]));
  const membersOf = new Map<number, { id: number; name: string }[]>();
  for (const row of recipients) {
    const list = membersOf.get(row.post_id) ?? [];
    list.push({ id: row.user.id, name: row.user.name });
    membersOf.set(row.post_id, list);
  }

  return rows.map((row) => {
    let memberCount: number | null = null;
    if (row.audience === "DEPARTMENT" && row.department_id) {
      memberCount = departmentMembers.get(row.department_id)?.length ?? 0;
    } else if (row.audience === "SELECTED") {
      memberCount = row._count.recipients;
    }

    return {
      id: row.id,
      type: row.type,
      body: row.body,
      audience: {
        kind: row.audience,
        departmentId: row.audience === "DEPARTMENT" ? row.department_id ?? null : null,
        departmentName: row.audience === "DEPARTMENT" ? row.department?.name ?? null : null,
        memberCount,
        members:
          row.audience === "SELECTED" && row.author_id === viewer.id
            ? membersOf.get(row.id) ?? []
            : null,
      },
      isAnonymous: row.is_anonymous,
      isImportant: row.is_important,
      isMine: row.author_id === viewer.id,
      author: row.is_anonymous ? null : toPerson(row.author),
      images: row.images.map((image) => image.url),
      createdAt: row.created_at.toISOString(),
      reactions: reactions.get(row.id) ?? [],
      commentCount: commentCountOf.get(row.id) ?? 0,
      status: row.status,
    };
  });
};

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

export const commentInclude = {
  author: { select: personSelect },
} satisfies Prisma.community_commentInclude;

export type CommentRow = Prisma.community_commentGetPayload<{ include: typeof commentInclude }>;

export type CommunityCommentDto = {
  id: number;
  postId: number;
  parentId: number | null;
  body: string;
  isAnonymous: boolean;
  isMine: boolean;
  isPostAuthor: boolean;
  author: PersonDto | null;
  createdAt: string;
  reactions: ReactionSummary[];
  replies: CommunityCommentDto[];
};

/**
 * Comment rows (top-level and replies, any order) into a tree of DTOs. Replies
 * whose top-level comment is not in `rows` are dropped with it.
 */
export const buildCommentTree = async (
  viewer: Viewer,
  post: { author_id: number; is_anonymous: boolean },
  rows: CommentRow[],
): Promise<CommunityCommentDto[]> => {
  if (!rows.length) return [];
  const reactions = await reactionSummaries(
    "comment",
    rows.map((row) => row.id),
    viewer.id,
  );

  const toDto = (row: CommentRow): CommunityCommentDto => ({
    id: row.id,
    postId: row.post_id,
    parentId: row.parent_id ?? null,
    body: row.body,
    isAnonymous: row.is_anonymous,
    isMine: row.author_id === viewer.id,
    isPostAuthor: row.author_id === post.author_id && row.is_anonymous === post.is_anonymous,
    author: row.is_anonymous ? null : toPerson(row.author),
    createdAt: row.created_at.toISOString(),
    reactions: reactions.get(row.id) ?? [],
    replies: [],
  });

  const sorted = [...rows].sort(
    (a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id - b.id,
  );
  const topLevel = new Map<number, CommunityCommentDto>();
  const tree: CommunityCommentDto[] = [];
  for (const row of sorted) {
    if (row.parent_id === null) {
      const dto = toDto(row);
      topLevel.set(row.id, dto);
      tree.push(dto);
    }
  }
  for (const row of sorted) {
    if (row.parent_id !== null) {
      topLevel.get(row.parent_id)?.replies.push(toDto(row));
    }
  }
  return tree;
};

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

export const audienceLabel = (post: {
  audience: string;
  department?: { name: string } | null;
  _count?: { recipients: number };
}): string => {
  switch (post.audience) {
    case "CHURCH":
      return "Whole church";
    case "DEPARTMENT":
      return post.department?.name ?? "Department";
    case "SELECTED": {
      const count = post._count?.recipients ?? 0;
      return `Selected members (${count})`;
    }
    case "ONLY_ME":
      return "Only me";
    default:
      return post.audience;
  }
};
