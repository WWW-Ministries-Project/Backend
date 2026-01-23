import { prisma } from "../../../Models/context";

interface CreateReceiptConfigValues {
  name: string;
  description: string;
}


export class receiptConfigurationService {
  /**
   * Create a new finance config
   */

  async create(data: CreateReceiptConfigValues) {
    const config = await prisma.receiptConfig.create({
      data: {
        name: data.name,
        description: data.description,
      },
    });

    return this.mapResponse(config);
  }

  /**
   * Fetch all finance configs
   */
  async findAll() {
    const configs = await prisma.receiptConfig.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return configs.map(this.mapResponse);
  }

  /**
   * Fetch a single finance config by ID
   */
  async findById(id: string) {
    const config = await prisma.receiptConfig.findUnique({
      where: { id },
    });

    if (!config) {
      throw new Error('Finance configuration not found');
    }

    return this.mapResponse(config);
  }

  /**
   * Update a finance config
   */
  async update(id: string, data: Partial<CreateReceiptConfigValues>) {
    // Ensure record exists
    await this.findById(id);

    const updated = await prisma.receiptConfig.update({
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

    await prisma.receiptConfig.delete({
      where: { id },
    });

    return {
      message: 'Finance configuration deleted successfully',
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
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }
}