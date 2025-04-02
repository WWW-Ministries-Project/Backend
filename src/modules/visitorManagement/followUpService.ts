import { prisma } from "../../Models/context";

export class FollowUpService {
    
    async createFollowUp(data:any) {
        return await prisma.follow_up.create({ data });
    }

    async getAllFollowUps() {
        return await prisma.follow_up.findMany();
    }

    async getFollowUpById(id:number) {
        return await prisma.follow_up.findUnique({ where: { id } });
    }

    async updateFollowUp(id:number, data:any) {
        return await prisma.follow_up.update({ where: { id }, data });
    }

    async deleteFollowUp(id:number) {
        return await prisma.follow_up.delete({ where: { id } });
    }
}