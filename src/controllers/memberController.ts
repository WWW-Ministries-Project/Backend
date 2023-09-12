import { MemberModel } from "../Models/members";
import { Request, Response } from "express";
import cloudinary from "../utils/cloudinary";

const uploadImage = async (photo: any, name: string) => {
  try {
    const imageResponse = await cloudinary.uploader.upload(photo, {
      folder: "www-ministries",
      public_id: `${name}-img`,
    });
    return imageResponse;
  } catch (error) {
    // return error;
  }
};

export const createMember = async (req: Request, res: Response) => {
  const {
    title,
    name,
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
    visits,
    last_visited,
    department,
  } = req.body;
  const img = await uploadImage(photo, email);
  // console.log(img?.public_id);

  try {
    const response = await MemberModel.create({
      title,
      name,
      date_of_birth,
      gender,
      phone_number_1,
      phone_number_2,
      email,
      address,
      visits,
      last_visited,
      country,
      occupation,
      company,
      member_since,
      photo: img?.secure_url,
      department,
    });
    res
      .status(200)
      .json({ message: "Member Created Succesfully", member_id: response._id });
  } catch (error: any) {
    if (error) {
      return res.status(409).send("Operation Not Successful");
    }
    return error.message;
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

export const dashboardCount = async (req: Request, res: Response) => {
  try {
    const response = await MemberModel.find();
    const active_members = response.filter((item) => item.status === true);
    const partners = response.filter((item) => item.partner === true);
    const male = response.filter((item) => item.gender === "Male");
    const female = response.filter((item) => item.gender === "Female");

    res
      .json({
        active_members: active_members.length,
        partners: partners.length,
        male_count: male.length,
        female_count: female.length,
      })
      .status(200);
  } catch (error) {}
};
