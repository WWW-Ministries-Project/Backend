import {prisma} from "../../Models/context";
import {CreateMarketDto, MarketFilters, UpdateMarketDto} from "./marketInterface";

export class MarketService {
    /**
     * Create a new market
     */
    async createMarket(input: CreateMarketDto) {
        try {
            return await prisma.markets.create({
                data: {
                    ...input,
                    start_date: input.start_date ? new Date(input.start_date) : undefined,
                    end_date: input.end_date ? new Date(input?.end_date) : undefined,
                    event_act_id: input.event_id
                },
                include: {
                    event: true,
                },
            });
        } catch (error: any) {
            throw new Error(`Failed to create market: ${error.message}`);
        }
    }

    /**
     * Get all markets with optional filtering
     */
    async getAllMarkets(filters?: MarketFilters) {
        try {
            const where: any = {
                deleted: filters?.deleted ?? false,
            };

            if (filters?.name) {
                where.name = {
                    contains: filters.name,
                    mode: 'insensitive',
                };
            }

            if (filters?.event_id) {
                where.event_act_id = filters.event_id;
            }

            if (filters?.start_date) {
                where.start_date = {
                    gte: filters.start_date,
                };
            }

            if (filters?.end_date) {
                where.end_date = {
                    lte: filters.end_date,
                };
            }

            return await prisma.markets.findMany({
                where,
                include: {
                    event: true,
                },
                take: filters?.take || undefined,
                skip: filters?.skip || undefined,
                orderBy: {
                    created_at: 'desc',
                },
            });
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
                where: {
                    id,
                    deleted: false,
                },
                include: {
                    event: true,
                },
            });

            if (!market) {
                throw new Error(`Market with ID ${id} not found`);
            }

            return market;
        } catch (error: any) {
            throw new Error(`Failed to fetch market: ${error.message}`);
        }
    }

    /**
     * Update an existing market
     */
    async updateMarket(id: number, data: UpdateMarketDto) {
        try {
            // Check if market exists and is not deleted
            const existingMarket = await prisma.markets.findFirst({
                where: {
                    id,
                    deleted: false,
                },
            });

            if (!existingMarket) {
                throw new Error(`Market with ID ${id} not found`);
            }

            return await prisma.markets.update({
                where: {id},
                data: {
                    ...data,
                    event_act_id: data.event_id || undefined,
                    start_date: data.start_date ? new Date(data.start_date) : undefined,
                    end_date: data.end_date ? new Date(data.end_date) : undefined,
                    updated_at: new Date(),
                },
                include: {
                    event: true,
                },
            });
        } catch (error: any) {
            throw new Error(`Failed to update market: ${error.message}`);
        }
    }

    /**
     * Soft delete a market (set deleted = true)
     */
    async deleteMarket(id: number, deleted_by_id?: number) {
        try {
            const existingMarket = await prisma.markets.findFirst({
                where: {
                    id,
                    deleted: false,
                },
            });

            if (!existingMarket) {
                throw new Error(`Market with ID ${id} not found`);
            }

            return await prisma.markets.update({
                where: {id},
                data: {
                    deleted: true,
                    updated_at: new Date(),
                    updated_at_id: deleted_by_id,
                },
            });
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
                where: {
                    id,
                    deleted: true,
                },
            });

            if (!existingMarket) {
                throw new Error(`Deleted market with ID ${id} not found`);
            }

            return await prisma.markets.update({
                where: {id},
                data: {
                    deleted: false,
                    updated_at: new Date(),
                    updated_at_id: restored_by_id,
                },
                include: {
                    event: true,
                },
            });
        } catch (error: any) {
            throw new Error(`Failed to restore market: ${error.message}`);
        }
    }

    /**
     * Get markets by event
     */
    async getMarketsByEvent(event_act_id: number) {
        try {
            return await prisma.markets.findMany({
                where: {
                    event_act_id,
                    deleted: false,
                },
                include: {
                    event: true,
                },
                orderBy: {
                    created_at: 'desc',
                },
            });
        } catch (error: any) {
            throw new Error(`Failed to fetch markets by event: ${error.message}`);
        }
    }

    /**
     * Get active markets (within date range)
     */
    async getActiveMarkets() {
        try {
            const now = new Date();

            return await prisma.markets.findMany({
                where: {
                    deleted: false,
                    OR: [
                        {
                            start_date: null,
                            end_date: null,
                        },
                        {
                            start_date: {
                                lte: now,
                            },
                            end_date: {
                                gte: now,
                            },
                        },
                        {
                            start_date: {
                                lte: now,
                            },
                            end_date: null,
                        },
                    ],
                },
                include: {
                    event: true,
                },
                orderBy: {
                    created_at: 'desc',
                },
            });
        } catch (error: any) {
            throw new Error(`Failed to fetch active markets: ${error.message}`);
        }
    }

    /**
     * Get market count
     */
    async getMarketCount(filters?: MarketFilters) {
        try {
            const where: any = {
                deleted: filters?.deleted ?? false,
            };

            if (filters?.name) {
                where.name = {
                    contains: filters.name,
                    mode: 'insensitive',
                };
            }

            if (filters?.event_id) {
                where.event_act_id = filters.event_id;
            }

            return await prisma.markets.count({
                where,
            });
        } catch (error: any) {
            const {message} = error;
            throw new Error(`Failed to count markets: ${message}`);
        }
    }
}