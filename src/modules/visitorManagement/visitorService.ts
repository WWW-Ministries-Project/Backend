import { prisma } from "../../Models/context";
import { UserService } from "../user/userService";

const userService = new UserService();

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
        where:{ id  },
        include:{
            visits:{
                include :{
                    event:{
                        select:{
                            event_type:true,
                            name: true,
                            id: true
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
            eventId: v.event?.id,
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
                visits: true,
                followUps : true
            }
        });

        const visitorsWithVisitCount = visitors.map(({visits,followUps, ...visitor}) => ({
            ...visitor,
            visitCount: visits.length,
            followUp: followUps[followUps.length - 1]?.status || "No Follow Ups Yet"
        }));
        return visitorsWithVisitCount;
    }
    async createVisitor(body: any) {
        const visitor = await prisma.visitor.create({ data: body });
        return visitor;
    }

    async changeVisitorStatusToMember(id: number) {
        const visitor = await this.getVisitorById(id);
        if (!visitor) throw new Error("Visitor not found");
      
        const {
          firstName,
          lastName,
          email,
          phone,
          country,
        } = visitor;
      
        // Split phone into country_code and number (if possible)
        const country_code = phone?.slice(0, 4) || ""; // adjust slicing if needed
        const primary_number = phone?.slice(4) || phone || "";
      
        const userData = {
          personal_info: {
            first_name: firstName,
            last_name: lastName,
            other_name: "",
            gender: null,
            date_of_birth: null,
            marital_status: null,
            nationality: country,
            has_children: false,
          },
          contact_info: {
            email: email || undefined,
            resident_country: country,
            phone: {
              country_code,
              number: primary_number,
            },
          },
          work_info: {},
          emergency_contact: {},
          church_info: {
            membership_type: "MEMBER",
            department_id: null,
            position_id: null,
            member_since: new Date(),
          },
          picture: {},
          children: [],
          status: "active",
          password: "123456", // default or auto-generated
          is_user: true,
        };
      
        // Register user using the data
        const newUser = await userService.registerUser(userData);
      
        await prisma.visitor.update({
          where: { id },
          data: {
            is_member: true, 
          },
        });
      
        return newUser;
      }
}