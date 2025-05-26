import { prisma } from "../../Models/context";
import { ZKTeco } from "../integrationUtils/userIntegration";

export class AtttendanceService {
  async getAttendanceForAllUsers(date: Date) {
    const zteco = new ZKTeco();
    const allUsers = await prisma.user.findMany({
      where: {
        is_user: true,
      },
    });

    const attendanceData: any = await zteco.getAttendanceFromAllDevices();

    // Normalize logs from multiple devices into a single array
    const allLogs = attendanceData.attendance.flatMap(
      (device: { logs: { data: any } }) => device.logs.data,
    );

    // Filter logs that match the date
    const filteredLogs = allLogs.filter(
      (log: { record_time: string | number | Date }) => {
        const logDate = new Date(log.record_time);
        return (
          logDate.getFullYear() === date.getFullYear() &&
          logDate.getMonth() === date.getMonth() &&
          logDate.getDate() === date.getDate()
        );
      },
    );

    // Group logs by user_id
    const userLogsMap = new Map<string, any[]>();
    for (const log of filteredLogs) {
      if (!userLogsMap.has(log.user_id)) {
        userLogsMap.set(log.user_id, []);
      }
      userLogsMap.get(log.user_id)!.push(log);
    }

    // Get check-in and check-out for each user
    const attendanceSummary = [];
    for (const user of allUsers) {
      const logs = userLogsMap.get(user.id?.toString() ?? "");
      if (!logs || logs.length === 0) continue;

      logs.sort(
        (a, b) =>
          new Date(a.record_time).getTime() - new Date(b.record_time).getTime(),
      );

      const checkIn = logs[0].record_time;
      const checkOut = logs[logs.length - 1].record_time;

      attendanceSummary.push({
        user_id: user.id,
        name: user.name,
        checkIn,
        checkOut,
      });
    }

    return attendanceSummary;
  }
}
