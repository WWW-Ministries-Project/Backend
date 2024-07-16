import { Request, Response } from "express";
import JWT from "jsonwebtoken";
import * as dotenv from "dotenv";
import { model } from "../Models/user";
import { comparePassword, hashPassword } from "../utils/hashPasswords";
import { sendEmail } from "../utils/emailService";
import { prisma } from "../Models/context";
import { confirmTemplate } from "../utils/mail_templates/confirmTemplate";
import { toCapitalizeEachWord } from "../utils/textFormatter";
import { userInfo } from "os";
dotenv.config();

const User = model;
const JWT_SECRET: any = process.env.JWT_SECRET;

export const landingPage = async (req: Request, res: Response) => {
  res.send(
    // `<h1>Welcome to World Wide Word Ministries Backend Server🔥🎉💒</h1>`
    `<h1>Welcome to World Wide Word Ministries Backend Server🔥🎉🙏💒...Access the Main Page on https://wwwministries.netlify.app</h1>`
  );
};

const selectQuery = {
  id: true,
  name: true,
  email: true,
  membership_type: true,
  created_at: true,
  is_active: true,
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
    const existingUser = await prisma.user.findMany({
      where: {
        email,
      },
    });
    if (existingUser.length >= 1) {
      res.status(409).json({ message: "Email already exists", data: null });
    } else {
      const response = await prisma.user.create({
        data: {
          name: toCapitalizeEachWord(
            `${first_name} ${other_name ? other_name : ""} ${last_name}`
          ),
          email,
          position_id,
          password: is_user ? await hashPassword("123456") : undefined,
          is_user,
          membership_type,
          access_level_id,
          department: department_id
            ? {
                create: {
                  department_id,
                },
              }
            : undefined,
          user_info: {
            create: {
              title,
              first_name,
              last_name,
              other_name,
              date_of_birth: date_of_birth ? new Date(date_of_birth) : null,
              gender,
              country_code,
              primary_number,
              other_number,
              email,
              address,
              country,
              company: toCapitalizeEachWord(company),
              member_since: member_since ? new Date(member_since) : null,
              occupation,
              photo,
              marital_status,
              nationality,
              emergency_contact: {
                create: {
                  name: emergency_contact_name,
                  relation: emergency_contact_relation,
                  phone_number: emergency_contact_phone_number,
                },
              },
              work_info: {
                create: {
                  name_of_institution: work_name,
                  industry: work_industry,
                  position: work_position,
                },
              },
            },
          },
        },
        select: selectQuery,
      });
      const mailDet = {
        first_name,
        email,
        password: password || "123456",
        frontend_url: `${process.env.Frontend_URL}/login`,
      };

      if (is_user) {
        sendEmail(confirmTemplate(mailDet), email, "Reset Password");
      }
      res
        .status(200)
        .json({ message: "User Created Succesfully", data: response });
    }
  } catch (error: any) {
    console.log(error);
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: error?.message });
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
      select: {
        user_info: true,
      },
    });

    if (!existance) {
      res.status(400).json({ message: "No user found", data: null });
    }

    const response = await prisma.user.update({
      where: {
        id,
      },
      data: {
        name: `${first_name ? first_name : existance?.user_info?.first_name} ${
          other_name ? other_name : existance?.user_info?.other_name
        } ${last_name ? last_name : existance?.user_info?.last_name}`,
        email,
        position_id,
        password: is_user ? await hashPassword("123456") : undefined,
        is_user,
        membership_type,
        access_level_id,
        department: department_id
          ? {
              update: {
                where: {
                  user_id: id,
                },
                data: {
                  department_id,
                },
              },
            }
          : undefined,
        user_info: {
          update: {
            title,
            first_name,
            last_name,
            other_name,
            date_of_birth: date_of_birth ? new Date(date_of_birth) : null,
            gender,
            country_code,
            primary_number,
            other_number,
            email,
            address,
            country: country ? country : existance?.user_info?.country,

            company: company ? company : existance?.user_info?.company,
            member_since: member_since ? new Date(member_since) : null,
            occupation: occupation
              ? occupation
              : existance?.user_info?.occupation,
            photo,
            marital_status,
            nationality: nationality
              ? nationality
              : existance?.user_info?.nationality,
            emergency_contact: {
              update: {
                name: emergency_contact_name,
                relation: emergency_contact_relation,
                phone_number: emergency_contact_phone_number,
              },
            },
            work_info: {
              update: {
                name_of_institution: work_name,
                industry: work_industry,
                position: work_position,
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
  const { id, is_active } = req.body;
  try {
    const response = await prisma.user.update({
      where: {
        id,
      },
      data: {
        is_active,
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

export const seedUser = async (req: Request, res: Response) => {
  try {
    const response = await prisma.user.create({
      data: {
        name: "Admin",
        email: "admin@admin.com",
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
  const { is_user } = req.query;

  try {
    const response: any = await prisma.user.findMany({
      orderBy: {
        name: "asc",
      },
      where: {
        AND: {
          is_active,
          is_user: Boolean(is_user),
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
      select: selectQuery,
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
    // const allUserInfos = await prisma.user_info.findMany();
    // const children: any = [];
    // const adults: any = [];
    // allUserInfos.map((user) => {
    //   if (
    //     Number(new Date().getFullYear()) -
    //       Number(user.date_of_birth?.getFullYear()) <=
    //     18
    //   ) {
    //     children.push(user);
    //   } else {
    //     adults.push(user);
    //   }
    // });
    // const children_stats = {
    //   Total: 0,
    //   Male: 0,
    //   Female: 0,
    //   Other: 0,
    // };
    // const adults_stats = {
    //   Total: 0,
    //   Male: 0,
    //   Female: 0,
    //   Other: 0,
    // };
    // children_stats.Total += children.length;
    // adults_stats.Total += adults.length;

    // adults.map((adult: any) => {
    //   switch (adult.gender) {
    //     case "Male":
    //       adults_stats.Male++;
    //       break;
    //     case "Female":
    //       adults_stats.Female++;
    //       break;
    //     default:
    //       adults_stats.Other++;
    //   }
    // });
    // children.map((child: any) => {
    //   switch (child.gender) {
    //     case "Male":
    //       children_stats.Male++;
    //       break;
    //     case "Female":
    //       children_stats.Female++;
    //       break;
    //     default:
    //       children_stats.Other++;
    //   }
    // });
    // console.log("children", children_stats);
    // console.log("adult", adults_stats);
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

    const allUserInfos = await prisma.user_info.findMany();
    const allUserInfosByCategory = allUserInfos.reduce(
      (acc: any, cur) => {
        const gender = cur.gender || "other";

        acc.total++;
        acc[gender]++;

        return acc;
      },
      { total: 0, Male: 0, Female: 0, other: 0 }
    );

    const stats: CategoryStats = allUserInfos.reduce(
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
      total_members: allUserInfosByCategory.total,
      total_males: allUserInfosByCategory.Male,
      total_females: allUserInfosByCategory.Female,
      total_others: allUserInfosByCategory.other,
      stats: stats,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: error });
  }
};
