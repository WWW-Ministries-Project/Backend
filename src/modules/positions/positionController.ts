import { prisma } from "../../Models/context";
import { Request, Response } from "express";
import { getRelationBranchScopedWhere } from "../branches/branchService";

export const createPosition = async (req: Request, res: Response) => {
  const { name, department_id, description, created_by } = req.body;
  const actorId = (req as any).user?.id ?? created_by;
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
          { name },
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
        name,
        department_id: department_id != null ? Number(department_id) : department_id,
        description,
        created_by: Number(actorId),
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
      where: getRelationBranchScopedWhere(
        req.query?.branch_id ?? req.body?.branch_id,
        "department",
      ),
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
  const actorId = (req as any).user?.id ?? updated_by;

  try {
    const response = await prisma.position.update({
      where: {
        id: Number(id),
      },
      data: {
        name,
        department_id: department_id != null ? Number(department_id) : department_id,
        description,
        is_sync: false, //setting to to out of sync for cron job to sync to device
        updated_by: actorId != null ? Number(actorId) : actorId,
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
      where: getRelationBranchScopedWhere(req.query?.branch_id, "department"),
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
    const response = await prisma.position.findMany({
      where: getRelationBranchScopedWhere(req.query?.branch_id, "department"),
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

    res.status(200).json({
      message: "Success",
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
      where: getRelationBranchScopedWhere(req.query?.branch_id, "department"),
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
