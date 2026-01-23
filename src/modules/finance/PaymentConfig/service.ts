import { prisma } from "../../../Models/context";

interface CreatePaymentConfigValues {
  name: string;
  description: string;
}


export class paymentConfigurationService {
  /**
   * Create a new finance config
   */

  async create(data: CreatePaymentConfigValues) {
    const config = await prisma.paymentConfig.create({
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
    const configs = await prisma.paymentConfig.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return configs.map(this.mapResponse);
  }

  /**
   * Fetch a single finance config by ID
   */
  async findById(id: string) {
    const config = await prisma.paymentConfig.findUnique({
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
  async update(id: string, data: Partial<CreatePaymentConfigValues>) {
    // Ensure record exists
    await this.findById(id);

    const updated = await prisma.paymentConfig.update({
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

    await prisma.paymentConfig.delete({
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