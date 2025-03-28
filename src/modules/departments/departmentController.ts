import { prisma } from "../../Models/context";
import { Request, Response } from "express";
import { toCapitalizeEachWord } from "../../utils";
import { ZKTecoAuth } from "../integrationUtils/authenticationIntegration";
import { ZKTecoDepartment } from "../integrationUtils/departmentIntegration";

export const createDepartment = async (req: Request, res: Response) => {
  const { name, department_head, description, created_by } = req.body;
  try {
    const response = await prisma.department.create({
      data: {
        name: toCapitalizeEachWord(name),
        department_head,
        description,
        created_by,
      },
    });

    saveDepartmentToZTeco(response);

    const data = await prisma.department.findMany({
      orderBy: {
        id: "desc",
      },
      select: {
        id: true,
        name: true,
        description: true,
        department_head_info: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    res
      .status(200)
      .json({ message: "Department Created Succesfully", data: data });
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
        name: toCapitalizeEachWord(name),
        department_head,
        description,
        updated_by,
        updated_at: new Date(),
        is_sync:false,//setting to to out of sync for cron job to sync to device
      },
      // include: {
      //   user: {
      //     select: {
      //       name: true
      //     }
      //   },
      //   position: {
      //     select: {
      //       name: true,
      //     }
      //   },
      // }
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
  const { id } = req.query;

  try {
    const response = await prisma.department.delete({
      where: {
        id: Number(id),
      },
    });
    const data = await prisma.department.findMany({
      orderBy: {
        id: "desc",
      },
      select: {
        id: true,
        name: true,
        description: true,
        department_head_info: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    res
      .status(200)
      .json({ message: "Department Deleted Succesfully", data: data });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "Department failed to delete", data: error });
  }
};

export const listDepartments = async (req: Request, res: Response) => {
  try {
    const response = await prisma.department.findMany({
      orderBy: {
        id: "desc",
      },
      select: {
        id: true,
        name: true,
        description: true,
        department_head_info: {
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
      select: {
        id: true,
        name: true,
        description: true,
        department_head_info: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    if (!response) throw new Error("No Department Found");

    res.status(200).json({ message: "Success", data: response });
  } catch (error) {
    return res
      .status(503)
      .json({ message: "No Department Found", data: error });
  }
};

 const saveDepartmentToZTeco= async (data:any) => {
  const zKTecoAuth = new ZKTecoAuth()
  const zkTeco = new ZKTecoDepartment()
  const authResponse = await zKTecoAuth.userAuthentication();
    if (!authResponse || !authResponse.token) {
      throw new Error("Failed to authenticate with ZKTeco");
    }
    const token = authResponse.token;

    const zktResponse = await zkTeco.createDepartment(
      {
        dept_name: data.name,
        dept_code: data.id.toString(),
      },
      token,
    );

    const updateRes = await prisma.department.update({
      where: { id: data.id },
      data: {
        is_sync: true,
        sync_id: zktResponse.id,
      },
    });

    return updateRes;
}