import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config();

const zkPath = path.resolve(__dirname, '../../libs/zkteco-js/index.js');
const ZktecoJs = require(zkPath);

interface UserPayload {
  id: number;
  member_id: string;
  name: string;
  password?: string;
}

interface ZKDevice {
  ip: string;
  instance: any;
}

export class ZKTeco {
  private devices: ZKDevice[] = [];

  constructor() {
    const deviceIps = (process.env.ZK_DEVICES || '').split(',').map(ip => ip.trim());

    this.devices = deviceIps.map(ip => ({
      ip,
      instance: new ZktecoJs(ip, 4370, 10000),
    }));
  }

  /**
   * Connects all devices and returns the connected instances
   */
  async connectToDevices(): Promise<ZKDevice[]> {
    const connectedDevices: ZKDevice[] = [];

    for (const device of this.devices) {
      try {
        await device.instance.createSocket();
        console.log(`🔌 Connected to ZKTeco at ${device.ip}`);
        connectedDevices.push(device);
      } catch (err) {
        console.error(`❌ Failed to connect to ${device.ip}:`, err);
      }
    }

    return connectedDevices;
  }

  /**
   * Disconnects all devices
   */
  async disconnectDevices(): Promise<void> {
    for (const device of this.devices) {
      try {
        await device.instance.disconnect();
        console.log(`🔌 Disconnected from ${device.ip}`);
      } catch (err) {
        console.error(`❌ Error disconnecting from ${device.ip}:`, err);
      }
    }
  }

  /**
   * Add a user to all connected devices
   */
  async createUser(user: UserPayload): Promise<boolean[]> {
    const results: boolean[] = [];
    const connectedDevices = await this.connectToDevices();

    for (const device of connectedDevices) {
      try {
        const result = await device.instance.setUser(
          user.id,
          user.member_id,
          user.name,
          user.password || "",
          0,
          0
        );

        if (result) {
          console.log(`✅ User added to device at ${device.ip}`);
          results.push(true);
        } else {
          console.log(`⚠️ Failed to add user to device at ${device.ip}`);
          results.push(false);
        }
      } catch (err) {
        console.error(`❌ Error adding user to ${device.ip}:`, err);
        results.push(false);
      }
    }

    await this.disconnectDevices();
    return results;
  }

  /**
   * Example: Get users from all devices
   */
  async getUsersFromAllDevices(): Promise<any[]> {
    const allUsers: any[] = [];
    const connectedDevices = await this.connectToDevices();

    for (const device of connectedDevices) {
      try {
        const users = await device.instance.getUsers();
        console.log(`👥 Retrieved users from ${device.ip}`);
        allUsers.push({ ip: device.ip, users });
      } catch (err) {
        console.error(`❌ Error retrieving users from ${device.ip}:`, err);
      }
    }

    await this.disconnectDevices();
    return allUsers;
  }

  async getAttendanceFromAllDevices(): Promise<any[]> {
    const connected = await this.connectToDevices();
    const allLogs: any[] = [];

    for (const device of connected) {
      try {
        const logs = await device.instance.getAttendances();
        allLogs.push({ ip: device.ip, logs });
        console.log(`📅 Attendance fetched from ${device.ip}`);
      } catch (err:any) {
        console.error(`❌ Failed to get attendance from ${device.ip}:`, err.message);
      }
    }

    await this.disconnectDevices();
    return allLogs;
  }

  async deleteUserFromAllDevices(uid: number): Promise<boolean[]> {
    const connected = await this.connectToDevices();
    const results: boolean[] = [];

    for (const device of connected) {
      try {
        const result = await device.instance.deleteUser(uid);
        console.log(result
          ? `🗑️ User ${uid} deleted on ${device.ip}`
          : `⚠️ Could not delete user ${uid} on ${device.ip}`);
        results.push(!!result);
      } catch (err:any) {
        console.error(`❌ Error deleting user from ${device.ip}:`, err.message);
        results.push(false);
      }
    }

    await this.disconnectDevices();
    return results;
  }

}
