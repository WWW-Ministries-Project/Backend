import { prisma } from "../../Models/context";


export class VisitService {
    
    async getVisitByVisitorId(id: number) {
        return prisma.visit.findMany({ where: { visitorId:id} });
    }

    async createVisit(data: { visitorId: number; date: Date; eventId:number | null, notes?: string }){
        return prisma.visit.create({ data });
      }
    
      async getAllVisits() {
        return prisma.visit.findMany();
      }
    
      async getVisitById(id: number) {
        return prisma.visit.findUnique({ where: { id } });
      }
    
      async updateVisit(id: number, data: { visitorId: number; date: Date; eventId:number, notes?: string }){
        return prisma.visit.update({ where: { id }, data });
      }
    
      async deleteVisit(id: number){
        return prisma.visit.delete({ where: { id } });
      }
   
}