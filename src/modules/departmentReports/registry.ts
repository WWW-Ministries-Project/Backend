import { buildAssets } from "./aggregators/assets";
import { buildAttendance } from "./aggregators/attendance";
import { buildEvents } from "./aggregators/events";
import { buildFinance } from "./aggregators/finance";
import { buildLifeCenters } from "./aggregators/lifecenters";
import { buildMembership } from "./aggregators/membership";
import { buildVisitors } from "./aggregators/visitors";
import { ReportBuilder, ReportKey } from "./types";

export interface ReportDefinition {
  key: ReportKey;
  area: string;
  name: string;
  /** Who prepares it, shown until someone has written the commentary. */
  hod_role: string;
  cadence: string;
  /**
   * Permission domain the numbers come from. View lets someone read the
   * report; manage makes them its head of department (commentary, submit).
   */
  domain: string;
  build: ReportBuilder;
}

export const REPORTS: ReportDefinition[] = [
  { key: "membership", area: "Membership", name: "Membership report", hod_role: "Membership HOD", cadence: "Monthly", domain: "Membership_Management", build: buildMembership },
  { key: "visitors", area: "Visitors & follow-up", name: "Visitors and follow-up report", hod_role: "Visitors HOD", cadence: "Weekly, with a monthly roll-up", domain: "Visitors", build: buildVisitors },
  { key: "events", area: "Events", name: "Events report", hod_role: "Events HOD", cadence: "Monthly", domain: "Events", build: buildEvents },
  { key: "attendance", area: "Church attendance", name: "Church attendance report", hod_role: "Ushering HOD", cadence: "Weekly, with a monthly roll-up", domain: "Church_Attendance", build: buildAttendance },
  { key: "assets", area: "Assets", name: "Assets report", hod_role: "Logistics HOD", cadence: "Monthly, with a quarterly stock check", domain: "Asset", build: buildAssets },
  { key: "finance", area: "Finance", name: "Finance report", hod_role: "Treasurer", cadence: "Weekly, with monthly, quarterly and annual roll-ups", domain: "Financials", build: buildFinance },
  { key: "lifecenters", area: "Life centers", name: "Life centers report", hod_role: "Evangelism HOD", cadence: "Monthly, with a quarterly roll-up", domain: "Life Center", build: buildLifeCenters },
];

export const REPORT_MAP = new Map(REPORTS.map((r) => [r.key, r]));
