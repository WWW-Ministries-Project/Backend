import {MarketService} from './marketService';
import {Request, Response} from 'express'

const marketService = new MarketService();

export class MarketController {
    async createMarket(req: Request, res: Response) {
        try {
            const {name, description, event_id, start_date, end_date}
                = req.body;

            const market = await marketService.createMarket({
                name,
                description,
                event_id,
                start_date,
                end_date
            });
            return res
                .status(200)
                .json({message: "Market Created Successfully", data: market})
        } catch (error: any) {
            return res.status(500).json({message: "Failed to create market: " + error.message})
        }
    }

    async updateMarket(req: Request, res: Response) {
        try {
            const {id, name, description, event_id, start_date, end_date} = req.body;
            const market = await marketService.updateMarket(id, {
                name, description, event_id, start_date, end_date
            });
            return res
                .status(200)
                .json({message: "Market Updated Successfully", data: market})
        } catch (error: any) {
            return res.status(500).json({message: "Failed to create market: " + error.message})
        }
    }

    async deleteMarket(req: Request, res: Response) {
        try {
            const {id} = req.query;
            const market = await marketService.deleteMarket(Number(id));
            return res
                .status(200)
                .json({message: "Market Deleted Successfully", data: market})
        } catch (error: any) {
            return res.status(500).json({message: "Failed to delete market: " + error.message})
        }
    }

    async restoreMarket(req: Request, res: Response) {
        try {
            const {id} = req.body;
            const market = await marketService.restoreMarket(id);
            return res
                .status(200)
                .json({message: "Market Restored Successfully", data: market})
        } catch (error: any) {
            return res.status(500).json({message: "Failed to get markets: " + error.message})
        }
    }

    async listMarkets(req: Request, res: Response) {
        try {
            const markets = await marketService.getAllMarkets(req.body.filters);
            return res
                .status(200)
                .json({data: markets})
        } catch (error: any) {
            return res.status(500).json({message: "Failed to get markets: " + error.message})
        }
    }

    async listMarketsByEventId(req: Request, res: Response) {
        try {
            const {event_id} = req.body;
            const markets = await marketService.getMarketsByEvent(event_id);
            return res
                .status(200)
                .json({data: markets})
        } catch (error: any) {
            return res.status(500).json({message: "Failed to get markets: " + error.message})
        }
    }

    async getMarketCount(req: Request, res: Response) {
        try {
            const {filters} = req.body;
            const markets = await marketService.getMarketCount(filters);
            return res
                .status(200)
                .json({data: markets})
        } catch (error: any) {
            return res.status(500).json({message: "Failed to get markets: " + error.message})
        }
    }

    async getActiveMarkets(req: Request, res: Response) {
        try {
            const markets = await marketService.getActiveMarkets();
            return res
                .status(200)
                .json({data: markets})
        } catch (error: any) {
            return res.status(500).json({message: "Failed to get markets: " + error.message})
        }
    }

    async getMarketById(req: Request, res: Response) {
        try {
            const {id} = req.query;
            const market = await marketService.getMarketById(Number(id));
            return res
                .status(200)
                .json({data: market})
        } catch (error: any) {
            return res.status(500).json({message: "Failed to get markets: " + error.message})
        }
    }
}