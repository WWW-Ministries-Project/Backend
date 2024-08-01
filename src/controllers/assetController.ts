import { Request, Response } from "express";
import { assetSchema } from "../utils/validator";
import { prisma } from "../Models/context";
import upload from "../utils/upload";
import { toCapitalizeEachWord } from "../utils/textFormatter";

export const createAsset = async (req: any, res: any) => {
  try {
    const {
      name,
      department_assigned,
      date_purchased,
      date_assigned,
      price,
      status,
      description,
      created_by,
      photo,
    } = req.body;
    const file = req.file ? req.file.path : null;
    assetSchema.validate(req.body);

    const asset = await prisma.assets.create({
      data: {
        name: toCapitalizeEachWord(name),
        department_assigned,
        date_purchased: date_purchased ? new Date(date_purchased) : undefined,
        description,
        price: Number(price),
        date_assigned: date_assigned ? new Date(date_assigned) : undefined,
        status,
        photo,
        created_by: Number(created_by),
      },
    });
    res.status(200).json({
      message: "Asset created successfully",
      asset,
    });
  } catch (error: any) {
    console.log(error.message);
    return res
      .status(500)
      .json({ message: "Something Went Wrong", data: error });
  }
};

export const updateAsset = async (req: Request, res: Response) => {
  try {
    const {
      name,
      department_assigned,
      date_purchased,
      date_assigned,
      price,
      status,
      description,
      id,
      updated_by,
      photo,
    } = req.body;
    assetSchema.validate(req.body);
    const updatedAsset = await prisma.assets.update({
      where: {
        id,
      },
      data: {
        name: toCapitalizeEachWord(name),
        department_assigned,
        date_purchased: date_purchased ? new Date(date_purchased) : undefined,
        description,
        price: Number(price),
        date_assigned: date_assigned ? new Date(date_assigned) : undefined,
        status,
        photo,
        updated_by: Number(updated_by),
        updated_at: new Date(),
      },
    });
    res.status(200).json({
      message: "Asset updated successfully",
      updatedAsset,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Something Went Wrong", data: error });
  }
};
export const listAssets = async (req: Request, res: Response) => {
  try {
    const assetsList = await prisma.assets.findMany({
      orderBy: {
        id: "desc",
      },
    });
    res.status(200).json({ message: "Operation Succesful", data: assetsList });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Something Went Wrong", data: error });
  }
};
export const deleteAsset = async (req: Request, res: Response) => {
  try {
    const { id } = req.body;
    if (!id) res.status(400).json({ message: "Asset ID not provided" });
    const deletedAsset = await prisma.assets.delete({
      where: {
        id,
      },
    });
    res
      .status(200)
      .json({ message: "Asset deleted successfully", deletedAsset });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Something Went Wrong", data: error });
  }
};
