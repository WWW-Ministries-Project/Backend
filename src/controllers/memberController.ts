import { MemberModel } from "../Models/members";
import { Request, Response } from "express";

export const createMember = async (req: Request, res: Response) => {
  const {
    first_name,
    last_name,
    date_of_birth,
    gender,
    phone_number,
    email,
    address,
    country,
    occupation,
    company,
    member_since,
    photo,
  } = req.body;
  try {
    const response = await MemberModel.create({
      first_name,
      last_name,
      date_of_birth,
      gender,
      phone_number,
      email,
      address,
      country,
      occupation,
      company,
      member_since,
      photo,
    });
    res.status(200).json("Member Created Succesfully");
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).send("Operation Not Successful");
    }
    throw error.message;
  }
};


export const getAllMembers = async (req: Request, res: Response) => {
    try {
        const response = await MemberModel.find()
        res.json(response).status(200)
    } catch (error) {
        
    }
}