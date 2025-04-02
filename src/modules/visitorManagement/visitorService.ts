import { prisma } from "../../Models/context";

export class VisitorService {
    async deleteVisitor(id: number) {
        return await prisma.visitor.delete({
            where: { id },
          });
    }
    async updateVisitor(id: number, body: any) {
        const visitor = await prisma.visitor.update({ 
            where: { id: id }, 
            data: body 
        });
        return visitor;
    }
    async getVisitorById(id: number) {
       return await prisma.visitor.findUnique({
        where:{id},
        include:{
            visits: true,
            notes: true,
            followUps: true,
            prayerRequests: true
        }
       })
    }
    async getAllVisitors() {
        const visitors = await prisma.visitor.findMany({
            include :{
                visits: true
            }
        });
        const visitorsWithVisitCount = visitors.map(({visits, ...visitor}) => ({
            ...visitor,
            visitCount: visits.length,
        }));
        return visitorsWithVisitCount;
    }
    async createVisitor(body: any) {
        const visitor = await prisma.visitor.create({ data: body });
        return visitor;
    }
}