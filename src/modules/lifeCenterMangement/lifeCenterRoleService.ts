import { prisma } from "../../Models/context";
import { LifeCenterHttpError, isProtectedRoleName } from "./lifeCenterHelpers";
import { ensureBuiltInRoles } from "./lifeCenterRoleAssignment";

export class LifeCenterRoleService {
  /**
   * Leader and Member can't be deleted. People holding the role are moved to
   * Member first, in the same transaction.
   */
  async deleteLifeCenterRole(id: number) {
    const role = await prisma.life_center_role.findUnique({ where: { id } });
    if (!role) throw new LifeCenterHttpError(404, "Role not found");
    if (isProtectedRoleName(role.name)) {
      throw new LifeCenterHttpError(400, "The Leader and Member roles can't be deleted.");
    }

    return prisma.$transaction(async (tx) => {
      const builtIn = await ensureBuiltInRoles(tx);
      await tx.life_center_member.updateMany({
        where: { roleId: id },
        data: { roleId: builtIn.member },
      });
      return tx.life_center_role.delete({ where: { id } });
    });
  }

  async createLifeCenterRole(name: string) {
    if (!name) {
      return { error: "name is required" };
    }

    const existingRole = await prisma.life_center_role.findFirst({
      where: {
        name,
      },
    });

    if (existingRole) {
      return { error: "Role already exists" };
    }

    return await prisma.life_center_role.create({
      data: { name },
    });
  }

  /** Each role carries member_count: people holding it across all centers. */
  async getLifeCenterRoles() {
    const roles = await prisma.life_center_role.findMany({
      orderBy: {
        name: "asc",
      },
      include: { _count: { select: { life_center_member: true } } },
    });
    return roles.map(({ _count, ...role }) => ({
      ...role,
      member_count: _count.life_center_member,
    }));
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
