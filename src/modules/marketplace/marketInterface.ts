import { Prisma } from "@prisma/client";

export interface CreateMarketDto {
  name: string;
  description?: string;
  event_id?: number;
  start_date?: Date;
  end_date?: Date;
  created_by_id?: number;
}

export interface UpdateMarketDto {
  name?: string;
  description?: string;
  event_id?: number;
  start_date?: Date;
  end_date?: Date;
  updated_at_id?: number;
}

export interface MarketFilters {
  name?: string;
  event_id?: number;
  deleted?: boolean;
  start_date?: Date;
  end_date?: Date;
  take?: number;
  skip?: number;
}

export interface MarketDto {
  name: string;
  description?: string | null;
  id: number;
  start_date?: string;
  end_date?: string;
  event_name?: string | null;
  event_id?: number | null;
}

const marketWithEvent = Prisma.validator<Prisma.marketsDefaultArgs>()({
  include: { event: true },
});

export type MarketWithEvent = Prisma.marketsGetPayload<typeof marketWithEvent>;
