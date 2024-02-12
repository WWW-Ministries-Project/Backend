import { Request, Response } from 'express';
import { assetSchema } from '../utils/validator';
import { prisma } from '../Models/context';

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
        } = req.body
        assetSchema.validate(req.body);
        const hasCategory = category ? {
            connect: {
                id: category
            }
        } : undefined
        const asset = await prisma.assets.create({
            data: {
                name,
                asset_code,
                category: hasCategory,
                userId,
                date_purchased: new Date(date_purchased),
                description,
                price,
                date_assigned: new Date(date_assigned),
                status
            }
        });
        res
            .status(200)
            .json({
                message: "Asset created successfully",
                asset
            })
    } catch (error: any) {
        if (error.code === 11000) {
            return res.status(409).send("Operation not successful");
        }
        throw error.message;
    }
}

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
            id
        } = req.body;
        assetSchema.validate(req.body);
        const hasCategory = category ? {
            connect: {
                id: category
            }
        } : undefined
        const updatedAsset = await prisma.assets.update({
            where: {
                id
            },
            data: {
                name,
                asset_code,
                category: hasCategory,
                userId,
                date_purchased: new Date(date_purchased),
                description,
                price,
                date_assigned: new Date(date_assigned),
                status
            }
        });
        res.status(200).json({
            message: "Asset updated successfully",
            updatedAsset
        })
    } catch (error: any) {
        if (error.code === 11000) {
            return res.status(409).send("Operation not successful");
        }
        throw error.message;
    }
}
export const listAssets = async (req: Request, res: Response) => {
    try {
        const assetsList = await prisma.assets.findMany();
        res.status(200).json({ assetsList })
    } catch (error: any) {
        if (error.code === 11000) {
            return res.status(409).send("Operation not successful");
        }
        throw error.message;
    }
}
export const deleteAsset = async (req: Request, res: Response) => {
    try {
        const { id } = req.body;
        if (!id) res.status(400).json({ message: "Asset ID not provided" });
        const deletedAsset = await prisma.assets.delete({
            where: {
                id
            }
        })
        res.status(200).json({ message: "Asset deleted successfully", deletedAsset });
    } catch (error: any) {
        if (error.code === 11000) {
            return res.status(409).send("Operation not successful");
        }
        throw error.message;
    }
}