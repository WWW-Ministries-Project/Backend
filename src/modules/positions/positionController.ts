import { prisma } from "../../Models/context";
import { Request, Response } from "express";
import { toCapitalizeEachWord } from "../../utils";

export const createPosition = async (req: Request, res: Response) => {
  const { name, department_id, description, created_by } = req.body;
  try {
    if (!name || name.trim() === "") {
      return res.status(400).json({
        message: "Empty Position name",
        data: null,
      });
    }
    const existing = await prisma.position.findFirst({
      where: {
        AND: [
          { name: toCapitalizeEachWord(name) },
          { department_id: department_id },
        ],
      },
    });
    if (existing) {
      return res.status(400).json({
        message: "Position Name already exist",
        data: null,
      });
    }
    await prisma.position.create({
      data: {
        name: toCapitalizeEachWord(name),
        department_id,
        description,
        created_by,
      },
      include: {
        department: {
          select: {
            name: true,
          },
        },
        user: {
          select: {
            name: true,
          },
        },
      },
    });
    const data = await prisma.position.findMany({
      orderBy: {
        name: "asc",
      },
      select: {
        id: true,
        name: true,
        description: true,
        department: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    res
      .status(200)
      .json({ message: "Position Created Succesfully", data: data });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Position failed to create", data: error });
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
        name: toCapitalizeEachWord(name),
        department_id,
        description,
        is_sync: false, //setting to to out of sync for cron job to sync to device
        updated_by,
        updated_at: new Date(),
      },
      select: {
        id: true,
        name: true,
        description: true,
        department: {
          select: {
            id: true,
            name: true,
            department_head_info: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });
    res
      .status(200)
      .json({ message: "Position Updated Succesfully", data: response });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Position failed to update", data: error });
  }
};

export const deletePosition = async (req: Request, res: Response) => {
  const { id } = req.query;

  try {
    const response = await prisma.position.delete({
      where: {
        id: Number(id),
      },
    });
    const data = await prisma.position.findMany({
      orderBy: {
        id: "desc",
      },
      select: {
        id: true,
        name: true,
        description: true,
        department: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    res
      .status(200)
      .json({ message: "Position Deleted Succesfully", data: data });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Position failed to delete", data: error });
  }
};

export const listPositions = async (req: Request, res: Response) => {
  try {
    const { page = 1, take = 10 }: any = req.query;
    const total = await prisma.position.count();

    const pageNum = parseInt(page, 10) || 1;
    const pageSize = parseInt(take, 10) || 10;
    const skip = (pageNum - 1) * pageSize;
    const response = await prisma.position.findMany({
      orderBy: {
        name: "asc",
      },
      skip,
      take: pageSize,
      select: {
        id: true,
        name: true,
        description: true,
        department: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    res.status(200).json({
      message: "Success",
      current_page: pageNum,
      page_size: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: response,
    });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Positions failed to fetch", data: error });
  }
};
export const listPositionsLight = async (req: Request, res: Response) => {
  try {
    const response = await prisma.position.findMany({
      orderBy: {
        name: "asc",
      },
      select: {
        id: true,
        name: true,
        description: true,
        department: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const data = response?.map((p) => {
      const { department, ...rest } = p; // destructure to remove department
      return {
        ...rest,
        department: department?.name || "No Department",
      };
    });

    res.status(200).json({
      message: "Success",

      data: data,
    });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Positions failed to fetch", data: error });
  }
};

export const getPosition = async (req: Request, res: Response) => {
  const { id } = req.body;

  try {
    const response = await prisma.position.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        name: true,
        description: true,
        department: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    res.status(200).json({ message: "Success", data: response });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Position failed to fetch", data: error });
  }
};
