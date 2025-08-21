import { Request, Response } from "express";
import { OrderService } from "./orderService";

const orderService = new OrderService();

export class OrderController {
  // Create a new order
  async create(req: Request, res: Response) {
    try {
      const order = await orderService.create(req.body);
      return res.status(201).json({
        success: true,
        message: "Order created successfully",
        data: order,
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to create order",
      });
    }
  }

  // Get all orders
  async findAll(req: Request, res: Response) {
    try {
      const orders = await orderService.findAll();
      return res.status(200).json({
        success: true,
        data: orders,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch orders",
      });
    }
  }

  // Get order by ID
  async findOne(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const order = await orderService.findOne(Number(id));
      return res.status(200).json({
        success: true,
        data: order,
      });
    } catch (error: any) {
      return res.status(404).json({
        success: false,
        message: error.message || "Order not found",
      });
    }
  }

  // Get orders by User ID
  async findByUserId(req: Request, res: Response) {
    try {
      const userId = parseInt(req.query.user_id as string);
      const orders = await orderService.findByUserId(userId);
      return res.status(200).json({
        success: true,
        data: orders,
      });
    } catch (error: any) {
      return res.status(404).json({
        success: false,
        message: error.message || "No orders found for this user",
      });
    }
  }

  // Get orders by Marketplace ID
  async findByMarketplaceId(req: Request, res: Response) {
    try {
      const marketId = parseInt(req.query.market_id as string);
      const orders = await orderService.findOneByMarketplaceId(marketId);
      return res.status(200).json({
        success: true,
        data: orders,
      });
    } catch (error: any) {
      return res.status(404).json({
        success: false,
        message: error.message || "No orders found for this marketplace",
      });
    }
  }

  async verifyPayment(req: Request, res: Response) {
    try {
      const reference = req.query.reference as string;
      const order = await orderService.verifyPayment(reference);
      return res.status(200).json({
        success: true,
        data: order,
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        message: error.message || "Payment verification failed",
      });
    }
  }
}
