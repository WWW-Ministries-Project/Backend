import { Request, Response } from "express";
import { VisitService } from "./visitService"

const visitService = new VisitService()

export class VisitController {
  
    async createVisit(req: Request, res: Response) {
        try {
          const data: {
            visitorId: number;
            date: Date;
            eventId: number;
            notes?: string;
          } = {
            visitorId: Number(req.body.visitorId),
            date: new Date(req.body.date),
            eventId: Number(req.body.eventId),
            notes: req.body.notes
          };
          
          const newVisit = await visitService.createVisit(data);
          return res.status(201).json({ message: "Visitor Added", data: newVisit });
        } catch (error:any) {
          return res.status(500).json({ message: "Error creating visit", error: error.message });
        }
      }
    
      async getAllVisits(req: Request, res: Response) {
        try {

          const programs = await visitService.getAllVisits();
          return res.status(200).json({ data: programs });
        } catch (error:any) {
          return res.status(500).json({ message: "Error fetching visitors", error: error.message });
        }
      }
    
      async getVisitById(req: Request, res: Response) {
        try {
          const { id } = req.query;
          
          const visitor = await visitService.getVisitById(Number(id));
          if (!visitor) return res.status(404).json({ message: "Visit not found" });
    
          return res.status(200).json({ data: visitor });
        } catch (error:any) {
          return res.status(500).json({ message: "Error fetching all visits", error: error.message });
        }
      }

      async getAllVisitsByVisitorsId(req: Request, res: Response) {
        try {
          const { id } = req.query;
          
          const visitor = await visitService.getVisitByVisitorId(Number(id));
          if (!visitor) return res.status(404).json({ message: "Visitor not found" });
    
          return res.status(200).json({ data: visitor });
        } catch (error:any) {
          return res.status(500).json({ message: "Error fetching all visits", error: error.message });
        }
      }
    
      async updateVisit(req: Request, res: Response) {
        try {
          const { id } = req.query;
          const data: {
            visitorId: number;
            date: Date;
            eventId: number;
            notes?: string;
          } = {
            visitorId: Number(req.body.visitorId),
            date: new Date(req.body.date),
            eventId: Number(req.body.eventId),
            notes: req.body.notes
          };
          const updatedVisit = await visitService.updateVisit(Number(id), data);
          return res.status(200).json({ message: "Visit updated", data: updatedVisit });
        } catch (error:any) {
          return res.status(500).json({ message: "Error updating visit", error: error.message });
        }
      }
    
      async deleteVisits(req: Request, res: Response) {
        try {
          const { id } = req.query;
          await visitService.deleteVisit(Number(id));
          return res.status(200).json({ message: "Visit deleted successfully" });
        } catch (error:any) {
          return res.status(500).json({ message: "Error deleting visit", error: error.message });
        }
      }
    }