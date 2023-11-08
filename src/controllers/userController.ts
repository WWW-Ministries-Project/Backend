import { Request, Response } from "express";
import JWT from "jsonwebtoken";
import * as dotenv from "dotenv";
import { model } from "../Models/user";
import { comparePassword, hashPassword } from "../utils/hashPasswords";
import { sendEmail } from "../utils/emailService";
import { prisma } from "../Models/context";
dotenv.config();

const User = model;
const JWT_SECRET: any = process.env.JWT_SECRET;

export const landingPage = async (req: Request, res: Response) => {
  res.send(`Welcome to World Wide Word Ministries`);
};

export const registerUser = async (req: Request, res: Response) => {
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
  } = req.body;
  // console.log(req.body);
  try {
    const existingUser = await prisma.user.findMany({
      where: {
        email
      },
      include: {
        department: true,
        position: true,
        department_head: true,
        user_info: true
      }
    })
    if(existingUser){
      res
      .status(500)
      .json({ message: "Email already exists", data: null })
    } else {
       const response = await prisma.user.create({
      data: {
        name,
        email,
        password: is_user
          ? await hashPassword(password)
          : await hashPassword("123456"),
        is_user,
        is_visitor,
        department: {
          create: {
            department_id,
          },
        },
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
      },select: {
        id: true,
        name: true,
        email: true
      }
    });
    res
      .status(200)
      .json({ message: "User Created Succesfully", data: response });
    }   
  } catch (error) {
    return res
    .status(500)
    .json({ message: "Error Occured" , data: error });
  }
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const existance = await prisma.user.findUnique({
    where: {
      email,
    },
    include: {
      department: true,
      position: true,
      department_head: true,
      user_info: true
    }
  });

  if (!existance) {
    return res
      .status(404)
      .json({ message: "No user with that Email", data: null });
  }

  if (await comparePassword(password, existance?.password)) {
    const token = JWT.sign(
      {
        id: existance.id,
        email: existance.email,
      },
      JWT_SECRET,
      {
        expiresIn: 22222,
      }
    );

    return res.json({ status: "Login Successfully", token: token });
  } else {
    return res
      .status(500)
      .json({ message: "Invalid Credentials", data: null });
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
      include: {
        department: true,
        position: true,
        department_head: true,
        user_info: true
      }
    });
    res.status(200).json({ message: "Password Changed Successfully", data: null });
  } catch (error) {
    return res.status(500).json({ message: "Error Occured", data: error });
  }
};

export const forgetPassword = async (req: Request, res: Response) => {
  const { email } = req.body;
  //check for the existence of an account using
  try {
    // const existingUser = await User.findOne({
    //   email,
    // });

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
    return res.status(200).json({message: `Link Send to your Mail`, data: null});
  } catch (error) {
    return res.status(500).json({message: "Error Occured", data: null});

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
      return res.status(200).json({message: "Password Successfully changed", data: null});
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
    return res.status(500).json({ message: "Something went wrong", data: error });
  }
};

export const ListUsers = async (req: Request, res: Response) => {
  const { is_active, is_visitor } = req.body;

  try {
    const response = await prisma.user.findMany({
      orderBy: {
        id: "desc"
      },
      where: {
        is_active,
        is_visitor
      },
      include: {
        department: true,
        position: true,
        department_head: true,
        user_info: true
      }
    });
    res
      .status(200)
      .json({ message: "Operation Succesful", data: response });
  } catch (error) {
    return res.status(500).json({ message: "Something Went Wrong", data: error });
  }

};
export const getUser = async (req: Request, res: Response) => {
  const { user_id } = req.body;

  try {
    const response = await prisma.user.findMany({
      where: {
        id: user_id
      },
      include: {
        department: true,
        position: true,
        department_head: true,
        user_info: true
      }
    });
    res
      .status(200)
      .json({ message: "Operation Succesful", data: response });
  } catch (error) {
    return res.status(500).json({
      message: "Operation failed",
      data: error
    });
  }
};