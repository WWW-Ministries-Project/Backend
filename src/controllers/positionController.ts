import { prisma } from "../Models/context";
import { Request, Response } from "express";

export const createPosition = async (req: Request, res: Response) => {
  const { name, department_id, description, created_by } = req.body;
  try {
    const response = await prisma.position.create({
      data: {
        name,
        department_id,
        description,
        created_by,
      },
    });
    res
      .status(200)
      .json({ message: "Position Created Succesfully", data: response });
  } catch (error) {
    return res
      .status(503)
      .json({ status: "error", data: "Position failed to create" });
  }
};

export const updatePosition = async (req: Request, res: Response) => {
  const { id, name, department_id, description, updated_by } = req.body;

  try {
    const response = await prisma.position.update({
      where: {
        id,
      },
      data: {
        name,
        department_id,
        description,
        updated_by,
        updated_at: new Date(),
      },
    });
    res
      .status(200)
      .json({ message: "Position Updated Succesfully", data: response });
  } catch (error) {
    return res
      .status(503)
      .json({ status: "error", data: "Position failed to update" });
  }
};

export const deletePosition = async (req: Request, res: Response) => {
  const { id } = req.body;

  try {
    const response = await prisma.position.delete({
      where: {
        id,
      },
    });
    res
      .status(200)
      .json({ message: "Position Deleted Succesfully", data: response });
  } catch (error) {
    return res
      .status(503)
      .json({ status: "error", data: "Position failed to delete" });
  }
};

export const listPositions = async (req: Request, res: Response) => {
  try {
    const response = await prisma.position.findMany();
    res.status(200).json({ message: "Success", data: response });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "error", data: "Positions failed to fetch" });
  }
};

export const getPosition = async (req: Request, res: Response) => {
  const { id } = req.body;

  try {
    const response = await prisma.position.findUnique({
      where: {
        id,
      },
    });
    res.status(200).json({ message: "Success", data: response });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "error", data: "Position failed to fetch" });
  }
};
