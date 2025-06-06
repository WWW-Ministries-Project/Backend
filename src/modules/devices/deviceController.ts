import { Request, Response } from "express";
import { DeviceService } from "./devicesService";

const devices = new DeviceService();

export class DeviceController {
  async createDevices(req: Request, res: Response) {
    try {
      const { name, ip_address, port, location } = req.body;

      
      const data = {
        name,
        ip_address,
        location,
        port,
      };

      const newDevice = await devices.create(data);

      return res.status(201).json({
        message: "Devices added successfully",
        data: newDevice,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error creating device",
        error: error.message,
      });
    }
  }

  async getAllDevices(req: Request, res: Response) {
    try {
      const deviceAll = await devices.findAll();
      return res
        .status(200)
        .json({ message: "Operation sucessful", data: deviceAll });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching devices", error: error.message });
    }
  }

  async getDevicesById(req: Request, res: Response) {
    try {
      const { id } = req.query;

      const device = await devices.findOne(Number(id));
      if (!device)
        return res.status(404).json({ message: "device not found" });

      return res.status(200).json({ data: device });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error fetching devices", error: error.message });
    }
  }

  async updateLifeCenter(req: Request, res: Response) {
    try {
      const id = Number(req.query.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid device ID" });
      }

      const { name, ip_address, port, location } = req.body;


      const data = {
        name,
        ip_address,
        location,
        port,
      };

      const updatedDevices = await devices.update(
        id,
        data,
      );

      return res.status(200).json({
        message: "Life Center updated",
        data: updatedDevices,
      });
    } catch (error: any) {
      return res.status(500).json({
        message: "Error updating Life Center",
        error: error.message,
      });
    }
  }

  async deleteDevices(req: Request, res: Response) {
    try {
      const { id } = req.query;
      await devices.delete(Number(id));
      return res
        .status(200)
        .json({ message: "Device deleted successfully" });
    } catch (error: any) {
      return res
        .status(500)
        .json({ message: "Error deleting device", error: error.message });
    }
  }

}
