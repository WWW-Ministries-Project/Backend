import { prisma } from "../../Models/context";
import { UserService } from "../user/userService";
import { VisitService } from "./visitService";
import { toSentenceCase } from "../../utils";
import { startOfWeek, startOfMonth, startOfYear } from "date-fns";

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

    async getVisitorStats(timeframe:string){
    
        const startDate = await this.getStartDate(timeframe);
    
        const allVisits = await prisma.visit.findMany({
          include: { visitor: true, event: true },
          where: {
            createdAt:{
              gte: startDate == null ? new Date() : startDate
            }
          },
        });

        const totalVisitors = await prisma.visitor.count();

      // 3. First-time visitors in timeframe
      const newVisitorIds = new Set(allVisits.map(v => v.visitorId));
      const thisMonth = newVisitorIds.size;

      // 4. Returning visitors
      const allVisitorVisitCounts = await prisma.visit.groupBy({
        by: ['visitorId'],
        _count: true,
      });
      const returningVisitors = allVisitorVisitCounts.filter(v => v._count > 1).length;

      // 5. Converted to members
      const members = await prisma.visitor.count({
        where: { is_member: true },
      });
      const conversionRate = totalVisitors ? Math.round((members / totalVisitors) * 100) : 0;


      // 6. Breakdown by event
      const eventBreakdown = await prisma.visit.groupBy({
        by: ['eventId'],
        _count: true,
      });
      const byEvent: Record<string, number> = {};
      for (const e of eventBreakdown) {
        if (e.eventId == null) continue; 
        const event = await prisma.event_mgt.findUnique({ where: { id: e.eventId } });
        if (event) byEvent[event.name] = e._count;
      }

      // 7. Breakdown by source (howHeard)
      const sourceBreakdown = await prisma.visitor.groupBy({
        by: ['howHeard'],
        _count: true,
      });
      const bySource = Object.fromEntries(sourceBreakdown.map(s => [s.howHeard, s._count]));

      // 8. Follow-up status breakdown
      const followUpBreakdown = await prisma.follow_up.groupBy({
        by: ['status'],
        _count: true,
      });
      const followUpStatus = Object.fromEntries(followUpBreakdown.map(f => [f.status, f._count]));

      // 10. Trend data (past 6 months)
      const trendData = await this.getTrendData();

    // Final result
    return {
      total: totalVisitors,
      thisMonth,
      returningVisitors,
      conversionRate,
      byEvent,
      bySource,
      followUpStatus,
      trendData,
      
    };
}

private async getTrendData() {
  const now = new Date();
  const data = [];

  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const monthName = start.toLocaleString('default', { month: 'short' });

    const visits = await prisma.visit.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
      },
    });

    const visitorMap = new Map<number, number>();
    visits.forEach(v => {
      if (v.visitorId){
        visitorMap.set(v.visitorId, (visitorMap.get(v.visitorId) || 0) + 1);
      }
    });

    const newVisitors = Array.from(visitorMap.values()).filter(count => count === 1).length;
    const returningVisitors = Array.from(visitorMap.values()).filter(count => count > 1).length;

    data.push({
      month: monthName,
      visitors: visitorMap.size,
      newVisitors,
      returningVisitors,
    });
  }

  return data;
}



    private async getStartDate(timeframe:string) {
      console.log(timeframe)
      const now = new Date();
      switch (timeframe) {
        case 'week': return startOfWeek(now);
        case 'month': return startOfMonth(now);
        case 'quarter': return startOfMonth(now);
        case 'year': return startOfYear(now);
        default: return null;
      }


    } 
}