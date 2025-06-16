import { prisma } from "../../Models/context";

export class LifeCenterRoleService {
  async deleteLifeCenterRole(id: number) {
    return await prisma.life_center_role.delete({
      where: { id },
    });
  }

  async createLifeCenterRole(name: string) {
  if (!name) {
    return { error: "name is required" };
  }

  const existingRole = await prisma.life_center_role.findFirst({
    where: {
      name
    },
  });

  if (existingRole) {
    return { error: "Role already exists" };
  }

  return await prisma.life_center_role.create({
    data: { name },
  });
}

  async getLifeCenterRoles() {
    return await prisma.life_center_role.findMany({});
  }

  async getLifeCenterRoleById(id: number) {
    return await prisma.life_center_role.findFirst({
      where: { id },
    });
  }

  async updateLifeCenterRole(id: number, name: string) {
    const role = await this.getLifeCenterRoleById(id);

    if (role) {
      return await prisma.life_center_role.update({
        where: { id },
        data: {
          name,
        },
      });
    }

    return { error: "Role do not exist for this id" };
  }
}
