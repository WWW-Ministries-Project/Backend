/**
 * Messaging use cases: templates, settings, welcome and birthday enqueue,
 * general dispatches, previews and stats.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../Models/context";
import { InputValidationError, NotFoundError } from "../../utils/custom-error-handlers";
import { findUnknownPlaceholders, placeholdersFor, renderTemplate, smsSegments, withAppLink } from "./placeholders";
import { ageOn, isBirthdayOn, isBirthdayRunDue, localParts } from "./birthday";
import { buildRecipientRows, insertRecipients } from "./recipients";
import { findUsers, findVisitorPerson, parseAudience, resolveAudience } from "./audience";
import { refreshDispatch, triggerDispatchProcessing } from "./worker";
import {
  MessagingAccess,
  assertAudienceAllowed,
  assertChannelsAllowed,
  assertMessagingAction,
  retryableChannels,
} from "./messagingAccess";
import {
  Audience,
  Channels,
  hasAnyChannel,
  Person,
  PlaceholderKind,
  placeholderKindOf,
  TEMPLATE_KEYS,
  TemplateKey,
  toChannels,
} from "./types";

const MAX_BODY = 2000;
const MAX_SCHEDULE_DAYS = 90;
/** title / email_subject are VARCHAR(191); 150 leaves headroom. */
const MAX_TITLE = 150;
const MAX_SUBJECT = 150;
const DEFAULT_TITLES: Record<"WELCOME" | "BIRTHDAY" | "GENERAL", string> = {
  WELCOME: "Welcome",
  BIRTHDAY: "Happy birthday",
  GENERAL: "Message from the church",
};

// ---------- settings ----------

type Settings = Prisma.message_settingsGetPayload<{}>;

export const getSettings = async (): Promise<Settings> => {
  const existing = await prisma.message_settings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  try {
    return await prisma.message_settings.create({ data: { id: 1 } });
  } catch (error: any) {
    // Two first calls raced on the create; the other one won.
    if (error?.code === "P2002") return prisma.message_settings.findUniqueOrThrow({ where: { id: 1 } });
    throw error;
  }
};

const httpsOrNull = (value: unknown, field: string): string | null => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^https:\/\/\S+$/i.test(text)) throw new InputValidationError(`${field} must be an https:// link`);
  if (text.length > 191) throw new InputValidationError(`${field} must be at most 191 characters`);
  return text;
};

export const updateSettings = async (body: any, actorId: number | null, access: MessagingAccess) => {
  // Store links and the birthday send time shape the automatic messages.
  assertMessagingAction(access, "edit_templates");
  const time = String(body?.birthdaySendTime ?? "").trim();
  if (time && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
    throw new InputValidationError("birthdaySendTime must be HH:mm");
  }
  await getSettings();
  return prisma.message_settings.update({
    where: { id: 1 },
    // Full replace of both store links: a missing link clears it (the admin UI always sends both).
    data: {
      app_store_url: httpsOrNull(body?.appStoreUrl, "App Store link"),
      play_store_url: httpsOrNull(body?.playStoreUrl, "Play Store link"),
      ...(time ? { birthday_send_time: time } : {}),
      updated_by: actorId,
    },
  });
};

const linkSettings = (s: { app_store_url: string | null; play_store_url: string | null }) => ({
  appStoreUrl: s.app_store_url,
  playStoreUrl: s.play_store_url,
});

// ---------- validation shared by templates and general messages ----------

const validateMessage = (args: {
  body: unknown;
  subject: unknown;
  channels: Channels;
  kind: PlaceholderKind;
  requireChannel: boolean;
}) => {
  const body = String(args.body ?? "").trim();
  const subject = String(args.subject ?? "").trim() || null;
  if (!body) throw new InputValidationError("Message text is required");
  if (body.length > MAX_BODY) throw new InputValidationError(`Message text must be at most ${MAX_BODY} characters`);
  if (args.requireChannel && !hasAnyChannel(args.channels)) {
    throw new InputValidationError("Choose at least one channel");
  }
  if (args.channels.email && !subject) throw new InputValidationError("Email subject is required when Email is on");
  if (subject && subject.length > MAX_SUBJECT) {
    throw new InputValidationError(`Email subject must be at most ${MAX_SUBJECT} characters`);
  }
  const unknown = [
    ...findUnknownPlaceholders(body, args.kind),
    ...findUnknownPlaceholders(subject ?? "", args.kind),
  ];
  if (unknown.length) {
    throw new InputValidationError(`Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${Array.from(new Set(unknown)).join(", ")}`);
  }
  return { body, subject };
};

// ---------- templates ----------

const toTemplateDto = (t: Prisma.message_templateGetPayload<{}>) => ({
  key: t.key,
  enabled: t.enabled,
  channels: toChannels(t.channels),
  emailSubject: t.email_subject,
  body: t.body,
  includeAppLink: t.include_app_link,
  updatedAt: t.updated_at,
});

export const listTemplates = async () =>
  (await prisma.message_template.findMany({ orderBy: { id: "asc" } })).map(toTemplateDto);

const parseKey = (value: unknown): TemplateKey => {
  const key = String(value ?? "").toUpperCase();
  if (!(TEMPLATE_KEYS as readonly string[]).includes(key)) throw new NotFoundError("Unknown template");
  return key as TemplateKey;
};

export const updateTemplate = async (
  rawKey: unknown,
  body: any,
  actorId: number | null,
  access: MessagingAccess,
) => {
  const key = parseKey(rawKey);
  const channels = toChannels(body?.channels);
  const enabled = body?.enabled === true;
  const current = await prisma.message_template.findUnique({ where: { key } });
  if (!current) throw new NotFoundError("Unknown template");
  // Switching a template on or off and changing its content are separate
  // rights; each is checked only when that part changes.
  if (current.enabled !== enabled) assertMessagingAction(access, "toggle_automatic");
  const before = toTemplateDto(current);
  const contentChanged =
    JSON.stringify(before.channels) !== JSON.stringify(channels) ||
    before.body !== String(body?.body ?? "").trim() ||
    (before.emailSubject ?? "") !== String(body?.emailSubject ?? "").trim() ||
    before.includeAppLink !== (key === "WELCOME_VISITOR" && body?.includeAppLink === true);
  if (contentChanged) assertMessagingAction(access, "edit_templates");
  const message = validateMessage({
    body: body?.body,
    subject: body?.emailSubject,
    channels,
    kind: placeholderKindOf(key),
    requireChannel: enabled,
  });
  const updated = await prisma.message_template.update({
    where: { key },
    data: {
      enabled,
      channels,
      body: message.body,
      email_subject: message.subject,
      include_app_link: key === "WELCOME_VISITOR" && body?.includeAppLink === true,
      updated_by: actorId,
    },
  });
  return toTemplateDto(updated);
};

// ---------- enqueue helpers ----------

/**
 * Removes a dispatch whose recipients could not be inserted, freeing its
 * dedupe key for a retry. insertRecipients is one transaction, so no
 * recipient rows are left behind (and they cascade anyway).
 */
const discardDispatch = async (dispatchId: number) => {
  try {
    await prisma.message_dispatch.delete({ where: { id: dispatchId } });
  } catch (error) {
    console.error(`[ERROR] Messaging: could not discard dispatch ${dispatchId} after a failed enqueue:`, error);
  }
};

/**
 * Counts refresh after an enqueue. Not fatal: recipients are already in, and
 * the worker refreshes every dispatch it touches (and sweeps idle ones).
 */
const refreshQuietly = async (dispatchId: number) => {
  try {
    await refreshDispatch(dispatchId);
  } catch (error) {
    console.error(`[ERROR] Messaging: could not refresh dispatch ${dispatchId}:`, error);
  }
};

const createDispatchWithRecipients = async (args: {
  kind: "WELCOME" | "BIRTHDAY";
  templateKey: TemplateKey;
  dedupeKey: string;
  title: string;
  body: string;
  subject: string | null;
  channels: Channels;
  people: Person[];
  ageYear: number | null;
}): Promise<number | null> => {
  const settings = await getSettings();
  let dispatchId: number;
  try {
    const dispatch = await prisma.message_dispatch.create({
      data: {
        kind: args.kind,
        template_key: args.templateKey,
        dedupe_key: args.dedupeKey,
        title: args.title,
        body: args.body,
        email_subject: args.subject,
        channels: args.channels,
        status: "QUEUED",
      },
    });
    dispatchId = dispatch.id;
  } catch (error: any) {
    if (error?.code === "P2002") return null; // already sent for this key
    throw error;
  }
  try {
    await insertRecipients(
      buildRecipientRows({
        dispatchId,
        people: args.people,
        body: args.body,
        subject: args.subject,
        defaultTitle: DEFAULT_TITLES[args.kind],
        channels: args.channels,
        settings: linkSettings(settings),
        ageYear: args.ageYear,
      }),
    );
  } catch (error) {
    await discardDispatch(dispatchId);
    throw error;
  }
  await refreshQuietly(dispatchId);
  triggerDispatchProcessing();
  return dispatchId;
};

const loadEnabledTemplate = async (key: TemplateKey) => {
  const t = await prisma.message_template.findUnique({ where: { key } });
  if (!t || !t.enabled) return null;
  const channels = toChannels(t.channels);
  return hasAnyChannel(channels) ? { ...t, channels } : null;
};

// ---------- welcome ----------

/**
 * Queues the welcome message for a new app sign-up or a new visitor. Never
 * throws: sign-up and visitor creation must not fail because of messaging.
 */
export const enqueueWelcome = async (
  target: { userId: number; isGuest: boolean } | { visitorId: number },
): Promise<void> => {
  try {
    const key: TemplateKey =
      "visitorId" in target ? "WELCOME_VISITOR" : target.isGuest ? "WELCOME_GUEST" : "WELCOME_MEMBER";
    const template = await loadEnabledTemplate(key);
    if (!template) return;

    const person =
      "visitorId" in target
        ? await findVisitorPerson(target.visitorId)
        : (await findUsers({ id: target.userId }))[0] ?? null;
    if (!person) return;

    const name = [person.firstName, person.lastName].filter(Boolean).join(" ");
    await createDispatchWithRecipients({
      kind: "WELCOME",
      templateKey: key,
      dedupeKey: "visitorId" in target ? `WELCOME:visitor:${target.visitorId}` : `WELCOME:user:${target.userId}`,
      title: `Welcome — ${name || "new sign-up"}`.slice(0, MAX_TITLE),
      body: withAppLink(template.body, template.include_app_link),
      subject: template.email_subject,
      channels: template.channels,
      people: [person],
      ageYear: null,
    });
  } catch (error) {
    console.error("[ERROR] Failed to queue welcome message:", error);
  }
};

// ---------- birthday ----------

const birthdayCandidates = async (): Promise<Person[]> =>
  findUsers({
    AND: [
      { OR: [{ is_active: true }, { is_active: null }] },
      { user_info: { date_of_birth: { not: null } } },
    ],
  });

/** Runs once per local day after the configured time. Returns people queued. */
export const runBirthdays = async (now: Date = new Date()): Promise<number> => {
  const settings = await getSettings();
  if (!isBirthdayRunDue(settings, now)) return 0;
  const local = localParts(now, settings.timezone);

  const template = await loadEnabledTemplate("BIRTHDAY");
  if (!template) {
    // Mark the day done so turning the template on at 15:00 does not
    // surprise-send hours late; it starts tomorrow.
    await prisma.message_settings.update({ where: { id: 1 }, data: { last_birthday_run_date: local.date } });
    return 0;
  }

  const people = (await birthdayCandidates()).filter(
    (p) => p.dateOfBirth && isBirthdayOn(p.dateOfBirth, local),
  );

  // Claim the day first so a crash after this point cannot double-send;
  // the dispatch dedupe key is the second guard.
  const claim = await prisma.message_settings.updateMany({
    where: { id: 1, OR: [{ last_birthday_run_date: null }, { last_birthday_run_date: { not: local.date } }] },
    data: { last_birthday_run_date: local.date },
  });
  if (claim.count !== 1 || !people.length) return 0;

  let dispatchId: number | null;
  try {
    dispatchId = await createDispatchWithRecipients({
      kind: "BIRTHDAY",
      templateKey: "BIRTHDAY",
      dedupeKey: `BIRTHDAY:${local.date}`,
      title: `Birthdays — ${local.date}`.slice(0, MAX_TITLE),
      body: template.body,
      subject: template.email_subject,
      channels: template.channels,
      people,
      ageYear: local.year,
    });
  } catch (error) {
    // The day is already claimed, so nothing retries today on its own.
    console.error(`[ERROR] Birthday messages for ${local.date} failed after the day was claimed`);
    throw error;
  }
  return dispatchId ? people.length : 0;
};

export const upcomingBirthdays = async (days: number, now: Date = new Date()) => {
  const settings = await getSettings();
  const span = Math.min(Math.max(Math.trunc(days) || 7, 1), 31);
  const people = await birthdayCandidates();
  const result: { userId: number; name: string; date: string; age: number | null }[] = [];
  for (let i = 0; i < span; i += 1) {
    const day = localParts(new Date(now.getTime() + i * 86_400_000), settings.timezone);
    for (const p of people) {
      if (p.dateOfBirth && isBirthdayOn(p.dateOfBirth, day)) {
        result.push({
          userId: p.userId as number,
          name: [p.firstName, p.lastName].filter(Boolean).join(" ") || "Unknown",
          date: day.date,
          age: ageOn(p.dateOfBirth, day.year),
        });
      }
    }
  }
  return result;
};

// ---------- general ----------

const parseSchedule = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  if (isNaN(date.getTime())) throw new InputValidationError("scheduledFor is not a valid date");
  const now = Date.now();
  if (date.getTime() <= now) throw new InputValidationError("Scheduled time must be in the future");
  if (date.getTime() > now + MAX_SCHEDULE_DAYS * 86_400_000) {
    throw new InputValidationError(`Schedule at most ${MAX_SCHEDULE_DAYS} days ahead`);
  }
  return date;
};

/**
 * Resolves the audience and inserts recipients for a QUEUED general dispatch.
 * All-or-nothing (insertRecipients is one transaction). The caller refreshes.
 */
const fillGeneralDispatch = async (dispatchId: number) => {
  const d = await prisma.message_dispatch.findUniqueOrThrow({ where: { id: dispatchId } });
  const settings = await getSettings();
  const people = await resolveAudience(parseAudience(d.audience));
  await insertRecipients(
    buildRecipientRows({
      dispatchId,
      people,
      body: d.body,
      subject: d.email_subject,
      defaultTitle: d.title || DEFAULT_TITLES.GENERAL,
      channels: toChannels(d.channels),
      settings: linkSettings(settings),
      ageYear: null,
    }),
  );
};

/**
 * `access` is the HTTP caller's Messaging rights. Internal callers that
 * enforce their own rule (School of Ministry cohort announcements) omit it.
 */
export const createGeneralDispatch = async (
  body: any,
  actorId: number | null,
  access?: MessagingAccess,
) => {
  const title = String(body?.title ?? "").trim().slice(0, MAX_TITLE);
  if (!title) throw new InputValidationError("Title is required");
  const channels = toChannels(body?.channels);
  const message = validateMessage({
    body: body?.body,
    subject: body?.emailSubject,
    channels,
    kind: "GENERAL",
    requireChannel: true,
  });
  const audience = parseAudience(body?.audience);
  const scheduledFor = parseSchedule(body?.scheduledFor);
  if (access) {
    assertChannelsAllowed(access, channels);
    await assertAudienceAllowed(access, audience);
    if (scheduledFor) assertMessagingAction(access, "schedule");
  }

  const dispatch = await prisma.message_dispatch.create({
    data: {
      kind: "GENERAL",
      title,
      body: message.body,
      email_subject: message.subject,
      channels,
      audience,
      status: scheduledFor ? "SCHEDULED" : "QUEUED",
      scheduled_for: scheduledFor,
      created_by: actorId,
    },
  });
  if (!scheduledFor) {
    try {
      await fillGeneralDispatch(dispatch.id);
    } catch (error) {
      await discardDispatch(dispatch.id);
      throw error;
    }
    await refreshQuietly(dispatch.id);
    triggerDispatchProcessing();
  }
  return getDispatch(dispatch.id);
};

/** Moves due SCHEDULED dispatches to QUEUED and fills their recipients. */
export const promoteDueDispatches = async (now: Date = new Date()): Promise<number> => {
  const due = await prisma.message_dispatch.findMany({
    where: { status: "SCHEDULED", scheduled_for: { lte: now } },
    select: { id: true },
    take: 20,
  });
  let promoted = 0;
  for (const { id } of due) {
    const claim = await prisma.message_dispatch.updateMany({
      where: { id, status: "SCHEDULED" },
      data: { status: "QUEUED" },
    });
    if (claim.count !== 1) continue;
    try {
      await fillGeneralDispatch(id);
    } catch (error: any) {
      try {
        await prisma.message_dispatch.update({
          where: { id },
          data: { status: "FAILED", error: String(error?.message || error).slice(0, 1000) },
        });
      } catch (markError) {
        console.error(`[ERROR] Messaging: could not mark dispatch ${id} FAILED:`, markError);
      }
      continue;
    }
    // Outside the try: once recipients exist, a failed refresh must not mark
    // the dispatch FAILED (the worker would then never send them).
    await refreshQuietly(id);
    promoted += 1;
  }
  return promoted;
};

/** Pagination fields in both spellings: ours, and the dashboard's apiFunctions meta. */
const pageMeta = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  current_page: page,
  take: limit,
  totalPages: Math.max(Math.ceil(total / limit), 1),
});

const toDispatchDto = (d: Prisma.message_dispatchGetPayload<{}>) => ({
  id: d.id,
  kind: d.kind,
  templateKey: d.template_key,
  title: d.title,
  body: d.body,
  emailSubject: d.email_subject,
  channels: toChannels(d.channels),
  audience: d.audience,
  status: d.status,
  scheduledFor: d.scheduled_for,
  error: d.error,
  counts: d.counts,
  createdBy: d.created_by,
  createdAt: d.created_at,
});

/** History filter chips on the admin Messaging page. "sent" includes QUEUED
 *  (still sending); "failed" is any message with at least one failed send. */
const DISPATCH_FILTERS: Record<string, Prisma.message_dispatchWhereInput> = {
  all: {},
  scheduled: { status: "SCHEDULED" },
  sent: { status: { in: ["SENT", "QUEUED"] } },
  failed: { status: { not: "SCHEDULED" }, recipients: { some: { status: "FAILED" } } },
};

/** "Whole church", one department's name, "Departments (3)" or "4 people". */
const audienceLabelOf = (audience: unknown, departmentNames: Map<number, string>): string | null => {
  if (!audience || typeof audience !== "object") return null;
  const a = audience as Partial<Audience>;
  if (a.scope === "CHURCH") return "Whole church";
  if (a.scope === "DEPARTMENTS") {
    const ids = Array.isArray(a.departmentIds) ? a.departmentIds : [];
    if (ids.length === 1) return departmentNames.get(ids[0]) ?? "1 department";
    return `Departments (${ids.length})`;
  }
  if (a.scope === "PEOPLE") {
    const n = Array.isArray(a.userIds) ? a.userIds.length : 0;
    return `${n} ${n === 1 ? "person" : "people"}`;
  }
  return null;
};

export const listDispatches = async (query: any) => {
  const kind = ["WELCOME", "BIRTHDAY", "GENERAL"].includes(String(query?.kind)) ? String(query.kind) : undefined;
  const filterKey = String(query?.filter ?? "all");
  const filter = DISPATCH_FILTERS[filterKey] ?? DISPATCH_FILTERS.all;
  const page = Math.min(Math.max(Math.trunc(Number(query?.page)) || 1, 1), 10000);
  const limit = Math.min(Math.max(Math.trunc(Number(query?.limit)) || 20, 1), 100);
  const base: Prisma.message_dispatchWhereInput = kind ? { kind: kind as any } : {};
  const where: Prisma.message_dispatchWhereInput = { AND: [base, filter] };
  const [rows, total, ...facetCounts] = await Promise.all([
    prisma.message_dispatch.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.message_dispatch.count({ where }),
    ...Object.values(DISPATCH_FILTERS).map((f) => prisma.message_dispatch.count({ where: { AND: [base, f] } })),
  ]);
  const facets = Object.fromEntries(Object.keys(DISPATCH_FILTERS).map((key, i) => [key, facetCounts[i]]));

  const creatorIds = Array.from(new Set(rows.map((r) => r.created_by).filter((id): id is number => !!id)));
  const departmentIds = Array.from(
    new Set(
      rows.flatMap((r) => {
        const a = r.audience as Partial<Audience> | null;
        return a?.scope === "DEPARTMENTS" && Array.isArray(a.departmentIds) && a.departmentIds.length === 1
          ? a.departmentIds
          : [];
      }),
    ),
  );
  const [creators, departments] = await Promise.all([
    creatorIds.length
      ? prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    departmentIds.length
      ? prisma.department.findMany({ where: { id: { in: departmentIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const names = new Map(creators.map((c) => [c.id, c.name]));
  const departmentNames = new Map(departments.map((d) => [d.id, d.name]));
  return {
    data: rows.map((r) => ({
      ...toDispatchDto(r),
      createdByName: r.created_by ? names.get(r.created_by) ?? null : null,
      audienceLabel: audienceLabelOf(r.audience, departmentNames),
    })),
    facets,
    // The web client's fetch wrapper only forwards `meta.status_counts`.
    meta: { status_counts: facets },
    ...pageMeta(page, limit, total),
  };
};

/** Cap on SMS rows read to count segments; past it the figure is a floor. */
const MAX_SEGMENT_ROWS = 20000;

/** KPI tiles on the admin Messaging page: one-off (GENERAL) messages only —
 *  automatic messages report their own numbers on their template cards. */
export const overviewStats = async (rawDays: number, now: Date = new Date()) => {
  const days = Number.isInteger(rawDays) && rawDays > 0 ? Math.min(rawDays, 365) : 30;
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const dispatchWhere: Prisma.message_dispatchWhereInput = {
    kind: "GENERAL",
    status: { in: ["QUEUED", "SENT", "FAILED"] },
    created_at: { gte: since },
  };
  const [messagesSent, groups, smsRows] = await Promise.all([
    prisma.message_dispatch.count({ where: dispatchWhere }),
    prisma.message_recipient.groupBy({
      by: ["status"],
      where: { dispatch: dispatchWhere },
      _count: { _all: true },
    }),
    prisma.message_recipient.findMany({
      where: { dispatch: dispatchWhere, channel: "SMS", status: { in: ["SENT", "FAILED"] } },
      select: { rendered_body: true },
      take: MAX_SEGMENT_ROWS,
    }),
  ]);
  const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
  const delivered = count("SENT");
  const failed = count("FAILED");
  const smsSegmentsUsed = smsRows.reduce((sum, row) => sum + Math.max(1, smsSegments(row.rendered_body).segments), 0);
  return {
    days,
    messagesSent,
    delivered,
    failed,
    deliveryRate: delivered + failed ? Math.round((delivered * 1000) / (delivered + failed)) / 10 : null,
    smsSegmentsUsed,
  };
};

const assertValidId = (id: number) => {
  if (!Number.isInteger(id) || id <= 0) throw new NotFoundError("Message not found");
};

export const getDispatch = async (id: number) => {
  assertValidId(id);
  const d = await prisma.message_dispatch.findUnique({ where: { id } });
  if (!d) throw new NotFoundError("Message not found");
  return toDispatchDto(d);
};

export const listDispatchRecipients = async (id: number, query: any, access: MessagingAccess) => {
  assertValidId(id);
  await getDispatch(id);
  const page = Math.min(Math.max(Math.trunc(Number(query?.page)) || 1, 1), 10000);
  const limit = Math.min(Math.max(Math.trunc(Number(query?.limit)) || 50, 1), 200);
  const where: Prisma.message_recipientWhereInput = { dispatch_id: id };
  const ch = String(query?.channel ?? "");
  const st = String(query?.status ?? "");
  if (["SMS", "EMAIL", "IN_APP"].includes(ch)) where.channel = ch as Prisma.message_recipientWhereInput["channel"];
  if (["PENDING", "SENDING", "SENT", "FAILED", "SKIPPED"].includes(st)) where.status = st as Prisma.message_recipientWhereInput["status"];
  const [rows, total] = await Promise.all([
    prisma.message_recipient.findMany({
      where,
      orderBy: { id: "asc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, channel: true, recipient_name: true, address: true, status: true,
        error: true, attempts: true, sent_at: true, user_id: true, visitor_id: true,
      },
    }),
    prisma.message_recipient.count({ where }),
  ]);
  // Phone numbers and email addresses need view_recipient_contacts.
  const data = access.actions.view_recipient_contacts
    ? rows
    : rows.map((row) => ({ ...row, address: null }));
  return { data, ...pageMeta(page, limit, total) };
};

export const cancelDispatch = async (id: number, access: MessagingAccess) => {
  assertMessagingAction(access, "schedule");
  assertValidId(id);
  await getDispatch(id);
  const result = await prisma.message_dispatch.updateMany({
    where: { id, status: "SCHEDULED" },
    data: { status: "CANCELLED" },
  });
  if (result.count !== 1) throw new InputValidationError("Only scheduled messages can be cancelled");
  return getDispatch(id);
};

export const retryFailed = async (id: number, access: MessagingAccess) => {
  assertValidId(id);
  await getDispatch(id);
  // Only channels the caller may resend; failed SMS also needs retry_paid.
  const channels = retryableChannels(access);
  if (!channels.length) assertMessagingAction(access, "retry_paid");
  const [result] = await prisma.$transaction([
    prisma.message_recipient.updateMany({
      where: { dispatch_id: id, status: "FAILED", channel: { in: channels } },
      data: { status: "PENDING", attempts: 0, next_attempt_at: null, error: null },
    }),
    prisma.message_dispatch.updateMany({ where: { id, status: "SENT" }, data: { status: "QUEUED" } }),
  ]);
  if (result.count > 0) triggerDispatchProcessing();
  return { retried: result.count };
};

// ---------- preview, counts, stats, placeholders ----------

const SAMPLE: Person = {
  userId: null, visitorId: null, firstName: "Ama", lastName: "Mensah", title: null,
  email: null, phone: null, countryCode: null, dateOfBirth: new Date(Date.UTC(1990, 0, 1)),
};

export const preview = async (body: any) => {
  const kind: PlaceholderKind = ["WELCOME", "BIRTHDAY", "GENERAL"].includes(body?.kind) ? body.kind : "GENERAL";
  const settings = await getSettings();
  // Always the sample person: view-only admins must not be able to render a
  // real member's name or age by passing an id.
  const person = SAMPLE;
  const now = localParts(new Date(), settings.timezone);
  const ctx = {
    firstName: person.firstName,
    lastName: person.lastName,
    title: person.title,
    age: kind === "BIRTHDAY" && person.dateOfBirth ? ageOn(person.dateOfBirth, now.year) : null,
    ...linkSettings(settings),
  };
  const text = renderTemplate(withAppLink(String(body?.body ?? ""), body?.includeAppLink === true), ctx);
  return {
    body: text,
    subject: body?.subject ? renderTemplate(String(body.subject), ctx) : null,
    sms: smsSegments(text),
    unknownPlaceholders: findUnknownPlaceholders(String(body?.body ?? "") + " " + String(body?.subject ?? ""), kind),
  };
};

export const audienceCount = async (body: any, access: MessagingAccess) => {
  const { send_in_app, send_email, send_sms } = access.actions;
  if (!send_in_app && !send_email && !send_sms) assertMessagingAction(access, "send_in_app");
  const audience = parseAudience(body?.audience);
  await assertAudienceAllowed(access, audience);
  const people = await resolveAudience(audience);
  const seen = new Set<string>();
  const unique = people.filter((p) => {
    const key = p.userId ? `u:${p.userId}` : `v:${p.visitorId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    people: unique.length,
    sms: unique.filter((p) => p.phone?.trim()).length,
    email: unique.filter((p) => p.email?.trim()).length,
    inApp: unique.filter((p) => p.userId).length,
  };
};

export const templateStats = async (days: number) => {
  const since = new Date(Date.now() - Math.min(Math.max(days || 30, 1), 365) * 86_400_000);
  const dispatches = await prisma.message_dispatch.findMany({
    where: { template_key: { not: null }, created_at: { gte: since } },
    select: { id: true, template_key: true },
  });
  const keyOf = new Map(dispatches.map((d) => [d.id, d.template_key as TemplateKey]));
  const groups = dispatches.length
    ? await prisma.message_recipient.groupBy({
        by: ["dispatch_id", "status"],
        where: { dispatch_id: { in: dispatches.map((d) => d.id) } },
        _count: { _all: true },
      })
    : [];
  const stats = Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, { sent: 0, failed: 0, skipped: 0 }])) as Record<
    TemplateKey,
    { sent: number; failed: number; skipped: number }
  >;
  for (const g of groups) {
    const bucket = stats[keyOf.get(g.dispatch_id) as TemplateKey];
    if (!bucket) continue;
    if (g.status === "SENT") bucket.sent += g._count._all;
    if (g.status === "FAILED") bucket.failed += g._count._all;
    if (g.status === "SKIPPED") bucket.skipped += g._count._all;
  }
  return stats;
};

export const listPlaceholders = (kind: unknown) =>
  placeholdersFor(["WELCOME", "BIRTHDAY", "GENERAL"].includes(String(kind)) ? (String(kind) as PlaceholderKind) : "GENERAL");
