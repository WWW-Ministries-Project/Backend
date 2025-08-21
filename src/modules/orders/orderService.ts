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
    // Step 1: Create order + items + billing info in one go
    const order = await prisma.order.create({
      data: {
        user_id: data.user_id ?? null,
        market_id: data.market_id,
        total_amount: data.total_amount,
        items: {
          create: data.items.map((item) => ({
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
          })),
        },
        billing_details: {
          create: {
            first_name: data.billing.first_name,
            last_name: data.billing.last_name,
            email: data.billing.email,
            phone_number: data.billing.phone_number,
            country: data.billing.country,
            country_code: data.billing.country_code,
          },
        },
      },
      include: {
        items: true,
        billing_details: true,
      },
    });

    if (order) {
      //generate order number
      const orderNumber = this.generateOrderNumber(order.id);
      // Step 2: Verify with Paystack
      const response = await this.verifyPayment(data.reference);

      // Step 3: Update payment status + order number
      if (response.status === 200) {
        // Payment was successful
        //send email to user
        return await prisma.order.update({
          where: { id: order.id },
          data: {
            payment_status: "success",
            order_number: orderNumber,
          },
          include: { items: true, billing_details: true },
        });
      } else {
        return await prisma.order.update({
          where: { id: order.id },
          data: {
            payment_status: "failed",
            order_number: orderNumber,
          },
          include: { items: true, billing_details: true },
        });
      }
    }
  }

  // Find all orders
  async findAll() {
    return prisma.order.findMany({
      include: { items: true },
    });
  }

  // Find a specific order by ID
  async findOne(id: number) {
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) {
      throw new Error("Order not found");
    }

    return order;
  }

  async findByUserId(userId: number) {
    return await prisma.order.findMany({
      where: { user_id: userId },
      include: { items: true },
    });
  }

  async findOneByMarketplaceId(marketplaceId: number) {
    return await prisma.order.findMany({
      where: { market_id: marketplaceId },
      include: { items: true },
    });
  }

  async verifyPayment(reference: string) {
    return await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );
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
