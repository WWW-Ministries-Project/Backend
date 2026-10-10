/**
 * Outbox worker. Called by messagingDispatchCron every minute and nudged
 * right after an enqueue so welcome messages do not wait for the next tick.
 */
import { prisma } from "../../Models/context";
import { ChannelRow, PermanentError, sendByChannel } from "./channels";

export const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 200;
const STALE_CLAIM_MS = 10 * 60_000;
const DELAYS_MS = [60_000, 5 * 60_000];

/** Delay before the next try after `attempts` failures; null = give up. */
export const nextAttemptDelayMs = (attempts: number): number | null =>
  attempts >= MAX_ATTEMPTS ? null : DELAYS_MS[attempts - 1] ?? DELAYS_MS[DELAYS_MS.length - 1];

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

/** Recomputes cached counts; marks the dispatch SENT when nothing is open. */
export const refreshDispatch = async (dispatchId: number) => {
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
    data: {
      counts: { ...summary.counts, people: people.length },
      ...(summary.open === 0 ? { status: "SENT" } : {}),
    },
  });
};

const processRow = async (row: ChannelRow & { attempts: number }) => {
  try {
    const skipped = await sendByChannel(row);
    await prisma.message_recipient.update({
      where: { id: row.id },
      data: skipped
        ? { status: "SKIPPED", error: skipped, claimed_at: null }
        : { status: "SENT", sent_at: new Date(), error: null, claimed_at: null },
    });
  } catch (error: any) {
    const attempts = row.attempts + 1;
    const delay = error instanceof PermanentError ? null : nextAttemptDelayMs(attempts);
    await prisma.message_recipient.update({
      where: { id: row.id },
      data: {
        attempts,
        error: String(error?.message || error).slice(0, 1000),
        claimed_at: null,
        ...(delay === null
          ? { status: "FAILED" }
          : { status: "PENDING", next_attempt_at: new Date(Date.now() + delay) }),
      },
    });
  }
};

/** Claims and sends one batch. Returns the number of rows processed. */
export const processPendingRecipients = async (): Promise<number> => {
  const now = new Date();

  // Rows stuck in SENDING (crash mid-batch) go back to the queue.
  await prisma.message_recipient.updateMany({
    where: { status: "SENDING", claimed_at: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
    data: { status: "PENDING", claimed_at: null },
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

  const touched = new Set<number>();
  for (const row of candidates) {
    // Per-row claim: a second worker that read the same row gets count 0.
    const claim = await prisma.message_recipient.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: { status: "SENDING", claimed_at: new Date() },
    });
    if (claim.count !== 1) continue;
    await processRow(row);
    touched.add(row.dispatch_id);
  }

  for (const id of touched) await refreshDispatch(id);
  return candidates.length;
};

let running = false;

/** Fire-and-forget nudge after an enqueue. Never throws. */
export const triggerDispatchProcessing = () => {
  if (running) return;
  setImmediate(async () => {
    if (running) return;
    running = true;
    try {
      await processPendingRecipients();
    } catch (error) {
      console.error("[ERROR] Messaging dispatch nudge failed:", error);
    } finally {
      running = false;
    }
  });
};

export const isWorkerRunning = () => running;
export const setWorkerRunning = (value: boolean) => {
  running = value;
};
