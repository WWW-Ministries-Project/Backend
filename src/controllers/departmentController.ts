import { prisma } from "../Models/context";
import { Request, Response } from "express";

export const createDepartment = async (req: Request, res: Response) => {
  const { name, department_head, description, created_by } = req.body;
  try {
    const response = await prisma.department.create({
      data: {
        name,
        department_head,
        description,
        created_by,
      },
    });
    res
      .status(200)
      .json({ message: "Department Created Succesfully", data: response });
  } catch (error: any) {
    return res
      .status(503)
      .json({ message: error, data: "Department failed to create" });
  }
};

export const updateDepartment = async (req: Request, res: Response) => {
  const { id, name, department_head, description, updated_by } = req.body;

  try {
    const response = await prisma.department.update({
      where: {
        id,
      },
      data: {
        name,
        department_head,
        description,
        updated_by,
        updated_at: new Date(),
      },
    });
    res
      .status(200)
      .json({ message: "Department Updated Succesfully", data: response });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Error", data: "Department failed to update" });
  }
};

export const deleteDepartment = async (req: Request, res: Response) => {
  const { id } = req.body;

  try {
    const response = await prisma.department.delete({
      where: {
        id,
      },
    });
    res
      .status(200)
      .json({ message: "Department Deleted Succesfully", data: response });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "error", data: "Department failed to delete" });
  }
};

export const listDepartments = async (req: Request, res: Response) => {
  try {
    const response = await prisma.department.findMany();
    res.status(200).json({ message: "Success", data: response });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "error", data: "Department failed to fetch" });
  }
};

export const getDepartment = async (req: Request, res: Response) => {
  const { id } = req.body;

  try {
    const response = await prisma.department.findUnique({
      where: {
        id,
      },
    });
    res.status(200).json({ message: "Success", data: response });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "error", data: "Department failed to fetch" });
  }
};
