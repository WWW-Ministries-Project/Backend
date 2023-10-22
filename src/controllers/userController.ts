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
    // const response = await User.create({
    //   name,
    //   email,
    //   password: await hashPassword(password),
    // });

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
        position: {
          connect: { id: position_id },
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
      },
    });

    res
      .status(200)
      .json({ status: "User Created Succesfully", data: response });
  } catch (error) {
    console.log(error);
    return res.json({ error });
  }
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  // const existance = await User.findOne({
  //   email,
  // }).lean();

  const existance = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (!existance) {
    return res
      .status(503)
      .json({ status: "error", data: "No user with that Email" });
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
      .status(503)
      .json({ status: "error", data: "Invalid Credentials" });
  }
};

export const changePassword = async (req: Request, res: Response) => {
  const { token, newpassword } = req.body;
  try {
    const user: any = JWT.verify(token, JWT_SECRET);
    const id = user.id;
    // await User.updateOne(
    //   { _id },
    //   {
    //     $set: { password: await hashPassword(newpassword) },
    //   }
    // );
    await prisma.user.update({
      where: {
        id,
      },
      data: {
        password: await hashPassword(newpassword),
      },
    });
    res.status(200).json({ status: "Password Changed Successfully" });
  } catch (error) {
    console.log(error);

    return res.status(409).json({ status: "error" });
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
    return res.status(200).send(`Link Send to your Mail`);
  } catch (error) {
    return res.status(500);
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  const { id, token } = req.query;
  const { password } = req.body;
  //check for the existence of an account using
  try {
    // const existingUser = await User.findOne({
    //   _id: id,
    // }).lean();

    const existingUser = await prisma.user.findUnique({
      where: {
        id: Number(id),
      },
    });

    if (!existingUser) {
      return res.json({ error: "User Not Exists" });
    }
    const secret = JWT_SECRET + existingUser.password;
    const verify = JWT.verify(token as string, secret);

    if (verify) {
      // await User.updateOne(
      //   { _id: id },
      //   {
      //     $set: {
      //       password: await hashPassword(password),
      //     },
      //   }
      // );

      await prisma.user.update({
        where: {
          id: Number(id),
        },
        data: {
          password: await hashPassword(password),
        },
      });
      return res.send("Password Successfully changed");
    }
  } catch (error) {
    return res.status(500).json({ error: "Link Expired" });
  }
};
