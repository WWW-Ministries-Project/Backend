import { PrismaClient, Prisma } from "@prisma/client";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../../branches/branchService";

const prisma = new PrismaClient();

const num = (d: Prisma.Decimal | null | undefined) => (d ? Number(d) : 0);

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
  async create(payload: any, actorId?: number) {
    const branch_id = await resolveBranchIdOrDefault(payload.branch_id);
    return prisma.pledge.create({
      data: {
        branch_id,
        event_id: Number(payload.event_id),
        title: payload.title ?? null,
        target_amount:
          payload.target_amount != null ? new Prisma.Decimal(payload.target_amount) : null,
        deadline: payload.deadline ? new Date(payload.deadline) : null,
        created_by_user_id: actorId ?? null,
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
    return { ...p, groups: p.groups, callers: p.callers, pledgers, ...summarize(p) };
  }

  async update(id: number, payload: any) {
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
          branch_id:
            payload.branch_id != null
              ? await resolveBranchIdOrDefault(payload.branch_id)
              : undefined,
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
        const existing = await tx.pledge_group.findMany({
          where: { pledge_id: id },
          select: { id: true },
        });
        await tx.pledge_group.deleteMany({ where: { id: { in: existing.map((e) => e.id) } } });
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
    return prisma.pledge.delete({ where: { id } });
  }
}
