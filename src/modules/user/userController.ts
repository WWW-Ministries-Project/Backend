import { Request, Response } from "express";
import JWT from "jsonwebtoken";
import * as dotenv from "dotenv";
import { prisma } from "../../Models/context";
import {
  sendEmail,
  toCapitalizeEachWord,
  comparePassword,
  hashPassword,
  confirmTemplate,
} from "../../utils";
import { ZKTeco } from "../integrationUtils/userIntegration";
import { ZKTecoAuth } from "../integrationUtils/authenticationIntegration";

dotenv.config();

const JWT_SECRET: any = process.env.JWT_SECRET;
const HostArea: number = Number(process.env.AREA) || 2;

export const landingPage = async (req: Request, res: Response) => {
  res.send(
    // `<h1>Welcome to World Wide Word Ministries Backend Server🔥🎉💒</h1>`
    `<h1>Welcome to World Wide Word Ministries Backend Server🔥🎉🙏💒...</h1>`
  );
};

const selectQuery = {
  id: true,
  name: true,
  email: true,
  membership_type: true,
  created_at: true,
  is_active: true,
  position_id: true,
  access_level_id: true,
  member_id: true,
  status: true,
  user_info: {
    select: {
      first_name: true,
      last_name: true,
      other_name: true,
      country_code: true,
      primary_number: true,
      title: true,
      photo: true,
      marital_status: true,
      nationality: true,
      date_of_birth: true,
      gender: true,
      country: true,
      occupation: true,
      company: true,
      address: true,
      emergency_contact: {
        select: {
          name: true,
          phone_number: true,
          relation: true,
        },
      },
      work_info: {
        select: {
          name_of_institution: true,
          industry: true,
          position: true,
        },
      },
    },
  },
  department: {
    select: {
      department_info: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  position: {
    select: {
      id: true,
      name: true,
    },
  },
};

export const registerUser = async (req: Request, res: Response) => {
  try {
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
      } = {}, // Default to an empty object to prevent errors

      picture = {}, // Default to an empty object

      contact_info: {
        email,
        resident_country,
        phone: { country_code, number: primary_number } = {}, // Handle nested phone object
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

      church_info: { membership_type } = {},

      children = [],
      status,
      department_id,
      position_id,
      password,
      is_user,
    } = req.body;

    // Generate an email if not provided
    let userEmail = email?.trim();
    if (!userEmail) {
      const birthYear = date_of_birth ? new Date(date_of_birth).getFullYear() : "";
      userEmail = `${first_name.toLowerCase()}${last_name.toLowerCase()}${birthYear}@temp.com`;
    }

    // Hash password for users
    const hashedPassword = is_user ? await hashPassword(password || "123456") : undefined;
    const emergency_phone = `${emergency_country_code}${emergency_phone_number}`

    // Create the main user
    const response = await prisma.user.create({
      data: {
        name: toCapitalizeEachWord(`${first_name} ${other_name || ""} ${last_name}`.trim()),
        email: userEmail,
        password: hashedPassword,
        is_user,
        status,
        department_id,
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
      select: selectQuery,
    });

    // Generate User ID (async)
    generateUserId(response).catch((err) => console.error("Error generating user ID:", err));

    // Handle children creation if `has_children` is true
    if (has_children && children.length > 0) {
      await Promise.all(
        children.map(async (child: any) => {
          const childResponse = await prisma.user.create({
            data: {
              name: toCapitalizeEachWord(`${child.first_name} ${child.other_name || ""} ${child.last_name}`.trim()),
              email: `${child.first_name.toLowerCase()}_${child.last_name.toLowerCase()}_${Date.now()}@temp.com`,
              is_user: false,
              parent_id: response.id,
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
          generateUserId(childResponse).catch((err) =>
            console.error(`Error generating user ID for child ${childResponse.id}:`, err)
          );
        })
      );
    }

    // Send confirmation email if user
    if (is_user) {
      sendEmail(
        confirmTemplate({
          first_name,
          email: userEmail,
          password: password || "123456",
          frontend_url: `${process.env.Frontend_URL}/login`,
        }),
        userEmail,
        "Reset Password"
      );
    }

    return res.status(201).json({ message: "User Created Successfully", data: response });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ message: "Internal Server Error", data: error?.message });
  }
};


export const updateUser = async (req: Request, res: Response) => {
  const {
    id,
    title,
    date_of_birth,
    gender,
    country_code,
    primary_number,
    other_number,
    email,
    address,
    country,
    occupation,
    company,
    member_since,
    photo,
    is_user,
    department_id,
    position_id,
    password,
    access_level_id,
    membership_type,
    first_name,
    last_name,
    other_name,
    marital_status,
    nationality,
    emergency_contact_name,
    emergency_contact_relation,
    emergency_contact_phone_number,
    work_name,
    work_industry,
    work_position,
  } = req.body;
  try {
    const existance = await prisma.user.findUnique({
      where: {
        id: Number(id),
      },
      select: selectQuery,
    });

    if (!existance) {
      return res.status(400).json({ message: "No user found", data: null });
    }

    const response = await prisma.user.update({
      where: {
        id,
      },
      data: {
        name: `${first_name ? first_name : existance?.user_info?.first_name} ${
          other_name ? other_name : existance?.user_info?.other_name
        } ${last_name ? last_name : existance?.user_info?.last_name}`,
        email: email ? email : existance?.email,
        position_id: position_id ? position_id : existance?.position_id,
        password: is_user ? await hashPassword("123456") : undefined,
        is_user,
        membership_type: membership_type
          ? membership_type
          : existance?.membership_type,
        access_level_id: access_level_id
          ? access_level_id
          : existance?.access_level_id,
        updated_at: new Date(),
        department_id: Number(department_id),
        user_info: {
          update: {
            title: title ? title : existance?.user_info?.title,
            first_name: first_name
              ? first_name
              : existance?.user_info?.first_name,
            last_name: last_name ? last_name : existance?.user_info?.last_name,
            other_name: other_name
              ? other_name
              : existance?.user_info?.other_name,
            date_of_birth: date_of_birth
              ? new Date(date_of_birth)
              : existance?.user_info?.date_of_birth,
            gender: gender ? gender : existance?.user_info?.gender,
            country_code: country_code
              ? country_code
              : existance?.user_info?.country_code,
            primary_number: primary_number
              ? primary_number
              : existance?.user_info?.primary_number,
            email,
            address: address ? address : existance?.user_info?.address,
            country: country ? country : existance?.user_info?.country,

            company: company ? company : existance?.user_info?.company,
            member_since: member_since ? new Date(member_since) : null,
            occupation: occupation
              ? occupation
              : existance?.user_info?.occupation,
            photo,
            marital_status: marital_status
              ? marital_status
              : existance?.user_info?.marital_status,
            nationality: nationality
              ? nationality
              : existance?.user_info?.nationality,
            emergency_contact: {
              update: {
                name: emergency_contact_name
                  ? emergency_contact_relation
                  : existance?.user_info?.emergency_contact?.name,
                relation: emergency_contact_relation
                  ? emergency_contact_relation
                  : existance?.user_info?.emergency_contact?.relation,
                phone_number: emergency_contact_phone_number
                  ? emergency_contact_phone_number
                  : existance?.user_info?.emergency_contact?.phone_number,
              },
            },
            work_info: {
              update: {
                name_of_institution: work_name
                  ? work_name
                  : existance?.user_info?.work_info?.name_of_institution,
                industry: work_industry
                  ? work_industry
                  : existance?.user_info?.work_info?.industry,
                position: work_position
                  ? work_position
                  : existance?.user_info?.work_info?.position,
              },
            },
          },
        },
      },
      select: selectQuery,
    });
    res
      .status(200)
      .json({ message: "User Updated Succesfully", data: response });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: error?.message });
  }
};
export const updateUserSatus = async (req: Request, res: Response) => {
  const { id, is_active, status } = req.body;
  try {
    const response = await prisma.user.update({
      where: {
        id,
      },
      data: {
        is_active,
        status,
      },
      select: selectQuery,
    });
    res
      .status(200)
      .json({ message: "User Status Updated Succesfully", data: response });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: null });
  }
};
export const deleteUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.query;
    const existance = await prisma.user.findUnique({
      where: {
        id: Number(id),
      },
      select: {
        id: true,
      },
    });

    if (!existance) {
      return res.status(400).json({ message: "No user found", data: null });
    }

    await prisma.user.delete({
      where: {
        id: Number(id),
      },
    });
    return res
      .status(200)
      .json({ message: "User deleted Succesfully", data: null });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: error });
  }
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  try {
    const existance: any = await prisma.user.findUnique({
      where: {
        email,
        AND: {
          is_user: true,
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        user_info: {
          select: {
            photo: true,
          },
        },
        access: {
          select: {
            permissions: true,
          },
        },
      },
    });

    if (!existance) {
      return res
        .status(404)
        .json({ message: "No user with Email", data: null });
    }

    if (await comparePassword(password, existance?.password)) {
      const token = JWT.sign(
        {
          id: existance.id,
          name: existance.name,
          email: existance.email,
          permissions: existance.access?.permissions,
          profile_img: existance.user_info?.photo,
        },
        JWT_SECRET,
        {
          expiresIn: "12h",
        }
      );

      return res
        .status(200)
        .json({ status: "Login Successfully", token: token });
    } else {
      return res
        .status(401)
        .json({ message: "Invalid Credentials", data: null });
    }
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: error });
  }
};

export const changePassword = async (req: Request, res: Response) => {
  const { token, newpassword } = req.body;
  try {
    const user: any = JWT.verify(token, JWT_SECRET);
    const id = user.id;

    await prisma.user.update({
      where: {
        id,
      },
      data: {
        password: await hashPassword(newpassword),
      },
    });
    res
      .status(200)
      .json({ message: "Password Changed Successfully", data: null });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: null });
  }
};

export const forgetPassword = async (req: Request, res: Response) => {
  const { email } = req.body;
  try {
    //check for the existence of an account using
    const existingUser = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (!existingUser) {
      return res.status(400).json({ error: "User Not Exists" });
    }
    const secret = JWT_SECRET + existingUser.password;
    const token = JWT.sign(
      {
        id: existingUser.id,
        email: existingUser.email,
      },
      secret,
      {
        expiresIn: "15m",
      }
    );
    const link = `${process.env.Frontend_URL}/reset-password/?id=${existingUser.id}&token=${token}`;
    sendEmail(link, email, "Reset Password");
    return res
      .status(200)
      .json({ message: `Link Send to your Mail`, data: null });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: null });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  const { id, token } = req.query;
  const { newpassword } = req.body;
  //check for the existence of an account using
  try {
    const existingUser = await prisma.user.findUnique({
      where: {
        id: Number(id),
      },
    });
    if (!existingUser) {
      return res.status(404).json({ message: "User Not Exists", data: null });
    }
    const secret = JWT_SECRET + existingUser.password;
    const verify = JWT.verify(token as string, secret);

    if (verify) {
      await prisma.user.update({
        where: {
          id: Number(id),
        },
        data: {
          password: await hashPassword(newpassword),
        },
      });
      return res
        .status(200)
        .json({ message: "Password Successfully changed", data: null });
    }
  } catch (error) {
    return res.status(500).json({ message: "Link Expired", data: null });
  }
};

export const activateUser = async (req: Request, res: Response) => {
  const { user_id } = req.query;
  try {
    const existingUser = await prisma.user.findUnique({
      where: {
        id: Number(user_id),
      },
    });
    if (!existingUser) {
      return res.status(404).json({ message: "User Not Exists", data: null });
    }

    const response = await prisma.user.update({
      where: {
        id: Number(user_id),
      },
      data: {
        is_user: !existingUser.is_user,
      },
    });
    return res
      .status(200)
      .json({ message: "Password Successfully changed", data: response });
  } catch (error) {
    return res.status(500).json({ message: "Operation Failed", data: error });
  }
};

export const seedUser = async (req: Request, res: Response) => {
  try {
    const response = await prisma.user.create({
      data: {
        name: "Ordinary Member",
        email: "member@member.com",
        password:
          "$2b$10$2EYtobxw11Tk1.JXCjplJOQ5mgu1dmNENtbDnpcQiqjnkSgyRrZqu",
        is_user: true,
      },
      select: {
        email: true,
        name: true,
      },
    });
    res
      .status(200)
      .json({ message: "User Created Succesfully", data: response });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Something went wrong", data: error });
  }
};

export const ListUsers = async (req: Request, res: Response) => {
  const { is_active, is_visitor, name } = req.body;
  const { is_user, department_id } = req.query;
  const isUser = is_user === "true";

  try {
    const response: any = await prisma.user.findMany({
      orderBy: {
        name: "asc",
      },
      where: {
        AND: {
          is_active,
          is_user: is_user != undefined ? isUser : undefined,
          department_id: department_id ? Number(department_id) : undefined,
          name: {
            contains: name ? name.trim() : undefined,
            // mode: "insensitive",
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        created_at: true,
        is_active: true,
        is_user: true,
        department_id: true,
        membership_type: true,
        status: true,
        user_info: {
          select: {
            country_code: true,
            primary_number: true,
            title: true,
            photo: true,
          },
        },
        department: {
          select: {
            department_info: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        position: {
          select: {
            id: true,
            name: true,
          },
        },
        access: {
          select: {
            name: true,
            permissions: true,
          },
        },
      },
    });
    const destructure = (data: []) => {
      let newObg: any = [];
      data.map((r1: any) => {
        let { user_info, ...rest } = r1;
        newObg.push({ ...rest, ...user_info });
      });
      return newObg;
    };
    res
      .status(200)
      .json({ message: "Operation Succesful", data: destructure(response) });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Something Went Wrong", data: error });
  }
};
export const getUser = async (req: Request, res: Response) => {
  const { user_id } = req.query;

  try {
    const response: any = await prisma.user.findUnique({
      where: {
        id: Number(user_id),
      },
      select: {
        id: true,
        name: true,
        email: true,
        membership_type: true,
        created_at: true,
        is_active: true,
        position_id: true,
        access_level_id: true,
        status: true,
        user_info: {
          select: {
            first_name: true,
            last_name: true,
            other_name: true,
            country_code: true,
            primary_number: true,
            title: true,
            photo: true,
            marital_status: true,
            nationality: true,
            date_of_birth: true,
            gender: true,
            country: true,
            occupation: true,
            company: true,
            address: true,
            emergency_contact: {
              select: {
                name: true,
                phone_number: true,
                relation: true,
              },
            },
            work_info: {
              select: {
                name_of_institution: true,
                industry: true,
                position: true,
              },
            },
          },
        },
        department: {
          select: {
            department_info: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        position: {
          select: {
            id: true,
            name: true,
          },
        },
        access: true,
      },
    });
    let { user_info, ...rest } = response;
    res.status(200).json({
      message: "Operation Succesful",
      data: { ...rest, ...user_info },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      message: "Operation failed",
      data: error,
    });
  }
};
export const statsUsers = async (req: Request, res: Response) => {
  try {
    interface Stats {
      Total: number;
      Male: number;
      Female: number;
      Other: number;
    }

    interface CategoryStats {
      children: Stats;
      adults: Stats;
    }

    const allUserInfos_members = await prisma.user_info.findMany({
      where: {
        user: {
          membership_type: "MEMBER",
        },
      },
    });
    const allUserInfos_visitors = await prisma.user_info.findMany({
      where: {
        user: {
          membership_type: "VISITOR",
        },
      },
    });
    const allUserInfosByCategory = allUserInfos_members.reduce(
      (acc: any, cur) => {
        const gender = cur.gender || "other";

        acc.total++;
        acc[gender]++;

        return acc;
      },
      { total: 0, Male: 0, Female: 0, other: 0 }
    );

    const stats: CategoryStats = allUserInfos_members.reduce(
      (acc: any, user) => {
        const age =
          Number(new Date().getFullYear()) -
          Number(user.date_of_birth?.getFullYear());
        const category = age <= 18 ? "children" : "adults";
        const gender = user.gender || "other";

        acc[category].Total++;
        acc[category][gender]++;

        return acc;
      },
      {
        children: { Total: 0, Male: 0, Female: 0, other: 0 },
        adults: { Total: 0, Male: 0, Female: 0, other: 0 },
      }
    );

    const visitorInfosByCategory = allUserInfos_visitors.reduce(
      (acc: any, cur) => {
        const gender = cur.gender || "other";

        acc.total++;
        acc[gender]++;

        return acc;
      },
      { total: 0, Male: 0, Female: 0, other: 0 }
    );

    const visitor_stats: CategoryStats = allUserInfos_visitors.reduce(
      (acc: any, user) => {
        const age =
          Number(new Date().getFullYear()) -
          Number(user.date_of_birth?.getFullYear());
        const category = age <= 18 ? "children" : "adults";
        const gender = user.gender || "other";

        acc[category].Total++;
        acc[category][gender]++;

        return acc;
      },
      {
        children: { Total: 0, Male: 0, Female: 0, other: 0 },
        adults: { Total: 0, Male: 0, Female: 0, other: 0 },
      }
    );

    return res.status(202).json({
      members: {
        total_members: allUserInfosByCategory.total,
        total_males: allUserInfosByCategory.Male,
        total_females: allUserInfosByCategory.Female,
        total_others: allUserInfosByCategory.other,
        stats: stats,
      },
      visitors: {
        total_members: visitorInfosByCategory.total,
        total_males: visitorInfosByCategory.Male,
        total_females: visitorInfosByCategory.Female,
        total_others: visitorInfosByCategory.other,
        stats: visitor_stats,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: error });
  }
};

async function generateUserId(userData: any) {
  let sync_id;
  let is_sync = false;
  const prefix = process.env.ID_PREFIX || 'WWM-HC'; 
  const year = new Date().getFullYear();
  const paddedId = userData.id.toString().padStart(4, '0'); 
  const generatedUserId = `${prefix}-${year}000${paddedId}`;
  try {
    const zkResponse = await saveUserToZTeco(userData)
    sync_id = zkResponse.sync_id
    is_sync = true
  }catch(error:any){
    sync_id = null
    is_sync = false
  }
  

  return await updateUserAndSetUserId(userData.id, generatedUserId,sync_id,is_sync);
}

async function saveUserToZTeco(data:any){
  const zkPayload = {
    id: data.id.toString(),
    department: data.department?.department_info?.sync_id ?? 0,
    area: [HostArea],
    hire_date: data.member_since
      ? new Date(data.member_since).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0],
      first_name:data.user_info.first_name,
    last_name:data.user_info.last_name,
    gender: data.user_info.gender === "Male" ? "M" : data.gender === "Female" ? "F" : "S",
    email:data.email,
    mobile: data.user_info.primary_number,
    nationality:data.user_info.nationality,
    address:data.user_info.address,
    app_status: 1,
  };

  const zkTeco = new ZKTeco();
  const zKTecoAuth = new ZKTecoAuth;
  console.log(zkPayload)
 
  
  const authResponse = await zKTecoAuth.userAuthentication();
  if (!authResponse?.token) {
    throw new Error("Failed to authenticate with ZKTeco");
  }

  const token = authResponse.token;

  // Create user in ZKTeco
  const zkResponse = await zkTeco.createUser(zkPayload, token);
  
  console.log("User successfully created in ZKTeco:", zkResponse);
  return zkResponse;
}

async function updateUserAndSetUserId(id: number, generatedUserId: string,sync_id: number
  |null, is_sync:boolean) {
  return await prisma.user.update({
    where: { id },
    data: { 
      member_id: generatedUserId,
      is_sync:is_sync,
      sync_id:sync_id
     },
  });
}
