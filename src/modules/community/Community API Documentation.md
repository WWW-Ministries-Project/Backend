# Community API

The church community feed. Members share prayer requests, testimonies, discussions,
celebrations, questions and general posts with the whole church, one of their departments,
selected members, or only themselves; others react and comment (one level of replies).

Community **replaces Announcements**: a church announcement is a post with `type: MESSAGE` +
`isImportant: true`, which only Community managers may create. The `announcement` and
`announcement_read_receipt` tables are a frozen archive; migration `20261006130000_community`
copied every published announcement into `community_post` (`legacy_announcement_id`).

## How it works

- Module: `src/modules/community/` — `communityRoute.ts` (paths), `communityController.ts` (HTTP),
  `communityService.ts` (member endpoints), `communityModerationService.ts` (moderation/admin),
  `communityQueries.ts` (visibility rules, DTO builders), `communityNotifications.ts`.
- Every endpoint is mounted at `/community` and runs `protect` + `attach_community_management`.
  Guests (`user.is_guest`) and deactivated accounts get **403** on every endpoint.
- Visibility for viewer V: post `ACTIVE`, not deleted, and one of
  `CHURCH` with the post's branch = V's branch or null · `DEPARTMENT` with V in that department
  (a `department_positions` or `user_departments` row) · `SELECTED` with V a recipient ·
  V is the author (the only way to see `ONLY_ME`). Posts V hid and posts by members V blocked are
  excluded. Comments follow the same rules. Anything not visible answers **404**.
- Anonymous posts and comments store the real `author_id`. Member endpoints return `author: null`
  (even to the author, who gets `isMine: true`). Moderation endpoints show the real author and write
  a `VIEW_ANON_AUTHOR` row to `community_moderation_log` each time.
- Feed order: important posts created in the last 7 days first, then `created_at DESC`.
  Reactions never affect order.
- Images are uploaded first through `POST /upload` (multipart `file`, returns `{result:{link}}`);
  the post carries up to 4 of those URLs.

## Permissions

Access-level key `Community` (the migration copied each level's `Announcements` value to it).

| Level | Grants |
|---|---|
| `Can_View` | Moderation queue, admin posts list (`canModerate` in `/me`) |
| `Can_Manage` | Remove / restore / warn, audit log, `MESSAGE` and `isImportant` posts, posting to any department, editing and deleting anyone's post or comment |

Guards: `can_view_community`, `can_manage_community` (reject with 401 like every
`checkPermission` guard); probe `attach_community_management` sets `req.canViewCommunity` /
`req.canManageCommunity` without rejecting. `Promotions` now falls back to `Community`, then
`Announcements`.

## Enums

- PostType: `PRAYER | TESTIMONY | DISCUSSION | CELEBRATION | QUESTION | MESSAGE | GENERAL`
- Audience: `CHURCH | DEPARTMENT | SELECTED | ONLY_ME`
- ReactionType: `PRAY | LOVE | PRAISE | CELEBRATE | SUPPORT` (comments: `PRAY | LOVE`)
- ReportReason: `INAPPROPRIATE | HARASSMENT | SAFEGUARDING | SPAM | MISLEADING | OTHER`
- ModerationStatus: `PENDING | REMOVED | RESTORED`

## Member endpoints

Envelope `{ message, data }`; lists `{ message, data, total }`; errors `{ message, data: null }`.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/community/me` | — | `{ canManage, canModerate, departments: CommunityDepartment[], pendingReports, unreadNotifications }` |
| GET | `/community/feed` | `filter=all\|prayer\|testimony\|discussion\|department`, `departmentId?`, `skip`, `take` (20, max 50) | `CommunityPost[]`, `total` |
| GET | `/community/departments` | — | `CommunityDepartment[]` (viewer's departments) |
| GET | `/community/posts/:id` | — | `{ post, comments: CommunityComment[] }` |
| POST | `/community/posts` | `{ type, body, audience, departmentId?, memberIds?, isAnonymous?, isImportant?, imageUrls? }` | 201 `CommunityPost` |
| PUT | `/community/posts/:id` | `{ body }` (author or manager) | `CommunityPost` |
| DELETE | `/community/posts/:id` | — (author or manager; soft delete) | `{ id }` |
| POST | `/community/posts/:id/reactions` | `{ type }` — toggles | `ReactionSummary[]` |
| GET | `/community/posts/:id/reactions` | — | `{ type, user: Person }[]`, newest first |
| POST | `/community/posts/:id/comments` | `{ body, parentId?, isAnonymous? }` | 201 `CommunityComment` |
| DELETE | `/community/comments/:id` | — (author or manager; soft delete) | `{ id }` |
| POST | `/community/comments/:id/reactions` | `{ type: PRAY\|LOVE }` — toggles | `ReactionSummary[]` |
| GET | `/community/comments/:id/reactions` | — | `{ type, user: Person }[]` |
| POST / DELETE | `/community/posts/:id/hide` | — (DELETE = undo) | `{ id }` |
| POST / DELETE | `/community/comments/:id/hide` | — | `{ id }` |
| POST | `/community/reports` | `{ postId? \| commentId?, reason, details? }` | 201 `{ id }`; also hides the target for the reporter |
| POST | `/community/blocks` | `{ postId? \| commentId? \| userId? }` | 201 `{ ok: true }` |
| GET | `/community/blocks` | — | `{ id /* block id */, name: string \| null }[]` |
| DELETE | `/community/blocks/:blockId` | — | `{ id }` |
| GET | `/community/members` | `q` (≥ 1 char), `take` (10, max 20) | `Person[]` |
| GET | `/community/notifications` | `skip`, `take` | `CommunityNotification[]`, `total`, `unreadCount` |
| POST | `/community/notifications/read-all` | — | `{ count }` |
| PATCH | `/community/notifications/:id/read` | — | `{ id }` |

Rules worth knowing:

- `body` is trimmed, required and at most 5000 characters (posts and comments).
- `type: MESSAGE` or `isImportant: true` without Community manage → **403**.
- `DEPARTMENT` needs `departmentId`, and a member must belong to it (managers may post to any) → 400 / 403.
- `SELECTED` needs at least one active, non-guest `memberIds` entry other than the author → 400.
- `ONLY_ME` forces `isAnonymous: false`. `imageUrls`: at most 4 http(s) URLs.
- `filter=discussion` returns `DISCUSSION` and `QUESTION` posts. `departmentId` must be one of
  the viewer's departments (→ 403) and limits the feed to that department's posts.
- Replying to a reply attaches to its top-level comment (`parentId` in the response is the
  top-level id).
- `commentCount` excludes removed, deleted and viewer-hidden comments, comments by blocked members,
  and replies whose top-level comment is excluded.
- Blocks resolve the real author from `postId` / `commentId` server-side, so an anonymous author
  can be blocked without being revealed; such a block lists with `name: null` for good. Anonymous and
  named blocks of the same member are separate entries and are never merged, so the list can't be
  used to work out who an anonymous author is. Blocking yourself → 400.
  Content the viewer has already hidden or reported can still be used to block.
- `/members` searches active non-guest members of the viewer's branch, excluding the viewer.

### DTOs

```ts
type Person = { id: number; name: string; initials: string; avatarUrl: string | null; department: string | null };

type ReactionSummary = {
  type: ReactionType; count: number; reacted: boolean;
  sample: { id: number; name: string }[]; // up to 3 most recent reactors
};

type CommunityPost = {
  id: number; type: PostType; body: string;
  audience: {
    kind: Audience; departmentId: number | null; departmentName: string | null;
    memberCount: number | null;                      // DEPARTMENT: dept size; SELECTED: recipients
    members: { id: number; name: string }[] | null;  // SELECTED, author only
  };
  isAnonymous: boolean; isImportant: boolean; isMine: boolean;
  author: Person | null;                             // null when anonymous
  images: string[]; createdAt: string;
  reactions: ReactionSummary[];                      // all 5 types, always
  commentCount: number; status: "ACTIVE" | "REMOVED";
};

type CommunityComment = {
  id: number; postId: number; parentId: number | null; body: string;
  isAnonymous: boolean; isMine: boolean;
  isPostAuthor: boolean;   // commenter is the post author with the post's anonymity
  author: Person | null; createdAt: string;
  reactions: ReactionSummary[];  // PRAY and LOVE
  replies: CommunityComment[];   // top-level only; replies have []
};

type CommunityDepartment = {
  id: number; name: string; memberCount: number;
  latest: { authorName: string | null; body: string; createdAt: string } | null;
};

type CommunityNotification = {
  id: number; type: string; title: string; actorName: string | null; body: string | null;
  postId: number | null; commentId: number | null; isRead: boolean; createdAt: string;
};
```

## Moderation / admin endpoints

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/community/moderation/reports` | view | `status=PENDING\|REMOVED\|RESTORED\|ALL` (default `PENDING`). One item per reported target, newest report first: `{ key: "POST:12" \| "COMMENT:7", kind, postId, commentId, shownAs, author: {id,name}, isAnonymous, audienceLabel, body, status, warned, reports: { reason, details, createdAt, reporterName }[] }`, `total`. Audits each anonymous item. |
| POST | `/community/moderation/:kind/:id/remove` | manage | `kind` = `posts` \| `comments`. Content → `REMOVED`, its reports → `REMOVED`. |
| POST | `/community/moderation/:kind/:id/restore` | manage | Content → `ACTIVE`, its reports → `RESTORED`. |
| POST | `/community/moderation/:kind/:id/warn` | manage | Marks the target's reports warned, sends `community.warning` to the real author. |
| GET | `/community/admin/posts` | view | `type?`, `status?` (`ACTIVE`\|`REMOVED`), `q?`, `skip`, `take` → `(CommunityPost & { realAuthor: {id,name} })[]`, `total`. Excludes deleted posts. Audits each anonymous post. |
| GET | `/community/moderation/audit-log` | manage | `skip`, `take` → `{ id, actorName, action, postId, commentId, createdAt }[]`, `total`. |

Remove / restore / warn return `{ id, kind: "POST" | "COMMENT", status /* content status */, warned }`
and each writes a `REMOVE` / `RESTORE` / `WARN` audit row.

## Notifications

Through the shared in-app notification system (inbox, SSE, web push, Expo push).
`entityType` = `COMMUNITY_POST`, `entityId` = post id,
`actionUrl` = `/member/community/posts/<postId>` (+ `?comment=<commentId>`). Sent off the
request path; a failed send is logged and never fails the action. An anonymous author is never
named: the title says "Someone" and no actor is stored. Members never hear from someone they blocked.

| Type | When | Dedupe |
|---|---|---|
| `community.comment` | Someone commented on (or replied under) your post | per comment |
| `community.reply` | Someone replied to your comment | per comment |
| `community.praying` | `PRAY` on your prayer request — "Someone is praying…" / "3 people are praying…" | per post per day, copy refreshed |
| `community.reaction` | Any other reaction on your post — "Ama and 2 others reacted to your testimony" | per post per day, copy refreshed |
| `community.important` | An important post was shared — to its whole audience. **Email on.** | per post per recipient |
| `community.department_post` | A non-important post to your department (author excluded) | per post per recipient |
| `community.warning` | A moderator warned you | per target per day |

All types are in `notificationPreferenceCatalog` (category "Community"); email is off for every
type except `community.important`.

## Data model

`community_post`, `community_post_image`, `community_post_recipient` (SELECTED audience),
`community_comment` (`parent_id`, one level), `community_reaction` (post or comment; unique per
target + user + type), `community_hidden`, `community_block` (`via_anonymous`),
`community_report` (`status`, `warned_at`), `community_moderation_log`. Posts and comments are
soft-deleted (`deleted_at`); moderation flips `status`.
