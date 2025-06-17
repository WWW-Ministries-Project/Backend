import { Request, Response } from "express";
import { LifeCenterRoleService } from "./lifeCenterRoleService";

const roleService = new LifeCenterRoleService();

export class LifeCenterRoleController {
  async createLifeCenterRole(req: Request, res: Response) {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Name is required" });
    }

    const upperName = name.toUpperCase();

    const newRole: any = await roleService.createLifeCenterRole(upperName);

    if (newRole?.error) {
      return res.status(400).json({ message: newRole.error });
    }

    return res.status(201).json({ message: "New Role Added", data: newRole });
  } catch (error: any) {
    return res
      .status(500)
      .json({ message: "Error creating Role", error: error.message });
  }
}

  async getAllLifeCenterRoles(req: Request, res: Response) {
    try {
      const lifeCenterRoles = await roleService.getLifeCenterRoles();
      return res.status(200).json({ data: lifeCenterRoles });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error fetching Life center roles",
        error: error.message,
      });
    }
  }

  async getLifeCenterRoleById(req: Request, res: Response) {
    try {
      const { id } = req.query;

      const role = await roleService.getLifeCenterRoleById(Number(id));
      if (!role) return res.status(404).json({ message: "Role not found" });

      return res.status(200).json({ data: role });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching Role", error: error.message });
    }
  }

  async updateLifeCenterRole(req: Request, res: Response) {
    try {
      const { id } = req.query;
      const { name } = req.body.name;

      const role: any = await roleService.updateLifeCenterRole(
        Number(id),
        name,
      );
      if (role?.error) {
      return res.status(400).json({ message:"", error: role.error });
    }
      return res.status(200).json({ data: role });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching Role", error: error.message });
    }
  }

  async deleteLifeCenterRole(req: Request, res: Response) {
    try {
      const { id } = req.query;
      await roleService.deleteLifeCenterRole(Number(id));
      return res.status(200).json({ message: "Visitor deleted successfully" });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error deleting visitor", error: error.message });
    }
  }
}
