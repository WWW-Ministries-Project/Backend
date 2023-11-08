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
      include: {
        department: {
          select: {
            name: true
          }
        },
        user: {
          select: {
            name: true
          }
        }
      }
    });
    const data = await prisma.position.findMany({
      orderBy: {
        id: "desc"
      },
      include: {
        department: {
          select: {
            name: true
          }
        },
        user: {
          select: {
            name: true,
          }
        }
      }
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
        name,
        department_id,
        description,
        updated_by,
        updated_at: new Date(),
      },
      include: {
        department: {
          select: {
            name: true
          }
        },
        user: {
          select: {
            name: true,
          }
        }
      }
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
  const { id } = req.body;

  try {
    const response = await prisma.position.delete({
      where: {
        id,
      }
    });
    const data = await prisma.position.findMany({
      orderBy: {
        id: "desc"
      },
      include: {
        department: {
          select: {
            name: true
          }
        },
        user: {
          select: {
            name: true,
          }
        }
      }
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
    const response = await prisma.position.findMany(
      {
        orderBy: {
          id: "desc"
        },
        include: {
          department: {
            select: {
              name: true
            }
          },
          user: {
            select: {
              name: true
            }
          }
        }
      }
    );
    res.status(200).json({ message: "Success", data: response });
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
      include: {
        department: {
          select: {
            name: true
          }
        },
        user: {
          select: {
            name: true,
          }
        }
      }
    });
    res.status(200).json({ message: "Success", data: response });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Position failed to fetch", data: error });
  }
};
