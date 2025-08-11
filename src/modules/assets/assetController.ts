import { Request, Response } from "express";
import { assetSchema, toCapitalizeEachWord } from "../../utils";
import { prisma } from "../../Models/context";

export const createAsset = async (req: any, res: any) => {
  try {
    const {
      name,
      department_assigned,
      date_purchased,
      date_assigned,
      price,
      status,
      supplier,
      description,
      created_by,
      photo,
    } = req.body;
    const user_id = req.user?.id;
    assetSchema.validate(req.body);

    const departmentId =
      isNaN(parseInt(department_assigned)) ||
      parseInt(department_assigned) === 0
        ? null
        : parseInt(department_assigned);

    if (
      date_purchased != null &&
      date_assigned != null &&
      new Date(date_assigned) < new Date(date_purchased)
    ) {
      return res.status(400).send({
        message: "An asset cannot be assigned before it is purchased",
      });
    }

    const asset = await prisma.assets.create({
      data: {
        name: toCapitalizeEachWord(name),
        department_assigned: departmentId,
        date_purchased: date_purchased ? new Date(date_purchased) : undefined,
        description,
        price: Number(price),
        date_assigned: date_assigned ? new Date(date_assigned) : undefined,
        status,
        supplier,
        photo,
        created_by: user_id,
      },
    });

    if (asset) {
      const assertwithid = await generateAndSaveAssetId(asset);
      return res.status(200).json({
        message: "Asset created successfully",
        assertwithid,
      });
    }
  } catch (error: any) {
    console.log(error.message);
    return res
      .status(500)
      .json({ message: "Something Went Wrong", data: error });
  }
};

export const updateAsset = async (req: any, res: Response) => {
  try {
    const {
      name,
      department_assigned,
      date_purchased,
      date_assigned,
      price,
      status,
      description,
      supplier,
      id,
      photo,
    } = req.body;
    assetSchema.validate(req.body);
    const user_id = req.user?.id;

    // Check Existance
    const existing = await prisma.assets.findUnique({
      where: {
        id: Number(id),
      },
    });
    if (!existing) {
      return res
        .status(409)
        .json({ message: "Asset does not exist", data: null });
    }
    const updatedAsset = await prisma.assets.update({
      where: {
        id,
      },
      data: {
        name: name ? toCapitalizeEachWord(name) : existing.name,
        department_assigned: department_assigned
          ? Number(department_assigned)
          : existing.department_assigned,
        date_purchased: date_purchased
          ? new Date(date_purchased)
          : existing.date_purchased,
        description: description || existing.description,
        price: price ? Number(price) : existing.price,
        date_assigned: date_assigned
          ? new Date(date_assigned)
          : existing.date_assigned,
        status: status || existing.status,
        supplier: supplier || existing.supplier,
        photo: photo || existing.photo,
        updated_by: user_id,
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
    const { page = 1, limit = 10 }: any = req.query;
    const total = await prisma.assets.count();

    const pageNum = parseInt(page, 10) || 1;
    const pageSize = parseInt(limit, 10) || 10;
    const skip = (pageNum - 1) * pageSize;

    const assetsList = await prisma.assets.findMany({
      orderBy: {
        name: "asc",
      },
      skip,
      take: pageSize,
    });

    res.status(200).json({
      message: "Operation Succesful",
      current_page: pageNum,
      page_size: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: assetsList,
    });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Something Went Wrong", data: error });
  }
};
export const getAsset = async (req: Request, res: Response) => {
  try {
    const { id } = req.query;
    const assetsList = await prisma.assets.findFirst({
      where: {
        id: Number(id),
      },
      include: {
        assigned_to: true,
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
    const { id } = req.query;
    if (!id) return res.status(400).json({ message: "Asset ID not provided" });
    const deletedAsset = await prisma.assets.delete({
      where: {
        id: Number(id),
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

async function generateAndSaveAssetId(asset: any) {
  const prefix = process.env.ID_PREFIX || "WWM-HC-ASSET";
  const year = new Date().getFullYear();
  const paddedId = asset.id.toString().padStart(4, "0");
  const generatedId = `${prefix}-${year}${paddedId}`;

  return await prisma.assets.update({
    where: { id: asset.id },
    data: {
      asset_id: generatedId,
    },
  });
}
