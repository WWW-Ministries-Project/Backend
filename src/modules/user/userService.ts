import { prisma } from "../../Models/context";
import {
  toCapitalizeEachWord,
  hashPassword,
} from "../../utils";
import axios from 'axios';

export class UserService {

   async registerUser(userData: any) {
    const {
      personal_info: {
        title,
        first_name,
        other_name,
        last_name,
        date_of_birth,
        gender,
        marital_status,
        nationality,
        has_children,
      } = {},

      picture = {},

      contact_info: {
        email,
        resident_country,
        phone: { country_code, number: primary_number } = {},
      } = {},

      work_info: {
        employment_status,
        work_name,
        work_industry,
        work_position,
        school_name,
      } = {},

      emergency_contact: {
        name: emergency_contact_name,
        relation: emergency_contact_relation,
        phone: { country_code: emergency_country_code, number: emergency_phone_number } = {},
      } = {},

      church_info: { membership_type, department_id, position_id, member_since } = {},

      children = [],
      status,
      password,
      is_user,
    } = userData;

      // Generate email if not provided
      let userEmail = email?.trim() || `${first_name.toLowerCase()}${last_name.toLowerCase()}_${Date.now()}@temp.com`;

      // Hash password if the user needs an account
      const hashedPassword = is_user ? await hashPassword(password || "123456") : undefined;
      const emergency_phone = `${emergency_country_code}${emergency_phone_number}`;

      const departmentId = isNaN(parseInt(department_id)) || parseInt(department_id) === 0 ? null : parseInt(department_id);

      // Create user in database
      const user = await prisma.user.create({
        data: {
          name: toCapitalizeEachWord(`${first_name} ${other_name || ""} ${last_name}`.trim()),
          email: userEmail,
          password: hashedPassword,
          is_user,
          status,
          department_id:departmentId,
          position_id,
          membership_type,
          user_info: {
            create: {
              title,
              first_name,
              last_name,
              other_name,
              date_of_birth: date_of_birth ? new Date(date_of_birth) : null,
              gender,
              marital_status,
              nationality,
              photo: picture?.src || "",
              primary_number,
              country_code,
              member_since: member_since ? new Date(member_since) : null,
              email,
              country: resident_country,
              emergency_contact: {
                create: {
                  name: emergency_contact_name,
                  relation: emergency_contact_relation,
                  phone_number: emergency_phone,
                },
              },
              work_info: {
                create: {
                  employment_status,
                  name_of_institution: work_name,
                  industry: work_industry,
                  position: work_position,
                  school_name,
                },
              },
            },
          },
        },
      });

      
      const savedUser = await this.generateUserId(user).catch((err) => console.error("Error generating user ID:", err));

      if (has_children && children.length > 0) {
       await this.registerChildren(children, savedUser, membership_type)
      }

      return savedUser;

  }

   async registerChildren(children: any[], parentObj: any, membership_type: any) {
    await Promise.all(
      children.map(async (child) => {
        try {
          const childUser = await prisma.user.create({
            data: {
              name: toCapitalizeEachWord(`${child.first_name} ${child.other_name || ""} ${child.last_name}`.trim()),
              email: `${child.first_name.toLowerCase()}_${child.last_name.toLowerCase()}_${Date.now()}@temp.com`,
              is_user: false,
              parent_id: parentObj.id,
              membership_type,
              user_info: {
                create: {
                  first_name: child.first_name,
                  last_name: child.last_name,
                  other_name: child.other_name || null,
                  date_of_birth: new Date(child.date_of_birth),
                  gender: child.gender,
                  marital_status: child.marital_status,
                  nationality: child.nationality,
                },
              },
            },
          });

          // Generate User ID for each child
          this.generateUserId(childUser).catch((err) =>
            console.error(`Error generating user ID for child ${childUser.id}:`, err)
          );
        } catch (error) {
          console.error("Error creating child user:", error);
        }
      })
    );
  }

   private async generateUserId(userData: any) {
    const prefix = process.env.ID_PREFIX || 'WWM-HC'; 
    const year = new Date().getFullYear();
    const paddedId = userData.id.toString().padStart(4, '0'); 
    const generatedUserId = `${prefix}-${year}${paddedId}`;

    const password = userData.password || ""
    
    return await this.updateUserAndSetUserId(userData.id, generatedUserId, userData.name, password);
  }
  

  private async updateUserAndSetUserId(id: number, generatedUserId: string, name:string, password: string) {
    // this is to save the user to the biometric device
    const result = await this.saveUserToZTeco(id, generatedUserId, name, password )
    let updatedUser;
    if (result){
     updatedUser = await prisma.user.update({
        where: { id },
        data: { 
          member_id: generatedUserId,
          is_sync : true
         },
      });
    }else {
      updatedUser = await prisma.user.update({
        where: { id },
        data: { 
          member_id: generatedUserId,
          is_sync : false
         },
      });
    }


    return updatedUser;

  }

  async saveUserToZTeco(id: number, member_id: string, name: string, password: string) {

    if (!process.env.SAVE_TO_ZKDEVICE || process.env.SAVE_TO_ZKDEVICE === "false") return false;

    if (!process.env.ZTECO_SERVICE) return false;

    const URL = process.env.ZTECO_SERVICE

    const userId = member_id.slice(-8)

    try {
   
      await axios.post(`${URL}/zteco`, {
      id,
      member_id: userId,
      name,
      password,
    }).then((res) => {
      console.log(`User ${name} is saved to ZKdevice sucessfully`)
      console.log(res.data)
      return res.data[0];
    });
  } catch (error: any) {
    console.error('❌ Failed to call ZKTeco service:', error.message);
  }
  
  }
}