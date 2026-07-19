import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

export class RedemptionService {
  async create(body: any, actorId?: number) {
    return prisma.pledge_redemption.create({
      data: {
        pledger_id: Number(body.pledger_id),
        amount: new Prisma.Decimal(body.amount),
        date: new Date(body.date),
        method: body.method,
        note: body.note ?? null,
        image_url: body.image_url ?? null,
        recorded_by_user_id: actorId ?? null,
      },
    });
  }

  async remove(id: number) {
    return prisma.pledge_redemption.delete({ where: { id } });
  }

  async addPledgers(groupId: number, pledgers: any[]) {
    const group = await prisma.pledge_group.findUniqueOrThrow({ where: { id: groupId } });
    return prisma.pledger.createMany({
      data: pledgers.map((p) => ({
        group_id: groupId,
        user_id: p.user_id ?? null,
        guest_name: p.guest_name ?? null,
        guest_phone: p.guest_phone ?? null,
        pledged_amount: new Prisma.Decimal(p.pledged_amount ?? group.called_amount),
      })),
    });
  }

  async removePledger(id: number) {
    return prisma.pledger.delete({ where: { id } });
  }
}
