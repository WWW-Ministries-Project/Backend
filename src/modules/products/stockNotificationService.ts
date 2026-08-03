import { prisma } from "../../Models/context";
import { notificationService } from "../notifications/notificationService";

export const stockNotificationService = {
  async recordRequest(
    userId: number,
    productId: number,
    productColourId: number,
    sizeId: number,
  ) {
    await prisma.stock_notification_requests.upsert({
      where: {
        stock_notification_requests_unique: {
          user_id: userId,
          product_colour_id: productColourId,
          size_id: sizeId,
        },
      },
      update: {},
      create: {
        user_id: userId,
        product_id: productId,
        product_colour_id: productColourId,
        size_id: sizeId,
      },
    });
  },

  async notifyBackInStock(productColourId: number, sizeId: number) {
    const requests = await prisma.stock_notification_requests.findMany({
      where: { product_colour_id: productColourId, size_id: sizeId },
      include: {
        product_colour: { include: { product: { select: { name: true } } } },
        size: { select: { name: true } },
      },
    });

    for (const request of requests) {
      await notificationService.createInAppNotification({
        type: "market.back_in_stock",
        title: "Back in stock",
        body: `${request.product_colour.product.name} (${request.product_colour.colour} / ${request.size.name}) is back in stock.`,
        recipientUserId: request.user_id,
        actorUserId: null,
        entityType: "PRODUCT",
        entityId: String(request.product_id),
        actionUrl: "/member/market",
        priority: "MEDIUM",
        dedupeKey: `stock-notify:${request.id}`,
        sendSms: true,
        smsBody: `${request.product_colour.product.name} (${request.size.name}) is back in stock at the WWM marketplace.`,
      });
    }

    await prisma.stock_notification_requests.deleteMany({
      where: { product_colour_id: productColourId, size_id: sizeId },
    });
  },
};
