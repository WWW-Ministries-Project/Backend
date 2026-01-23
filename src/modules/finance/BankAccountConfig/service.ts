import { prisma } from "../../../Models/context";

interface CreateBankAccountConfigValues {
  name: string;
  description: string;
  percentage: string;
}


export class bankAccountConfigurationService {
  /**
   * Create a new finance config
   */

  async create(data: CreateBankAccountConfigValues) {
    const config = await prisma.bankAccountConfig.create({
      data: {
        name: data.name,
        description: data.description,
        percentage: data.percentage,
      },
    });

    return this.mapResponse(config);
  }

  /**
   * Fetch all finance configs
   */
  async findAll() {
    const configs = await prisma.bankAccountConfig.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return configs.map(this.mapResponse);
  }

  /**
   * Fetch a single finance config by ID
   */
  async findById(id: string) {
    const config = await prisma.bankAccountConfig.findUnique({
      where: { id },
    });

    if (!config) {
      throw new Error('Bank account configuration not found');
    }

    return this.mapResponse(config);
  }

  /**
   * Update a finance config
   */
  async update(id: string, data: Partial<CreateBankAccountConfigValues>) {
    // Ensure record exists
    await this.findById(id);

    const updated = await prisma.bankAccountConfig.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
      },
    });

    return this.mapResponse(updated);
  }

  /**
   * Delete a finance config
   */
  async delete(id: string) {
    // Ensure record exists
    await this.findById(id);

    await prisma.bankAccountConfig.delete({
      where: { id },
    });

    return {
      message: 'Bank account configuration deleted successfully',
      id,
    };
  }

  /**
   * Normalize DB response
   */
  private mapResponse(config: any) {
    return {
      id: config.id,
      name: config.name,
      description: config.description,
      percentage: config.percentage,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }
}