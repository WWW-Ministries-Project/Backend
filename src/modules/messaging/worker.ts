/**
 * Outbox worker. messagingDispatchCron runs it every minute, as
 * `runExclusive(async () => { await promoteDueDispatches(); await processPendingRecipients(); })`,
 * and triggerDispatchProcessing nudges it right after an enqueue so welcome
 * messages do not wait for the next tick.
 *
 * Delivery is at-most-once. A row is claimed (PENDING -> SENDING) before its
 * send and its outcome is written after. If the process dies in between, the
 * row stays SENDING; once the claim is stale the message may or may not be
 * out, so the row is marked FAILED rather than resent. An admin can resend it
 * with "Retry failed". Only sends that reported an error are retried here.
 */
import { prisma } from "../../Models/context";
import { ChannelRow, PermanentError, sendByChannel } from "./channels";

export const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 200;
/** Must comfortably exceed the slowest send so a live claim is never reset. */
const STALE_CLAIM_MS = 30 * 60_000;
/**
 * A QUEUED dispatch with nothing open, untouched for this long, is swept to
 * SENT. Recipient rows are inserted in their own transaction after the
 * dispatch row is created, so a dispatch briefly looks idle before its rows
 * are visible. 10 minutes leaves a slow insert ample room before the sweep
 * could close the dispatch over rows it cannot see yet.
 */
const IDLE_DISPATCH_MS = 10 * 60_000;
const INTERRUPTED_ERROR = "Delivery outcome unknown (interrupted). Use Retry failed to resend.";
const MAX_RERUNS = 5;
const PERSIST_RETRIES = 3;
const DELAYS_MS = [60_000, 5 * 60_000];

/** Delay before the next try after `attempts` failures; null = give up. */
export const nextAttemptDelayMs = (attempts: number): number | null =>
  attempts >= MAX_ATTEMPTS
    ? null
    : attempts < 1
      ? DELAYS_MS[0]
      : DELAYS_MS[attempts - 1] ?? DELAYS_MS[DELAYS_MS.length - 1];

type ChannelCounts = { sent: number; failed: number; skipped: number; pending: number };
const empty = (): ChannelCounts => ({ sent: 0, failed: 0, skipped: 0, pending: 0 });
const CHANNEL_KEY = { SMS: "sms", EMAIL: "email", IN_APP: "inApp" } as const;

export const summarize = (
  groups: { channel: "SMS" | "EMAIL" | "IN_APP"; status: string; _count: { _all: number } }[],
) => {
  const counts = { sms: empty(), email: empty(), inApp: empty() };
  let open = 0;
  for (const g of groups) {
    const bucket = counts[CHANNEL_KEY[g.channel]];
    const n = g._count._all;
    if (g.status === "SENT") bucket.sent += n;
    else if (g.status === "FAILED") bucket.failed += n;
    else if (g.status === "SKIPPED") bucket.skipped += n;
    else {
      bucket.pending += n;
      open += n;
    }
  }
  return { counts, open };
};

const OPEN_STATUSES = ["PENDING", "SENDING"] as const;

/**
 * Recomputes cached counts, then marks the dispatch SENT only if, at write
 * time, no recipient is still open. The status flip never trusts the
 * groupBy read above it, so a concurrent claim cannot be closed over.
 */
const writeCounts = async (dispatchId: number) => {
  const groups = await prisma.message_recipient.groupBy({
    by: ["channel", "status"],
    where: { dispatch_id: dispatchId },
    _count: { _all: true },
  });
  const people = await prisma.message_recipient.groupBy({
    by: ["recipient_key"],
    where: { dispatch_id: dispatchId },
  });
  const summary = summarize(groups);
  await prisma.message_dispatch.updateMany({
    where: { id: dispatchId, status: { in: ["QUEUED", "SENT"] } },
    data: { counts: { ...summary.counts, people: people.length } },
  });
};

export const refreshDispatch = async (dispatchId: number) => {
  await writeCounts(dispatchId);
  const flipped = await prisma.message_dispatch.updateMany({
    where: {
      id: dispatchId,
      status: "QUEUED",
      recipients: { none: { status: { in: [...OPEN_STATUSES] } } },
    },
    data: { status: "SENT" },
  });
  // Rows may have closed between the first count and the flip; recount once
  // so a SENT dispatch never keeps stale counts.
  if (flipped.count === 1) await writeCounts(dispatchId);
};

export type SendOutcome =
  | { kind: "sent" }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; error: string; permanent: boolean };

/** The recipient update for an outcome. `attempts` is the row's count before this try. */
export const outcomeData = (outcome: SendOutcome, attempts: number, now: Date) => {
  if (outcome.kind === "skipped") {
    return { status: "SKIPPED" as const, error: outcome.reason, claimed_at: null };
  }
  if (outcome.kind === "sent") {
    return { status: "SENT" as const, sent_at: now, error: null, claimed_at: null };
  }
  const next = attempts + 1;
  const delay = outcome.permanent ? null : nextAttemptDelayMs(next);
  return {
    attempts: next,
    error: outcome.error,
    claimed_at: null,
    ...(delay === null
      ? { status: "FAILED" as const }
      : { status: "PENDING" as const, next_attempt_at: new Date(now.getTime() + delay) }),
  };
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const send = async (row: ChannelRow): Promise<SendOutcome> => {
  try {
    const skipped = await sendByChannel(row);
    return skipped ? { kind: "skipped", reason: skipped } : { kind: "sent" };
  } catch (error: any) {
    return {
      kind: "failed",
      error: String(error?.message || error).slice(0, 1000),
      permanent: error instanceof PermanentError,
    };
  }
};

/**
 * Writes the outcome guarded by the claim token. A DB error here is retried,
 * never turned into a send failure: the message may already be out.
 */
const recordOutcome = async (
  row: ChannelRow & { attempts: number },
  claimedAt: Date,
  outcome: SendOutcome,
) => {
  const data = outcomeData(outcome, row.attempts, new Date());
  for (let attempt = 0; attempt <= PERSIST_RETRIES; attempt++) {
    if (attempt > 0) await wait(200 * attempt);
    try {
      const result = await prisma.message_recipient.updateMany({
        where: { id: row.id, status: "SENDING", claimed_at: claimedAt },
        data,
      });
      if (result.count === 0) {
        console.warn(
          `[WARN] Messaging: claim on recipient ${row.id} was reset before its outcome was recorded; leaving it as is`,
        );
      }
      return;
    } catch (error) {
      if (attempt === PERSIST_RETRIES) {
        console.error(
          `[ERROR] Messaging: sent but could not record outcome for recipient ${row.id}`,
          error,
        );
      }
    }
  }
};

const processRow = async (row: ChannelRow & { attempts: number }, claimedAt: Date) => {
  const outcome = await send(row);
  await recordOutcome(row, claimedAt, outcome);
};

/** Claims and sends one batch. Returns the number of rows processed. */
export const processPendingRecipients = async (): Promise<number> => {
  const now = new Date();

  // QUEUED dispatches with nothing left open (e.g. their last refresh failed)
  // would never be touched again by the claim loop below.
  const idle = await prisma.message_dispatch.findMany({
    where: {
      status: "QUEUED",
      recipients: { none: { status: { in: [...OPEN_STATUSES] } } },
      updated_at: { lt: new Date(now.getTime() - IDLE_DISPATCH_MS) },
    },
    select: { id: true },
    orderBy: { updated_at: "asc" },
    take: 50,
  });
  for (const { id } of idle) {
    try {
      await refreshDispatch(id);
    } catch (error) {
      console.error(`[ERROR] Messaging: could not refresh idle dispatch ${id}:`, error);
    }
  }

  // Rows stuck in SENDING (crash mid-send) are ambiguous: the message may
  // already be out. At-most-once: fail them instead of resending.
  const staleWhere = {
    status: "SENDING" as const,
    claimed_at: { lt: new Date(now.getTime() - STALE_CLAIM_MS) },
  };
  const stale = await prisma.message_recipient.findMany({
    where: staleWhere,
    select: { dispatch_id: true },
    distinct: ["dispatch_id"],
  });
  await prisma.message_recipient.updateMany({
    where: staleWhere,
    data: { status: "FAILED", claimed_at: null, error: INTERRUPTED_ERROR },
  });

  const candidates = await prisma.message_recipient.findMany({
    where: {
      status: "PENDING",
      OR: [{ next_attempt_at: null }, { next_attempt_at: { lte: now } }],
      dispatch: { status: "QUEUED" },
    },
    orderBy: { id: "asc" },
    take: BATCH_SIZE,
  });

  // Dispatches whose stale rows just failed get fresh counts this pass.
  const touched = new Set<number>(stale.map((r) => r.dispatch_id));
  try {
    for (const row of candidates) {
      try {
        // Per-row claim: a second worker that read the same row gets count 0.
        // `attempts` in the guard rejects a row whose count moved since the read.
        const claimedAt = new Date();
        const claim = await prisma.message_recipient.updateMany({
          where: { id: row.id, status: "PENDING", attempts: row.attempts },
          data: { status: "SENDING", claimed_at: claimedAt },
        });
        if (claim.count !== 1) continue;
        touched.add(row.dispatch_id);
        await processRow(row, claimedAt);
      } catch (error) {
        console.error(`[ERROR] Messaging: failed processing recipient ${row.id}:`, error);
      }
    }
  } finally {
    for (const id of touched) {
      try {
        await refreshDispatch(id);
      } catch (error) {
        console.error(`[ERROR] Messaging: could not refresh dispatch ${id}:`, error);
      }
    }
  }
  return candidates.length;
};

let running = false;
/** Set when a run was refused because another was in flight. */
let rerunRequested = false;

/** Returns whether a rerun was requested since the last call, and clears it. */
export const consumeRerunRequest = (): boolean => {
  const requested = rerunRequested;
  rerunRequested = false;
  return requested;
};

/**
 * Runs `fn` unless a run is already in flight. Returns whether it ran. A
 * refused call records a rerun request so its work is not dropped.
 */
export const runExclusive = async (fn: () => Promise<void>): Promise<boolean> => {
  if (running) {
    rerunRequested = true;
    return false;
  }
  running = true;
  try {
    await fn();
  } finally {
    running = false;
  }
  return true;
};

/** Fire-and-forget nudge after an enqueue. Never throws. */
export const triggerDispatchProcessing = () => {
  setImmediate(() => {
    runExclusive(async () => {
      // Rows enqueued while this run was busy may have been read too late;
      // a nudge refused meanwhile asks for another pass (capped).
      consumeRerunRequest();
      for (let loop = 0; loop < MAX_RERUNS; loop++) {
        await processPendingRecipients();
        if (!consumeRerunRequest()) break;
      }
    }).catch((error) => {
      console.error("[ERROR] Messaging dispatch nudge failed:", error);
    });
  });
};
