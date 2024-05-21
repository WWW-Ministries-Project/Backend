import { Request, Response } from "express";
import { assetSchema } from "../utils/validator";
import { prisma } from "../Models/context";

export const createAsset = async (req: Request, res: Response) => {
  try {
    const {
      name,
      category,
      userId,
      date_purchased,
      date_assigned,
      asset_code,
      price,
      status,
      description,
    } = req.body;
    assetSchema.validate(req.body);
    const hasCategory = category
      ? {
          connect: {
            id: category,
          },
        }
      : undefined;
    const asset = await prisma.assets.create({
      data: {
        name,
        asset_code,
        category: hasCategory,
        userId,
        date_purchased: date_purchased ? new Date(date_purchased) : undefined,
        description,
        price,
        date_assigned: date_assigned ? new Date(date_assigned) : undefined,
        status,
      },
    });
    res.status(200).json({
      message: "Asset created successfully",
      asset,
    });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Something Went Wrong", data: error });
  }
};

export const updateAsset = async (req: Request, res: Response) => {
  try {
    const {
      name,
      category,
      userId,
      date_purchased,
      date_assigned,
      asset_code,
      price,
      status,
      description,
      id,
    } = req.body;
    assetSchema.validate(req.body);
    const hasCategory = category
      ? {
          connect: {
            id: category,
          },
        }
      : undefined;
    const updatedAsset = await prisma.assets.update({
      where: {
        id,
      },
      data: {
        name,
        asset_code,
        category: hasCategory,
        userId,
        date_purchased: date_purchased ? new Date(date_purchased) : undefined,
        description,
        price,
        date_assigned: date_assigned ? new Date(date_assigned) : undefined,
        status,
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

export const listAssetCategory = async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    const assetCategory = await prisma.asset_category.findMany({
      orderBy: {
        id: "desc",
      },
      select: {
        id: true,
        name: true,
        description: true,
      },
    });
    res
      .status(200)
      .json({ message: "Operation Succesful", data: assetCategory });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Something Went Wrong", data: error });
  }
};
export const createAssetCategory = async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    const assetCategory = await prisma.asset_category.create({
      data: {
        name,
        description,
      },
      select: {
        name: true,
        description: true,
      },
    });
    res
      .status(200)
      .json({ message: "Operation Succesful", data: assetCategory });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Something Went Wrong", data: error });
  }
};

export const updateAssetCategory = async (req: Request, res: Response) => {
  try {
    const { id, name, description } = req.body;
    const assetCategory = await prisma.asset_category.update({
      where: {
        id,
      },
      data: {
        name,
        description,
      },
      select: {
        name: true,
        description: true,
      },
    });
    res
      .status(200)
      .json({ message: "Operation Succesful", data: assetCategory });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Something Went Wrong", data: error });
  }
};
export const deleteAssetCategory = async (req: Request, res: Response) => {
  try {
    const { id, name, description } = req.body;
    const assetCategory = await prisma.asset_category.delete({
      where: {
        id,
      },
    });
    res
      .status(200)
      .json({ message: "Operation Succesful", data: assetCategory });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Something Went Wrong", data: error });
  }
};
