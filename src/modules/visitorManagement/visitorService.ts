import { prisma } from "../../Models/context";
import { UserService } from "../user/userService";
import { VisitService } from "./visitService";
import { toSentenceCase } from "../../utils";

const userService = new UserService();
const visitService = new VisitService();

export class VisitorService {
    async deleteVisitor(id: number) {
        return await prisma.visitor.delete({
            where: { id },
          });
    }
    async updateVisitor(id: number, body: any) {
      const {
        personal_info,
        contact_info,
        visit,
        consentToContact,
        membershipWish,
        event,
      } = body;
    
      const visitorData = {
        title: personal_info.title,
        firstName: toSentenceCase(personal_info.first_name),
        lastName: toSentenceCase(personal_info.last_name),
        otherName: toSentenceCase(personal_info.other_name),
        email: contact_info.email.toLowerCase(),
        phone: contact_info.phone?.number ?? null,
        country: contact_info.resident_country,
        address: contact_info.address,
        city: contact_info.city,
        state: contact_info.state_region,
        zipCode: null,
        visitDate: new Date(visit.date),
        howHeard: visit.howHeard,
        consentToContact: consentToContact === 'true' || consentToContact === true,
        membershipWish: membershipWish === 'true' || membershipWish === true,
        // is_member is not included here; optionally set it if needed
      };
    
      const updatedVisitor = await prisma.visitor.update({
        where: { id },
        data: visitorData,
      });
    
      return updatedVisitor;
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
      const {
        personal_info,
        contact_info,
        visit,
        consentToContact,
        membershipWish,
        eventId,
      } = body;
    
      const visitDate = new Date(visit.date);
      const email = contact_info.email;
    
      // Check if the visitor already exists
      const existingVisitor = await prisma.visitor.findUnique({
        where: { email },
      });
    
      if (existingVisitor) {
        const existingVisit = await prisma.visit.findFirst({
          where: {
            visitorId: existingVisitor.id,
            eventId,
            date: visitDate,
          },
        });
    
        if (existingVisit) {
          throw new Error("Visit has already been recorded for this Visitor and Event.");
        }
    
        const newVisit = await visitService.createVisit({
          visitorId: existingVisitor.id,
          date: visitDate,
          eventId,
        });
    
        return { visitor: existingVisitor, createdVisit: newVisit };
      }
    
      // Prepare new visitor data
      const newVisitorData = {
        title: personal_info.title,
        firstName: toSentenceCase(personal_info.first_name),
        lastName: toSentenceCase(personal_info.last_name),
        otherName: toSentenceCase(personal_info.other_name),
        email: contact_info.email.toLowerCase(),
        phone: contact_info.phone?.number ?? null,
        country: contact_info.resident_country,
        address: contact_info.address,
        city: contact_info.city,
        state: contact_info.state_region,
        zipCode: null,
        visitDate,
        howHeard: visit.howHeard,
        consentToContact: consentToContact === 'true' || consentToContact === true,
        membershipWish: membershipWish === 'true' || membershipWish === true,
        is_member: false,
      };
    
      const createdVisitor = await prisma.visitor.create({ data: newVisitorData });
    
      const newVisit = await visitService.createVisit({
        visitorId: createdVisitor.id,
        date: visitDate,
        eventId,
      });
    
      return { visitor: createdVisitor, createdVisit: newVisit };
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