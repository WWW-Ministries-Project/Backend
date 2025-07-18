import {MarketService} from './marketService';
import {Request, Response} from 'express'

const marketService = new MarketService();

export class MarketController {
    async createMarket(req: Request, res: Response) {
        try {
            const {name, description, event_act_id, start_date, end_date}
                = req.body;

            const market = await marketService.createMarket({
                name,
                description,
                event_act_id,
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
}