import { PrismaClient, Prisma } from "@prisma/client";
import {
  createSubaccount,
  updateSubaccount,
} from "../../../libs/paystack/paystackSubaccount";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../../branches/branchService";
import { PledgeHttpError, type PledgeSettlementAccount } from "../common";

const prisma = new PrismaClient();

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

const pledgeInclude = {
  event: true,
  callers: { include: { user: true } },
  groups: { include: { pledgers: { include: { user: true, redemptions: true } } } },
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

  async list(branchId?: string | number, status?: string) {
    const rows = await prisma.pledge.findMany({
      where: getBranchScopedWhere(branchId),
      include: pledgeInclude,
      orderBy: { created_at: "desc" },
    });
    const mapped = rows.map((p) => ({
      id: p.id,
      event: p.event,
      title: p.title,
      deadline: p.deadline,
      callers: p.callers,
      ...settlementSummary(p),
      ...summarize(p),
    }));
    return status ? mapped.filter((m) => m.status === status) : mapped;
  }

  async detail(id: number) {
    const p = await prisma.pledge.findUniqueOrThrow({
      where: { id },
      include: pledgeInclude,
    });
    const pledgers = p.groups.flatMap((g) =>
      g.pledgers.map((pl) => {
        const redeemed = pl.redemptions.reduce((s: number, r: any) => s + num(r.amount), 0);
        return {
          id: pl.id,
          group_id: g.id,
          group_label: g.label,
          called_amount: num(g.called_amount),
          user: pl.user,
          guest_name: pl.guest_name,
          guest_phone: pl.guest_phone,
          pledged_amount: num(pl.pledged_amount),
          redeemed,
          remaining: num(pl.pledged_amount) - redeemed,
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
      groups: p.groups,
      callers: p.callers,
      pledgers,
      ...settlementSummary(p),
      ...summarize(p),
    };
  }

  async update(id: number, payload: any, account?: PledgeSettlementAccount) {
    const existing = await prisma.pledge.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        title: true,
        event_id: true,
        branch_id: true,
        subaccount_code: true,
      },
    });

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
}
