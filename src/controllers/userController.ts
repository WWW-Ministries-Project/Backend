import { Request, Response } from "express";
import JWT from "jsonwebtoken";
import * as dotenv from "dotenv";
import { model } from "../Models/user";
import { comparePassword, hashPassword } from "../utils/hashPasswords";
import { sendEmail } from "../utils/emailService";
dotenv.config();

const User = model;
const JWT_SECRET: any = process.env.JWT_SECRET;

export const landingPage = async (req: Request, res: Response) => {
  res.send(`Welcome to World Wide Word Ministries`);
};

export const registerUser = async (req: Request, res: Response) => {
  const { name, email, password } = req.body;
  try {
    const response = await User.create({
      name,
      email,
      password: await hashPassword(password),
    });
    res.status(200).json("User Created Succesfully");
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).send("Email already in use");
    }
    throw error.message;
  }
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const existance = await User.findOne({
    email,
  }).lean();

  if (!existance) {
    return res
      .status(503)
      .json({ status: "error", data: "No user with that Email" });
  }

  if (await comparePassword(password, existance?.password)) {
    const token = JWT.sign(
      {
        id: existance._id,
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
    const _id = user.id;
    await User.updateOne(
      { _id },
      {
        $set: { password: await hashPassword(newpassword) },
      }
    );
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
    const existingUser = await User.findOne({
      email,
    });
    if (!existingUser) {
      return res.send("User Not Exists");
    }
    const secret = JWT_SECRET + existingUser.password;
    const token = JWT.sign(
      {
        id: existingUser._id,
        email: existingUser.email,
      },
      secret,
      {
        expiresIn: "5m",
      }
    );
    const link = `https://wwwministries.netlify.app/reset-password/?id=${existingUser._id}/?token=${token}`;
    sendEmail(link, email, "Reset Password");
    // console.log(link);
    return res.status(200).send(`Link Send to your Mail`);
  } catch (error) {
    return res.status(500);
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  const { id, token } = req.params;
  const { password } = req.body;
  //check for the existence of an account using
  try {
    const existingUser = await User.findOne({
      _id: id,
    });
    if (!existingUser) {
      return res.send("User Not Exists");
    }
    const secret = JWT_SECRET + existingUser.password;
    const verify = JWT.verify(token, secret);

    if (verify) {
      await User.updateOne(
        { _id: id },
        {
          $set: {
            password: await hashPassword(password),
          },
        }
      );
      return res.send("Password Successfully changed");
    }
  } catch (error) {
    return res.status(500).json({ error: "Link Expired" });
  }
};
