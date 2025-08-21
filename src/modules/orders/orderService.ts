import { prisma } from "../../Models/context";
import axios from "axios";

export class OrderService {
  // Create a new order
  async create(data: {
    user_id?: number | null;
    market_id: number;
    total_amount: number;
    reference: string;
    billing: {
      first_name: string;
      last_name: string;
      email: string;
      phone_number: string;
      country: string;
      country_code: string;
    };
    items: {
      name: string;
      prduct_id: string;
      price_amount: number;
      price_currency: string;
      quantity: number;
      product_type: string;
      product_category: string;
      image_url: string;
      color: string;
      size: string;
    }[];
  }) {
    // Step 1: Create order + items + billing info
    const order = await prisma.order.create({
      data: {
        user_id: data.user_id ?? null,
        market_id: data.market_id,
        total_amount: data.total_amount,
        reference: data.reference,
        items: { create: this.buildItems(data.items) },
        billing_details: { create: this.buildBilling(data.billing) },
      },
      include: { items: true, billing_details: true },
    });

    if (!order) throw new Error("Order creation failed");

    const orderNumber = this.generateOrderNumber(order.id);

    // Step 2: Verify payment
    const response = await this.verifyPayment(data.reference);
    const status = response.status === 200 && response.data.data.status === "success"
      ? "success"
      : "failed";

    // Step 3: Update order
    return this.updateOrderPayment(order.id, orderNumber, status);
  }

  async findAll() {
    return prisma.order.findMany({ include: { items: true } });
  }

  async findOne(id: number) {
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) throw new Error("Order not found");
    return order;
  }

  async findByUserId(userId: number) {
    return prisma.order.findMany({
      where: { user_id: userId },
      include: { items: true },
    });
  }

  async findOneByMarketplaceId(marketplaceId: number) {
    return prisma.order.findMany({
      where: { market_id: marketplaceId },
      include: { items: true },
    });
  }

  private async verifyPayment(reference: string) {
    return axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );
  }

  async verifyPaymentStatus(order_number: string) {
    const order = await prisma.order.findFirst({
      where: { order_number },
      select: { reference: true, id: true, payment_status: true },
    });

    if (!order) return { message: "Order not found", order: null };
    if (!order.reference) return { message: "No payment reference found", order: null };
    if (order.payment_status === "success")
      return { message: "Payment already verified", order: null };

    const response = await this.verifyPayment(order.reference);
    const status = response.data.data.status === "success" ? "success" : "failed";

    const updatedOrder = await this.updateOrderPayment(order.id, order_number, status);

    return {
      message: `Payment verification ${status}`,
      order: updatedOrder,
    };
  }


  private async updateOrderPayment(orderId: number, orderNumber: string, status: "success" | "failed") {
    return prisma.order.update({
      where: { id: orderId },
      data: { payment_status: status, order_number: orderNumber },
      include: { items: true, billing_details: true },
    });
  }

  private buildItems(items: any[]) {
    return items.map((item) => ({
      name: item.name,
      prduct_id: item.prduct_id,
      price_amount: item.price_amount,
      price_currency: item.price_currency,
      quantity: item.quantity,
      product_type: item.product_type,
      product_category: item.product_category,
      image_url: item.image_url,
      color: item.color,
      size: item.size,
    }));
  }

  private buildBilling(billing: any) {
    return {
      first_name: billing.first_name,
      last_name: billing.last_name,
      email: billing.email,
      phone_number: billing.phone_number,
      country: billing.country,
      country_code: billing.country_code,
    };
  }

  private generateOrderNumber(orderId: number): string {
    const date = new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const paddedId = String(orderId).padStart(6, "0");

    return `ORD-${yyyy}${mm}${dd}-${paddedId}`;
  }
}
