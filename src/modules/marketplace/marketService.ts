import { prisma } from "../../Models/context";
import { copyS3ObjectByUrl } from "../../utils/s3";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../branches/branchService";
import { ProductService } from "../products/productService";
import {
  CreateMarketDto,
  DuplicateMarketDto,
  MarketDto,
  MarketFilters,
  MarketWithEvent,
  UpdateMarketDto,
} from "./marketInterface";

export class MarketService {
  /**
   * Create a new market
   */
  async createMarket(input: CreateMarketDto) {
    try {
      const market = await prisma.markets.create({
        data: {
          name: input.name.trim(),
          description: input.description?.trim() || undefined,
          start_date: input.start_date ? new Date(input.start_date) : undefined,
          end_date: input.end_date ? new Date(input.end_date) : undefined,
          branch_id: await resolveBranchIdOrDefault(input.branch_id),
          event_mgt_id: input.event_id,
        },
        include: { event: true },
      });
      return this.convertToDto(market);
    } catch (error: any) {
      throw new Error(`Failed to create market: ${error.message}`);
    }
  }

  /**
   * Duplicate a market: clones the market row plus all its non-deleted
   * products (with colours/stock/images). Orders/order_items are never
   * touched or copied.
   */
  async duplicateMarket(data: DuplicateMarketDto) {
    try {
      const sourceMarket = await prisma.markets.findFirst({
        where: { id: data.source_market_id, deleted: false },
      });
      if (!sourceMarket) {
        throw new Error(`Market with ID ${data.source_market_id} not found`);
      }

      // 1. Create the new market (mirrors createMarket)
      const newMarket = await prisma.markets.create({
        data: {
          name: data.name.trim(),
          description: data.description?.trim() || undefined,
          start_date: data.start_date ? new Date(data.start_date) : undefined,
          end_date: data.end_date ? new Date(data.end_date) : undefined,
          branch_id: await resolveBranchIdOrDefault(data.branch_id),
          event_mgt_id: data.event_id,
        },
        include: { event: true },
      });

      // 2. Fetch source market's products (with colours/stock already shaped by listProductsByMarketId)
      const productService = new ProductService();
      const sourceProducts = await productService.listProductsByMarketId(
        data.source_market_id,
      );

      // 3. Recreate each product on the new market, copying S3 images and preserving stock quantities
      let productsCount = 0;
      for (const sourceProduct of sourceProducts) {
        const copiedColours = await Promise.all(
          (sourceProduct.product_colours || []).map(async (c: any) => ({
            colour: c.colour,
            image_url: await this.copyProductImage(c.image_url),
            stock: c.stock, // [{ size, stock }] — copied as-is, quantities preserved
          })),
        );

        const { product } = await productService.createProduct({
          name: sourceProduct.name,
          description: sourceProduct.description ?? undefined,
          status: sourceProduct.status ?? undefined,
          stock_managed: sourceProduct.stock_managed,
          product_type_id:
            sourceProduct.product_type_id != null
              ? String(sourceProduct.product_type_id)
              : undefined,
          product_category_id:
            sourceProduct.product_category_id != null
              ? String(sourceProduct.product_category_id)
              : undefined,
          price_currency: sourceProduct.price_currency ?? undefined,
          price_amount:
            sourceProduct.price_amount != null
              ? String(sourceProduct.price_amount)
              : undefined,
          product_colours: copiedColours as any,
          market_id: String(newMarket.id),
        });

        // Top-level image_url/colours aren't set by constructProductData/createProduct (pre-existing
        // gap in that code path — only per-colour images are wired on create). Patch them in directly
        // so a duplicate is a faithful clone of whatever the source product actually has.
        if (sourceProduct.image_url || sourceProduct.colours) {
          await prisma.products.update({
            where: { id: product.id },
            data: {
              ...(sourceProduct.image_url
                ? { image_url: await this.copyProductImage(sourceProduct.image_url) }
                : {}),
              ...(sourceProduct.colours ? { colours: sourceProduct.colours } : {}),
            },
          });
        }

        productsCount++;
      }

      return {
        market: await this.convertToDto(newMarket),
        products_count: productsCount,
      };
    } catch (error: any) {
      throw new Error(`Failed to duplicate market: ${error.message}`);
    }
  }

  /**
   * Best-effort S3 duplicate of a product/colour image. Falls back to reusing the
   * original URL if it isn't hosted in our bucket, or if the copy call fails for
   * any reason (missing S3 config, transient AWS error, etc.) — a failed image
   * copy should never block the rest of the market duplication.
   */
  private async copyProductImage(
    imageUrl?: string | null,
  ): Promise<string | undefined> {
    if (!imageUrl) return imageUrl ?? undefined;
    try {
      return await copyS3ObjectByUrl(imageUrl, "products");
    } catch (error) {
      console.warn(
        `Failed to duplicate S3 image for ${imageUrl}, reusing original URL:`,
        error,
      );
      return imageUrl;
    }
  }

  /**
   * Get all markets with optional filtering
   */
  async getAllMarkets(filters?: MarketFilters) {
    try {
      const where: any = { deleted: filters?.deleted ?? false };

      if (filters?.name) {
        where.name = { contains: filters.name, mode: "insensitive" };
      }
      if (filters?.event_id) {
        where.event_mgt_id = filters.event_id;
      }
      Object.assign(where, getBranchScopedWhere(filters?.branch_id) || {});
      if (filters?.start_date) {
        where.start_date = { gte: filters.start_date };
      }
      if (filters?.end_date) {
        where.end_date = { lte: filters.end_date };
      }

      const markets = await prisma.markets.findMany({
        where,
        include: { event: true },
        take: filters?.take || undefined,
        skip: filters?.skip || undefined,
        orderBy: { created_at: "desc" },
      });

      return Promise.all(markets.map((m) => this.convertToDto(m)));
    } catch (error: any) {
      throw new Error(`Failed to fetch markets: ${error.message}`);
    }
  }

  /**
   * Get a single market by ID
   */
  async getMarketById(id: number) {
    try {
      const market = await prisma.markets.findFirst({
        where: { id, deleted: false },
        include: { event: true },
      });
      if (!market) throw new Error(`Market with ID ${id} not found`);
      return this.convertToDto(market);
    } catch (error: any) {
      throw new Error(`Failed to fetch market: ${error.message}`);
    }
  }

  /**
   * Update an existing market
   */
  async updateMarket(id: number, data: UpdateMarketDto) {
    try {
      const existingMarket = await prisma.markets.findFirst({
        where: { id, deleted: false },
      });
      if (!existingMarket) throw new Error(`Market with ID ${id} not found`);

      const market = await prisma.markets.update({
        where: { id },
        data: {
          name: data.name?.trim(),
          description: data.description?.trim(),
          event_mgt_id: data.event_id,
          start_date: data.start_date ? new Date(data.start_date) : undefined,
          end_date: data.end_date ? new Date(data.end_date) : undefined,
          ...(data.branch_id !== undefined
            ? {
                branch_id: await resolveBranchIdOrDefault(data.branch_id),
              }
            : {}),
          updated_at: new Date(),
        },
        include: { event: true },
      });

      return this.convertToDto(market);
    } catch (error: any) {
      throw new Error(`Failed to update market: ${error.message}`);
    }
  }

  /**
   * Soft delete a market
   */
  async deleteMarket(id: number, deleted_by_id?: number) {
    try {
      const existingMarket = await prisma.markets.findFirst({
        where: { id, deleted: false },
      });
      if (!existingMarket) throw new Error(`Market with ID ${id} not found`);

      const market = await prisma.markets.update({
        where: { id },
        data: {
          deleted: true,
          updated_at: new Date(),
          updated_at_id: deleted_by_id,
        },
        include: { event: true },
      });
      return this.convertToDto(market);
    } catch (error: any) {
      throw new Error(`Failed to delete market: ${error.message}`);
    }
  }

  /**
   * Restore a soft-deleted market
   */
  async restoreMarket(id: number, restored_by_id?: number) {
    try {
      const existingMarket = await prisma.markets.findFirst({
        where: { id, deleted: true },
      });
      if (!existingMarket)
        throw new Error(`Deleted market with ID ${id} not found`);

      const market = await prisma.markets.update({
        where: { id },
        data: {
          deleted: false,
          updated_at: new Date(),
          updated_at_id: restored_by_id,
        },
        include: { event: true },
      });
      return this.convertToDto(market);
    } catch (error: any) {
      throw new Error(`Failed to restore market: ${error.message}`);
    }
  }

  /**
   * Get markets by event
   */
  async getMarketsByEvent(event_id: number) {
    try {
      const markets = await prisma.markets.findMany({
        where: { event_mgt_id: event_id, deleted: false },
        include: { event: true },
        orderBy: { created_at: "desc" },
      });
      return markets.map((m) => this.convertToDto(m));
    } catch (error: any) {
      throw new Error(`Failed to fetch markets by event: ${error.message}`);
    }
  }

  /**
   * Get active markets
   */
  async getActiveMarkets() {
    try {
      const now = new Date();
      const markets = await prisma.markets.findMany({
        where: {
          deleted: false,
          OR: [
            { start_date: null, end_date: null },
            { start_date: { lte: now }, end_date: { gte: now } },
            { start_date: { lte: now }, end_date: null },
          ],
        },
        include: { event: true },
        orderBy: { created_at: "desc" },
      });
      return markets.map((m) => this.convertToDto(m));
    } catch (error: any) {
      throw new Error(`Failed to fetch active markets: ${error.message}`);
    }
  }

  /**
   * Get market count
   */
  async getMarketCount(filters?: MarketFilters) {
    try {
      const where: any = { deleted: filters?.deleted ?? false };
      if (filters?.name) {
        where.name = { contains: filters.name, mode: "insensitive" };
      }
      if (filters?.event_id) {
        where.event_mgt_id = filters.event_id;
      }
      return prisma.markets.count({ where });
    } catch (error: any) {
      throw new Error(`Failed to count markets: ${error.message}`);
    }
  }

  /**
   * Convert DB record to DTO
   */
  async convertToDto(data: MarketWithEvent): Promise<MarketDto> {
    const eventRecord = data.event?.event_name_id
      ? await prisma.event_act.findFirst({
          where: { id: data.event.event_name_id },
        })
      : null;

    return {
      id: data.id,
      name: data.name,
      description: data.description,
      start_date: data.start_date
        ? new Date(data.start_date).toISOString().split("T")[0]
        : undefined,
      end_date: data.end_date
        ? new Date(data.end_date).toISOString().split("T")[0]
        : undefined,
      event_id: data.event?.id,
      event_name: eventRecord?.event_name || "No Event",
      branch_id: data.branch_id ?? null,
    };
  }
}
