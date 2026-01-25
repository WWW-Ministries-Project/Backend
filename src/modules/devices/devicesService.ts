import { prisma } from "../../Models/context";

export class DeviceService {
  //create
  async create(data: {
    name: string;
    ip_address: string;
    port: string;
    location: string;
  }) {
    const response = await prisma.devices.create({
      data: {
        device_name: data.name,
        ip_address: data.ip_address,
        port: data.port,
        location: data.location,
      },
    });

    if (response) {
      const response_data = {
        id: response.id,
        name: response.device_name,
        ip_address: response.ip_address,
        location: response.location,
        port: response.port,
      };
      return response_data;
    }

    return null;
  }

  async findAll() {
    const devices = await prisma.devices.findMany();
    return devices.map((device:any) => ({
      id: device.id,
      name: device.device_name,
      ip_address: device.ip_address,
      location: device.location,
      port: device.port,
    }));
  }
  async findOne(id: number) {
    const device = await prisma.devices.findUnique({
      where: { id },
    });

    if (!device) {
      throw new Error("Device not found");
    }

    return {
      id: device.id,
      name: device.device_name,
      ip_address: device.ip_address,
      location: device.location,
      port: device.port,
    };
  }
  async update(
    id: number,
    data: {
      name?: string;
      ip_address?: string;
      port?: string;
      location?: string;
    },
  ) {
    const existing = await prisma.devices.findUnique({ where: { id } });
    if (!existing) {
      throw new Error("Device not found");
    }

    const updated = await prisma.devices.update({
      where: { id },
      data: {
        device_name: data.name,
        ip_address: data.ip_address,
        port: data.port,
        location: data.location,
      },
    });

    return {
      id: updated.id,
      name: updated.device_name,
      ip_address: updated.ip_address,
      location: updated.location,
      port: updated.port,
    };
  }

  // DELETE
  async delete(id: number) {
    const device = await prisma.devices.findUnique({ where: { id } });
    if (!device) {
      throw new Error("Device not found");
    }

    await prisma.devices.delete({ where: { id } });

    return { message: "Device deleted successfully", id };
  }
}
