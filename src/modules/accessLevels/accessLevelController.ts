import { prisma } from "../../Models/context";
import { Request, Response } from "express";
import { toCapitalizeEachWord } from "../../utils";

// Access Levels Controllers
export const createAccessLevel = async (req: Request, res: Response) => {
  const { name, description, permissions, created_by, assigned_users } =
    req.body;
  try {
    const response = await prisma.access_level.create({
      data: {
        name: toCapitalizeEachWord(name),
        description,
        created_by,
        permissions,
      },
    });

    if (assigned_users) {
      const assignUsers = await prisma.user.updateMany({
        where: {
          id: {
            in: assigned_users,
          },
        },
        data: {
          access_level_id: response.id,
        },
      });
    }

    const data = await prisma.access_level.findMany({
      orderBy: {
        id: "desc",
      },
      select: {
        id: true,
        name: true,
        description: true,
        permissions: true,
        users_assigned: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    
    res
      .status(200)
      .json({ message: "Access Level Created Succesfully", data: data });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Access Level failed to create", data: error.message });
  }
};

export const updateAccessLevel = async (req: Request, res: Response) => {
  const { id, name, description, permissions, created_by, assigned_users } =
    req.body;
  try {
    const response = await prisma.access_level.update({
      where: {
        id: +id,
      },
      data: {
        name,
        description,
        created_by,
        permissions,
      },
      select: {
        id: true,
        name: true,
        description: true,
        permissions: true,
        users_assigned: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (assigned_users) {
      await prisma.user.updateMany({
        where: {
          id: {
            in: assigned_users,
          },
        },
        data: {
          access_level_id: response.id,
        },
      });
    }
    res
      .status(200)
      .json({ message: "Access Level updated Succesfully", data: response });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Access Level failed to create", data: error.message });
  }
};

export const listAllAccessLevel = async (req: Request, res: Response) => {
  try {
    const data = await prisma.access_level.findMany({
      orderBy: {
        id: "desc",
      },
      select: {
        id: true,
        name: true,
        description: true,
        permissions: true,
        users_assigned: {
          select: {
            id: true,
            name: true,
            user_info: {
              select: {
                photo: true,
              },
            },
          },
        },
      },
    });
    res.status(200).json({ message: "Operation successful", data: data });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Operation Failed", data: error.message });
  }
};

export const getAccessLevel = async (req: Request, res: Response) => {
  const { id } = req.query;
  try {
    const data = await prisma.access_level.findFirst({
      where: {
        id: Number(id),
      },
      select: {
        id: true,
        name: true,
        description: true,
        permissions: true,
        users_assigned: {
          select: {
            id: true,
            name: true,
            user_info: {
              select: {
                photo: true,
              },
            },
          },
        },
      },
    });
    res.status(200).json({ message: "Operation successful", data: data });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Operation Failed", data: error.message });
  }
};

export const assignAccessLevelToUser = async (req: Request, res: Response) => {
  const { user_id, access_level_id } = req.body;
  try {
    const assign = await prisma.user.update({
      where: {
        id: +user_id,
      },
      data: {
        access_level_id: +access_level_id,
      },
    });
    if (!assign) {
      res.status(500).json({ message: "Invalid User Id" });
    }
    res.status(200).json({ message: "Operation successful" });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Operation Failed", data: error.message });
  }
};

export const deleteAccessLevel = async (req: Request, res: Response) => {
  const { id } = req.body;
  try {
    const unAssign = await prisma.user.updateMany({
      where: {
        access_level_id: +id,
      },
      data: {
        access_level_id: null,
      },
    });
    const deleteAccess = await prisma.access_level.delete({ where: { id } });
    if (!deleteAccess) {
      res.status(500).json({ message: "Invalid Access Level Id" });
    }
    listAllAccessLevel(req, res);
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Operation Failed", data: error.message });
  }
};
