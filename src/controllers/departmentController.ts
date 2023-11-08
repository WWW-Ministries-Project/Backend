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
      include: {
        user: true,
        position: true,
        user_departments: true
      }
    });
    res
      .status(200)
      .json({ message: "Department Created Succesfully", data: response });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Department failed to create", data: error });
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
      include: {
        user: true,
        position: true,
        user_departments: true
      }
    });
    res
      .status(200)
      .json({ message: "Department Updated Succesfully", data: response });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Department failed to update", data: error });
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
      .json({ message: "Department failed to delete", data: error });
  }
};

export const listDepartments = async (req: Request, res: Response) => {
  try {
    const response = await prisma.department.findMany({
      include: {
        position: true,
        user: true,
        user_departments: true
      }
    });
    res.status(200).json({ message: "Success", data: response });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Department failed to fetch", data: error });
  }
};

export const getDepartment = async (req: Request, res: Response) => {
  const { id } = req.body;

  try {
    const response = await prisma.department.findUnique({
      where: {
        id,
      },
      include: {
        position: true,
        user: true,
        user_departments: true
      }
    });
    res.status(200).json({ message: "Success", data: response });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Department failed to fetch", data: error });
  }
};
