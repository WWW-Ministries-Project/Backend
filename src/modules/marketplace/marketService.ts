import {prisma} from "../../Models/context";
import {CreateMarketDto, MarketDto, MarketFilters, MarketWithEvent, UpdateMarketDto} from "./marketInterface";

export class MarketService {
    /**
     * Create a new market
     */
    async createMarket(input: CreateMarketDto) {
        try {
            const event = this.determineEventId(input);
            return this.convertToDto(await prisma.markets.create({
                data: {
                    name: input.name.trim(),
                    description: input.description ?? undefined,
                    start_date: input.start_date ? new Date(input.start_date) : undefined,
                    end_date: input.end_date ? new Date(input?.end_date) : undefined,
                    event
                },
                include: {
                    event: true,
                },
            }));
        } catch (error: any) {
            throw new Error(`Failed to create market: ${error.message}`);
        }
    }

    private determineEventId(input: CreateMarketDto | UpdateMarketDto) {
        return (input.event_id ? {
            connect: {
                id: input.event_id
            }
        } : undefined);
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

            return (await prisma.markets.findMany({
                where,
                include: {
                    event: true,
                },
                take: filters?.take || undefined,
                skip: filters?.skip || undefined,
                orderBy: {
                    created_at: 'desc',
                },
            })).map(m => this.convertToDto(m));
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

            return this.convertToDto(await prisma.markets.update({
                where: {id},
                data: {
                    name: data.name?.trim(),
                    description: data.description?.trim(),
                    event: this.determineEventId(data),
                    start_date: data.start_date ? new Date(data.start_date) : undefined,
                    end_date: data.end_date ? new Date(data.end_date) : undefined,
                    updated_at: new Date(),
                },
                include: {
                    event: true,
                },
            }));
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

            return this.convertToDto(await prisma.markets.update({
                where: {id},
                data: {
                    deleted: true,
                    updated_at: new Date(),
                    updated_at_id: deleted_by_id,
                },
                include: {event: true}
            }));
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

            return this.convertToDto(await prisma.markets.update({
                where: {id},
                data: {
                    deleted: false,
                    updated_at: new Date(),
                    updated_at_id: restored_by_id,
                },
                include: {
                    event: true,
                },
            }));
        } catch (error: any) {
            throw new Error(`Failed to restore market: ${error.message}`);
        }
    }

    /**
     * Get markets by event
     */
    async getMarketsByEvent(event_name_id: number) {
        try {
            return (await prisma.markets.findMany({
                where: {
                    event_name_id,
                    deleted: false,
                },
                include: {
                    event: true,
                },
                orderBy: {
                    created_at: 'desc',
                },
            })).map(this.convertToDto);
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

            return (await prisma.markets.findMany({
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
            })).map(this.convertToDto);
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

    convertToDto(data: MarketWithEvent): MarketDto {
        const {name, description, id, start_date, end_date, event} = data;
        return {
            name,
            description,
            id,
            start_date: start_date ? new Date(start_date).toDateString() : undefined,
            end_date: end_date ? new Date(end_date).toDateString() : undefined,
            event_id: event?.id,
            event_name: event?.event_name
        }
    }
}