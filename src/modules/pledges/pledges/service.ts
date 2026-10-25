import { Prisma } from "@prisma/client";
import { prisma } from "../../../Models/context";
import {
  createSubaccount,
  updateSubaccount,
} from "../../../libs/paystack/paystackSubaccount";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../../branches/branchService";
import { assertPledgeReachable, pledgeScopeWhere, type PledgeViewer } from "../pledgeAccess";
import { PledgeHttpError, type PledgeSettlementAccount } from "../common";
import { notificationService } from "../../notifications/notificationService";
import logger from "../../../utils/logger-config";

const REMIND_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const num = (d: Prisma.Decimal | null | undefined) => (d ? Number(d) : 0);

/**
 * Payments to a pledge are ROUTED, not split: the whole transaction lands in
 * the pledge's own settlement account, exactly as for a giving option. The
 * payer covers the Paystack fee via a grossed-up charge, so `bearer` here is a
 * stored default only - see paymentService.initialize for what is actually sent
 * per transaction.
 */
const ROUTING_PERCENTAGE_CHARGE = 100;
const ROUTING_BEARER = "subaccount";

/** The Paystack business name for a pledge's subaccount. */
const subaccountName = (title: string | null | undefined, eventId: number) =>
  (title && title.trim()) || `Pledge for event ${eventId}`;

const maskAccountNumber = (accountNumber: string): string =>
  `${"•".repeat(Math.max(accountNumber.length - 4, 0))}${accountNumber.slice(-4)}`;

/**
 * What a client needs to know about a pledge's settlement account without
 * seeing the account number itself. `can_be_paid_online` is the single flag the
 * member apps gate the Pay button on - a pledge whose subaccount drifted, or
 * that never had one, cannot take a payment and must not offer to.
 */
const settlementSummary = (p: {
  currency: string;
  account_type: string;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  subaccount_code: string | null;
  paystack_synced_at: Date | null;
}) => ({
  currency: p.currency,
  account_type: p.account_type,
  bank_name: p.bank_name,
  account_name: p.account_name,
  masked_account_number: p.account_number
    ? maskAccountNumber(p.account_number)
    : null,
  is_synced: p.paystack_synced_at !== null,
  can_be_paid_online: Boolean(p.subaccount_code) && p.paystack_synced_at !== null,
});

// Only the member fields the pledge screens use; never the whole user row
// (it carries the password hash and access fields).
const pledgeUserSelect = {
  select: { id: true, name: true, email: true, member_id: true, is_active: true },
} as const;

const pledgeInclude = {
  event: true,
  callers: { include: { user: pledgeUserSelect } },
  groups: { include: { pledgers: { include: { user: pledgeUserSelect, redemptions: true } } } },
} satisfies Prisma.pledgeInclude;

// Compute totals for a fully-included pledge row
const summarize = (p: any) => {
  let totalPledged = 0;
  let totalRedeemed = 0;
  for (const g of p.groups) {
    for (const pl of g.pledgers) {
      totalPledged += num(pl.pledged_amount);
      totalRedeemed += pl.redemptions.reduce(
        (s: number, r: any) => s + num(r.amount),
        0,
      );
    }
  }
  const percent = totalPledged > 0 ? Math.round((totalRedeemed / totalPledged) * 100) : 0;
  const status =
    totalPledged > 0 && totalRedeemed >= totalPledged ? "completed" : "in_progress";
  return { totalPledged, totalRedeemed, remaining: totalPledged - totalRedeemed, percent, status };
};

export class PledgeService {
  async create(
    payload: any,
    actorId?: number,
    account?: PledgeSettlementAccount,
  ) {
    const branch_id = await resolveBranchIdOrDefault(payload.branch_id);

    // Paystack first: a pledge whose subaccount was rejected cannot receive
    // money, so there is no point persisting it and telling the caller it saved.
    const subaccount = account
      ? await createSubaccount(
          {
            business_name: subaccountName(payload.title, Number(payload.event_id)),
            settlement_bank: account.settlement_bank,
            account_number: account.account_number,
            percentage_charge: ROUTING_PERCENTAGE_CHARGE,
          },
          branch_id,
        )
      : undefined;

    try {
      return await prisma.pledge.create({
      data: {
        branch_id,
        event_id: Number(payload.event_id),
        title: payload.title ?? null,
        target_amount:
          payload.target_amount != null ? new Prisma.Decimal(payload.target_amount) : null,
        deadline: payload.deadline ? new Date(payload.deadline) : null,
        created_by_user_id: actorId ?? null,
        ...(account && {
          currency: account.currency,
          account_type: account.account_type,
          settlement_bank: account.settlement_bank,
          bank_name: account.bank_name,
          account_number: account.account_number,
          account_name: account.account_name,
          subaccount_code: subaccount?.subaccount_code ?? null,
          percentage_charge: ROUTING_PERCENTAGE_CHARGE,
          bearer: ROUTING_BEARER,
          paystack_synced_at: new Date(),
        }),
        callers: {
          create: (payload.callers ?? []).map((c: any) => ({
            user_id: c.user_id ?? null,
            guest_name: c.guest_name ?? null,
            guest_phone: c.guest_phone ?? null,
          })),
        },
        groups: {
          create: (payload.groups ?? []).map((g: any) => ({
            called_amount: new Prisma.Decimal(g.called_amount),
            label: g.label ?? null,
            pledgers: {
              create: (g.pledgers ?? []).map((p: any) => ({
                user_id: p.user_id ?? null,
                guest_name: p.guest_name ?? null,
                guest_phone: p.guest_phone ?? null,
                pledged_amount: new Prisma.Decimal(p.pledged_amount ?? g.called_amount),
              })),
            },
          })),
        },
      },
        include: pledgeInclude,
      });
    } catch (error) {
      // Compensate: deactivate the subaccount we just created so it cannot
      // silently receive payments with no pledge behind it.
      if (subaccount) {
        await updateSubaccount(
          subaccount.subaccount_code,
          { active: false },
          branch_id,
        ).catch(() => undefined);
      }

      throw error;
    }
  }

  async list(branchId?: string | number, status?: string, viewer?: PledgeViewer) {
    const rows = await prisma.pledge.findMany({
      where: { ...getBranchScopedWhere(branchId), ...pledgeScopeWhere(viewer) },
      include: pledgeInclude,
      orderBy: { created_at: "desc" },
    });
    // Settled online payments with no ledger entry: the dashboard flags these
    // so finance can credit them to the pledger.
    const uncredited = rows.length
      ? await prisma.pledge_payment.groupBy({
          by: ["pledge_id"],
          where: {
            pledge_id: { in: rows.map((p) => p.id) },
            status: "success",
            redemption_id: null,
          },
          _count: { _all: true },
        })
      : [];
    const uncreditedBy = new Map(uncredited.map((u) => [u.pledge_id, u._count._all]));

    const mapped = rows.map((p) => {
      const pledgers = p.groups.flatMap((g) => g.pledgers);
      const withBalance = pledgers.filter(
        (pl) =>
          num(pl.pledged_amount) -
            pl.redemptions.reduce((sum: number, r: any) => sum + num(r.amount), 0) >
          0.0001,
      ).length;
      return {
        id: p.id,
        event: p.event,
        title: p.title,
        deadline: p.deadline,
        target_amount: p.target_amount === null ? null : num(p.target_amount),
        created_at: p.created_at,
        callers: p.callers,
        pledger_count: pledgers.length,
        pledgers_with_balance: withBalance,
        uncredited_payments: uncreditedBy.get(p.id) ?? 0,
        ...settlementSummary(p),
        ...summarize(p),
      };
    });
    return status ? mapped.filter((m) => m.status === status) : mapped;
  }

  async detail(id: number, viewer?: PledgeViewer) {
    const { isCaller } = await assertPledgeReachable(id, viewer);
    const p = await prisma.pledge.findUniqueOrThrow({
      where: { id },
      include: pledgeInclude,
    });
    // Pledgers' phone numbers and emails: the payer-details action, or the
    // pledge's own callers, who need them to make the calls.
    const showPayer = !viewer || viewer.payerDetails || isCaller;
    const payerUser = <T extends { email?: string | null } | null>(user: T): T =>
      user && !showPayer ? { ...user, email: null } : user;
    const pledgers = p.groups.flatMap((g) =>
      g.pledgers.map((pl) => {
        const redeemed = pl.redemptions.reduce((s: number, r: any) => s + num(r.amount), 0);
        return {
          id: pl.id,
          group_id: g.id,
          group_label: g.label,
          called_amount: num(g.called_amount),
          user: payerUser(pl.user),
          guest_name: pl.guest_name,
          guest_phone: showPayer ? pl.guest_phone : null,
          pledged_amount: num(pl.pledged_amount),
          redeemed,
          remaining: num(pl.pledged_amount) - redeemed,
          reminded_at: pl.reminded_at,
          redemptions: pl.redemptions,
        };
      }),
    );
    // account_number is dropped and replaced with a masked form: a pledge detail
    // is readable by anyone with view_pledges, and a full settlement account
    // number is not something that audience needs.
    const { account_number: _accountNumber, ...safe } = p;

    return {
      ...safe,
      groups: showPayer
        ? p.groups
        : p.groups.map((g) => ({
            ...g,
            pledgers: g.pledgers.map((pl) => ({
              ...pl,
              user: payerUser(pl.user),
              guest_phone: null,
            })),
          })),
      payer_details_hidden: !showPayer,
      callers: p.callers,
      pledgers,
      ...settlementSummary(p),
      ...summarize(p),
    };
  }

  async update(
    id: number,
    payload: any,
    account?: PledgeSettlementAccount,
    options: { manageCallers?: boolean } = {},
  ) {
    const existing = await prisma.pledge.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        title: true,
        event_id: true,
        branch_id: true,
        subaccount_code: true,
        callers: { select: { user_id: true, guest_name: true, guest_phone: true } },
      },
    });

    // Changing who calls pledgers is its own action (Pledges.manage_callers).
    if (Array.isArray(payload.callers) && options.manageCallers === false) {
      const key = (c: any) => `${c.user_id ?? ""}|${c.user_id ? "" : c.guest_name ?? ""}`;
      const before = existing.callers.map(key).sort().join(",");
      const after = payload.callers.map(key).sort().join(",");
      if (before !== after) {
        throw new PledgeHttpError(403, "You can't change this pledge's callers.");
      }
    }

    const branchId =
      payload.branch_id != null
        ? await resolveBranchIdOrDefault(payload.branch_id)
        : existing.branch_id;

    // Push to Paystack before touching the DB, so a rejected settlement account
    // is never persisted as though it had been accepted.
    let subaccountCode = existing.subaccount_code;

    if (account) {
      const input = {
        business_name: subaccountName(
          payload.title ?? existing.title,
          Number(payload.event_id ?? existing.event_id),
        ),
        settlement_bank: account.settlement_bank,
        account_number: account.account_number,
        percentage_charge: ROUTING_PERCENTAGE_CHARGE,
      };

      if (subaccountCode) {
        await updateSubaccount(subaccountCode, input, branchId);
      } else {
        // Self-heal: a pledge created before online payment existed, or one
        // whose subaccount was lost, gets a fresh one rather than staying
        // permanently unable to receive money.
        subaccountCode = (await createSubaccount(input, branchId)).subaccount_code;
      }
    }

    // Replace-in-place: update meta; replace callers, and replace groups only when provided
    // (replacing groups wipes pledgers + their redemptions, so the frontend must omit
    // `groups` on a meta/callers-only edit).
    return prisma.$transaction(async (tx) => {
      await tx.pledge.update({
        where: { id },
        data: {
          event_id: payload.event_id != null ? Number(payload.event_id) : undefined,
          title: payload.title ?? null,
          target_amount:
            payload.target_amount != null ? new Prisma.Decimal(payload.target_amount) : null,
          deadline: payload.deadline ? new Date(payload.deadline) : null,
          branch_id: payload.branch_id != null ? branchId : undefined,
          ...(account && {
            currency: account.currency,
            account_type: account.account_type,
            settlement_bank: account.settlement_bank,
            bank_name: account.bank_name,
            account_number: account.account_number,
            account_name: account.account_name,
            subaccount_code: subaccountCode,
            percentage_charge: ROUTING_PERCENTAGE_CHARGE,
            bearer: ROUTING_BEARER,
            paystack_synced_at: new Date(),
          }),
        },
      });
      if (Array.isArray(payload.callers)) {
        await tx.pledge_caller.deleteMany({ where: { pledge_id: id } });
        await tx.pledge_caller.createMany({
          data: payload.callers.map((c: any) => ({
            pledge_id: id,
            user_id: c.user_id ?? null,
            guest_name: c.guest_name ?? null,
            guest_phone: c.guest_phone ?? null,
          })),
        });
      }
      if (Array.isArray(payload.groups)) {
        const existingGroups = await tx.pledge_group.findMany({
          where: { pledge_id: id },
          select: { id: true },
        });
        await tx.pledge_group.deleteMany({
          where: { id: { in: existingGroups.map((e) => e.id) } },
        });
        for (const g of payload.groups) {
          await tx.pledge_group.create({
            data: {
              pledge_id: id,
              called_amount: new Prisma.Decimal(g.called_amount),
              label: g.label ?? null,
              pledgers: {
                create: (g.pledgers ?? []).map((p: any) => ({
                  user_id: p.user_id ?? null,
                  guest_name: p.guest_name ?? null,
                  guest_phone: p.guest_phone ?? null,
                  pledged_amount: new Prisma.Decimal(p.pledged_amount ?? g.called_amount),
                })),
              },
            },
          });
        }
      }
      return tx.pledge.findUniqueOrThrow({ where: { id }, include: pledgeInclude });
    });
  }

  async remove(id: number) {
    // pledge_payment.pledge_id is RESTRICT, so this delete would fail anyway -
    // but with an opaque foreign-key error. Checking first turns that into a
    // sentence that says why, and keeps the payment history intact either way.
    const paidCount = await prisma.pledge_payment.count({
      where: { pledge_id: id, status: "success" },
    });

    if (paidCount > 0) {
      throw new PledgeHttpError(
        409,
        "This pledge has received online payments and cannot be deleted",
      );
    }

    const existing = await prisma.pledge.findUnique({
      where: { id },
      select: { subaccount_code: true, branch_id: true },
    });

    // Nothing here can be paid into any more, so retire the subaccount too.
    // Paystack has no delete endpoint; active:false is the closest it offers,
    // and a failure must not block the local delete.
    if (existing?.subaccount_code) {
      await updateSubaccount(
        existing.subaccount_code,
        { active: false },
        existing.branch_id,
      ).catch(() => undefined);
    }

    // Payments that never succeeded still hold the RESTRICT, and there is no
    // ledger value in a pending or failed row for a pledge being deleted.
    await prisma.pledge_payment.deleteMany({ where: { pledge_id: id } });

    return prisma.pledge.delete({ where: { id } });
  }

  /**
   * Reminds pledgers with a balance: an in-app notification, email and push to
   * members. Guests have no account to reach, so they are counted and skipped.
   * Pass pledger_ids to remind specific people; otherwise everyone with a balance.
   */
  async remind(pledgeId: number, pledgerIds: number[] | undefined, actorUserId?: number) {
    const p = await prisma.pledge.findUnique({ where: { id: pledgeId }, include: pledgeInclude });
    if (!p) throw new PledgeHttpError(404, "Pledge not found");

    const wanted = pledgerIds?.length ? new Set(pledgerIds) : null;
    const targets = p.groups
      .flatMap((g) => g.pledgers)
      .filter((pl) => !wanted || wanted.has(pl.id))
      .map((pl) => ({
        pl,
        remaining:
          num(pl.pledged_amount) -
          pl.redemptions.reduce((sum: number, r: any) => sum + num(r.amount), 0),
      }))
      .filter((t) => t.remaining > 0.0001);

    // A bulk reminder skips anyone reminded in the last day; naming a pledger
    // explicitly always sends.
    const cutoff = Date.now() - REMIND_COOLDOWN_MS;
    const members = targets.filter((t) => t.pl.user_id);
    const due = wanted ? members : members.filter((t) => !t.pl.reminded_at || t.pl.reminded_at.getTime() < cutoff);
    const title = p.title || "your pledge";
    const sent: number[] = [];

    for (const { pl, remaining } of due) {
      const ok = await notificationService
        .createInAppNotification({
          type: "pledge.balance_reminder",
          title: "Pledge balance reminder",
          body: `You have ${p.currency} ${remaining.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} left on ${title}.${p.deadline ? ` Deadline ${p.deadline.toISOString().slice(0, 10)}.` : ""}`,
          recipientUserId: pl.user_id as number,
          actorUserId: actorUserId ?? null,
          entityType: "pledge",
          entityId: String(p.id),
          actionUrl: "/member/pledges",
          priority: "MEDIUM",
          sendEmail: true,
        })
        .then(() => true)
        .catch((error) => {
          logger.warn(
            `[pledge] reminder to pledger ${pl.id} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return false;
        });
      if (ok) sent.push(pl.id);
    }

    if (sent.length) {
      await prisma.pledger.updateMany({
        where: { id: { in: sent } },
        data: { reminded_at: new Date() },
      });
    }

    return {
      reminded: sent.length,
      skipped_guests: targets.length - members.length,
      skipped_recent: members.length - due.length,
      failed: due.length - sent.length,
      pledger_ids: sent,
    };
  }
}
