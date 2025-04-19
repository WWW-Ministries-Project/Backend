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
import { UserService } from "./userService";

dotenv.config();

const JWT_SECRET: any = process.env.JWT_SECRET;
const userService = new UserService();

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
        first_name,
      } = {},

      contact_info: {
        email
      } = {},

      password,
      is_user,
    } = req.body;
   
    const response = await userService.registerUser(req.body)
  

    // Send confirmation email if user
    if (is_user) {
      sendEmail(
        confirmTemplate({
          first_name,
          email,
          password: password || "123456",
          frontend_url: `${process.env.Frontend_URL}/login`,
        }),
        email,
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
  try {
    const { id } = req.params; // Assuming user ID is passed as a URL param
    const {
      personal_info: {
        title,
        first_name,
        last_name,
        other_name,
        date_of_birth,
        gender,
        marital_status,
        nationality,
      } = {},
      picture: { src: photo } = {},
      contact_info: {
        email,
        resident_country: country,
        phone: { country_code, number: primary_number } = {},
      } = {},
      work_info: {
        work_name,
        work_industry,
        work_position,
      } = {},
      emergency_contact: {
        name: emergency_contact_name,
        relation: emergency_contact_relation,
        phone: { country_code: emergency_country_code, number: emergency_phone_number } = {},
      } = {},
      church_info: { membership_type } = {},
      status,
      position_id,
      is_user,
    } = req.body;

    const userExists = await prisma.user.findUnique({
      where: { id: Number(id) },
      select: selectQuery,
    });

    if (!userExists) {
      return res.status(400).json({ message: "User not found", data: null });
    }

    const emergency_phone = emergency_country_code && emergency_phone_number
      ? `${emergency_country_code}${emergency_phone_number}`
      : userExists?.user_info?.emergency_contact?.phone_number;

    const updatedUser = await prisma.user.update({
      where: { id: Number(id) },
      data: {
        name: `${first_name || userExists?.user_info?.first_name} ${other_name || userExists?.user_info?.other_name || ""} ${last_name || userExists?.user_info?.last_name}`.trim(),
        email: email || userExists?.email,
        position_id: position_id || userExists?.position_id,
        is_user,
        status,
        membership_type: membership_type || userExists?.membership_type,
        user_info: {
          update: {
            title: title || userExists?.user_info?.title,
            first_name: first_name || userExists?.user_info?.first_name,
            last_name: last_name || userExists?.user_info?.last_name,
            other_name: other_name || userExists?.user_info?.other_name,
            date_of_birth: date_of_birth ? new Date(date_of_birth) : userExists?.user_info?.date_of_birth,
            gender: gender || userExists?.user_info?.gender,
            marital_status: marital_status || userExists?.user_info?.marital_status,
            nationality: nationality || userExists?.user_info?.nationality,
            country_code: country_code || userExists?.user_info?.country_code,
            primary_number: primary_number || userExists?.user_info?.primary_number,
            email,
            country: country || userExists?.user_info?.country,
            photo: photo || userExists?.user_info?.photo,
            work_info: {
              update: {
                name_of_institution: work_name || userExists?.user_info?.work_info?.name_of_institution,
                industry: work_industry || userExists?.user_info?.work_info?.industry,
                position: work_position || userExists?.user_info?.work_info?.position,
              },
            },
            emergency_contact: {
              update: {
                name: emergency_contact_name || userExists?.user_info?.emergency_contact?.name,
                relation: emergency_contact_relation || userExists?.user_info?.emergency_contact?.relation,
                phone_number: emergency_phone,
              },
            },
          },
        },
      },
      select: selectQuery,
    });

    return res.status(200).json({ message: "User updated successfully", data: updatedUser });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ message: "Internal Server Error", data: error?.message });
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
        member_id: true,
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
        enrollments: {
          select: {
            id: true,
            course: {
              select: {
                id: true,
                name: true,
                instructor: true,
                cohort: {
                  select: {
                    id: true,
                    name: true,
                    status: true,
                    program: {
                      select: {
                        id: true,
                        title: true,
                      },
                    },
                  },
                },
              },
            },
            progress: {
              select: {
                id: true,
                topic: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
                status: true,
              },
            },
          },
        },
        children: {
          select: {
            id: true,
            name: true,
            email: true,
            membership_type: true,
            created_at: true,
            status: true,
            user_info: {
              select: {
                first_name: true,
                last_name: true,
                other_name: true,
                date_of_birth: true,
                gender: true,
                nationality: true,
              },
            },
          },
        },
      },
    });

    let { user_info, ...rest } = response;
    res.status(200).json({
      message: "Operation Successful",
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
          membership_type: "ONLINE",
        },
      },
    });
    const allUserInfos_visitors = await prisma.user_info.findMany({
      where: {
        user: {
          membership_type: "IN_HOUSE",
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
      message:"Operation Sucessful",
      data:{
        online: {
        total_members: allUserInfosByCategory.total,
        total_males: allUserInfosByCategory.Male,
        total_females: allUserInfosByCategory.Female,
        total_others: allUserInfosByCategory.other,
        stats: stats,
      },
      inhouse: {
        total_members: visitorInfosByCategory.total,
        total_males: visitorInfosByCategory.Male,
        total_females: visitorInfosByCategory.Female,
        total_others: visitorInfosByCategory.other,
        stats: visitor_stats,
      },
    }
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: error });
  }
};

export const getUserByEmailPhone = async (req: Request, res: Response) => {
  const { email } = req.query;

try {
  const response: any = await prisma.user_info.findFirst({
    where: {
      OR: [
        { email: email as string },
        { primary_number: email as string },
      ],
    },
    select: {
      first_name: true,
      last_name: true,
      other_name: true,
      email: true,
      country_code: true,
      primary_number: true,
      title: true,
      user:{
        select:{
          membership_type:true,
          status: true,
        }
        
      }
    },
  });

  if (!response) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  return res.status(200).json({
    message: "Operation successful",
    data: response,
  });

} catch (error) {
  console.log(error);
  return res.status(500).json({
    message: "Operation failed",
    data: error,
  });
}

};
