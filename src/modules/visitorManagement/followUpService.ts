import { prisma } from "../../Models/context";

export class FollowUpService {
    
    async createFollowUp(data:any) {

        const followUpData = {
            visitorId  : data.visitorId,
            date: new Date(data.date),
            type: (data.type),
            status: data.status || "pending",
            notes:     data.notes,
            assignedTo: data.assigned_to
  
        } 
        return await prisma.follow_up.create({ data:followUpData });
    }

    async getAllFollowUps() {
        return await prisma.follow_up.findMany();
    }

    async getFollowUpById(id:number) {
        let assigned_to: number | null = null;
        let user = null;

        const followup = await prisma.follow_up.findUnique({ where: { id } });

        if (!followup) return null;
        if (followup.assignedTo) {
            const userData = await prisma.user.findUnique({
                where: { id: followup.assignedTo },
                select: {
                    id: true,
                    name: true,
                    user_info: {
                        select: {
                            first_name: true,
                            last_name: true
                        }
                    }
                }
            });
            if (userData) {
                user = {
                    id: userData.id,
                    name: userData.name,
                    first_name: userData.user_info?.first_name || null,
                    last_name: userData.user_info?.last_name || null
                };
            }
        }

        return { followup, assignedTo: user };
    }

    async updateFollowUp(id:number, data:any) {
        const followUpData = {
            visitorId  : data.visitorId,
            date: new Date(data.date),
            type: (data.type),
            status: data.status || "pending",
            notes:     data.notes,
            assignedTo: data.assigned_to
  
        } 
        return await prisma.follow_up.update({ where: { id }, data:followUpData, });
    }

    async deleteFollowUp(id:number) {
        return await prisma.follow_up.delete({ where: { id } });
    }
}