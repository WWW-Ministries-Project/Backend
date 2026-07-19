import { PrismaClient, Prisma } from "@prisma/client";
import { promises as fs } from "fs";
import { uploadLocalFileToS3 } from "../../../utils";

const prisma = new PrismaClient();

export class RedemptionService {
  async create(
    body: any,
    file?: { path: string; originalname?: string; mimetype?: string },
    actorId?: number,
  ) {
    let image_url: string | null = null;
    if (file?.path) {
      const uploaded = await uploadLocalFileToS3({
        filePath: file.path,
        folder: "www-ministires/pledge-redemptions",
        originalName: file.originalname,
        contentType: file.mimetype,
        baseName: "redemption",
      });
      image_url = uploaded.url;
      await fs.unlink(file.path).catch(() => undefined);
    }
    return prisma.pledge_redemption.create({
      data: {
        pledger_id: Number(body.pledger_id),
        amount: new Prisma.Decimal(body.amount),
        date: new Date(body.date),
        method: body.method,
        note: body.note ?? null,
        image_url,
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
