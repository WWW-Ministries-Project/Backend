import { MemberModel } from "../Models/members";
import { Request, Response } from "express";

export const createMember = async (req: Request, res: Response) => {
  const {
    title,
    first_name,
    last_name,
    date_of_birth,
    gender,
    phone_number_1,
    phone_number_2,
    email,
    address,
    country,
    occupation,
    company,
    member_since,
    photo,
    department,
  } = req.body;
  try {
    const response = await MemberModel.create({
      title,
      first_name,
      last_name,
      date_of_birth,
      gender,
      phone_number_1,
      phone_number_2,
      email,
      address,
      country,
      occupation,
      company,
      member_since,
      photo,
      department,
    });
    res
      .status(200)
      .json({ message: "Member Created Succesfully", member_id: response._id });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).send("Operation Not Successful");
    }
    throw error.message;
  }
};

export const getAllMembers = async (req: Request, res: Response) => {
  try {
    const response = await MemberModel.find();
    res.json(response).status(200);
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).send("Operation Not Successful");
    }
    throw error.message;
  }
};

export const updateMemberInfo = async (req: Request, res: Response) => {
  const {
    member_id,
    title,
    first_name,
    last_name,
    date_of_birth,
    gender,
    phone_number_1,
    phone_number_2,
    email,
    address,
    country,
    occupation,
    company,
    member_since,
    photo,
    department,
  } = req.body;
  try {
    const response = await MemberModel.updateOne(
      { _id: member_id },
      {
        $set: {
          title,
          first_name,
          last_name,
          date_of_birth,
          gender,
          phone_number_1,
          phone_number_2,
          email,
          address,
          country,
          occupation,
          company,
          member_since,
          photo,
          department,
        },
      }
    );
    res.status(200).json({
      message: "Member Created Succesfully",
      member_id: response,
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).send("Operation Not Successful");
    }
    throw error.message;
  }
};
