import { prisma } from "../Models/context";
import { Request, Response } from "express";

export const createAccessLevel = async (req: Request, res: Response) => {
  const { name, description, permissions, created_by } = req.body;
  try {
    const response = await prisma.access_level.create({
      data: {
        name,
        description,
        created_by,
        permissions
      },
    });

    const data = await prisma.access_level.findMany({
      orderBy: {
        id: "desc"
      },
      select: {
        id: true,
        name: true,
        description: true,
        permissions: true,
      }
    });
    res
      .status(200)
      .json({ message: "Access Level Created Succesfully", data: data });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Access Level failed to create", data: error });
  }
};

export const listAllAccessLevel = async (req: Request, res: Response) => {
  const { name, description, permissions, created_by } = req.body;
  try {
    const data = await prisma.access_level.findMany({
      orderBy: {
        id: "desc"
      },
      select: {
        id: true,
        name: true,
        description: true,
        permissions: true,
      }
    });
    res
      .status(200)
      .json({ message: "Operation successful", data: data });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Operation Failed", data: error });
  }
};
