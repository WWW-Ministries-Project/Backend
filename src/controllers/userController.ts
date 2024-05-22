import { Request, Response } from "express";
import JWT from "jsonwebtoken";
import * as dotenv from "dotenv";
import { model } from "../Models/user";
import { comparePassword, hashPassword } from "../utils/hashPasswords";
import { sendEmail } from "../utils/emailService";
import { prisma } from "../Models/context";
import { confirmTemplate } from "../utils/mail_templates/confirmTemplate";
dotenv.config();

const User = model;
const JWT_SECRET: any = process.env.JWT_SECRET;

export const landingPage = async (req: Request, res: Response) => {
  res.send(
    `Welcome to World Wide Word Ministries Backend Server🔥🙏💒...Access the Main Page on https://wwwministries.netlify.app`
  );
};

const selectQuery = {
  id: true,
  name: true,
  email: true,
  created_at: true,
  is_active: true,
  user_info: {
    select: {
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
};

export const registerUser = async (req: Request, res: Response) => {
  try {
    const {
      title,
      name,
      date_of_birth,
      gender,
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
      is_visitor,
      department_id,
      position_id,
      password,
      access_level_id,
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
          name,
          email,
          position_id,
          password: is_user
            ? await hashPassword(password)
            : await hashPassword("123456"),
          is_user,
          is_visitor,
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
              name,
              date_of_birth: date_of_birth ? new Date(date_of_birth) : null,
              gender,
              primary_number,
              other_number,
              email,
              address,
              country,
              company,
              member_since: member_since ? new Date(member_since) : null,
              occupation,
              photo,
            },
          },
        },
        select: selectQuery,
      });
      const mailDet = {
        name,
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
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: error });
  }
};
export const updateUser = async (req: Request, res: Response) => {
  const {
    id,
    title,
    name,
    date_of_birth,
    gender,
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
    is_visitor,
    department_id,
    position_id,
    access_level_id,
  } = req.body;
  try {
    const response = await prisma.user.update({
      where: {
        id,
      },
      data: {
        name,
        email,
        position_id,
        is_user,
        is_visitor,
        access_level_id,
        department: department_id
          ? {
              create: {
                department_id,
              },
            }
          : undefined,
        user_info: {
          update: {
            title,
            name,
            date_of_birth: date_of_birth ? new Date(date_of_birth) : null,
            gender,
            primary_number,
            other_number,
            email,
            address,
            country,
            company,
            member_since: member_since ? new Date(member_since) : null,
            occupation,
            photo,
          },
        },
      },
      select: selectQuery,
    });
    res
      .status(200)
      .json({ message: "User Updated Succesfully", data: response });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: null });
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
  } catch (error) {}
  const { id } = req.body;
  try {
    const response = await prisma.user.delete({
      where: {
        id,
      },
    });
    res.status(200).json({ message: "User Deleted Succesfully", data: null });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Internal Server Error", data: null });
  }
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  try {
    const existance = await prisma.user.findUnique({
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
      return res.json({ error: "User Not Exists" });
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
    const link = `https://wwwministries.netlify.app/reset-password/?id=${existingUser.id}&token=${token}`;
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
  const { password } = req.body;
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
          password: await hashPassword(password),
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
    const response = await prisma.user.findMany({
      orderBy: {
        id: "desc",
      },
      where: {
        AND: {
          is_active,
          is_visitor,
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
    res.status(200).json({ message: "Operation Succesful", data: response });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Something Went Wrong", data: error });
  }
};
export const getUser = async (req: Request, res: Response) => {
  const { user_id } = req.body;

  try {
    const response = await prisma.user.findMany({
      where: {
        id: user_id,
      },
      select: {
        id: true,
        name: true,
        email: true,
        is_active: true,
        user_info: true,
        department: {
          select: {
            department_info: {
              select: {
                id: true,
                name: true,
                description: true,
              },
            },
          },
        },
        position: true,
      },
    });
    res.status(200).json({ message: "Operation Succesful", data: response });
  } catch (error) {
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
