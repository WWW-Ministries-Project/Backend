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
       const visitor =  await prisma.visitor.findUnique({
        where:{id},
        include:{
            visits:{
                include :{
                    event:{
                        select:{
                            event_type:true,
                            name: true
                        }
                    }
                }
            },
            notes: true,
            followUps: true,
            prayerRequests: true
        }
       })
       if (!visitor) return null

       return {
        ...visitor,
        visits: visitor.visits.map(v => ({
            id: v.id,
            visitorId: v.visitorId,
            date: v.date,
            eventName: v.event?.name || null,
            eventType: v.event?.event_type,
            notes: v.notes,
            createdAt: v.createdAt,
            updatedAt: v.updatedAt
        }))
    };
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