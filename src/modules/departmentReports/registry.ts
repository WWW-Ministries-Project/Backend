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
  cadence: string;
  /**
   * Permission domain the numbers come from. View lets someone read the
   * report; manage makes them its head of department (commentary, submit).
   */
  domain: string;
  build: ReportBuilder;
}

export const REPORTS: ReportDefinition[] = [
  { key: "membership", area: "Membership", name: "Membership report", cadence: "Monthly", domain: "Membership_Management", build: buildMembership },
  { key: "visitors", area: "Visitors & follow-up", name: "Visitors and follow-up report", cadence: "Weekly, with a monthly roll-up", domain: "Visitors", build: buildVisitors },
  { key: "events", area: "Events", name: "Events report", cadence: "Monthly", domain: "Events", build: buildEvents },
  { key: "attendance", area: "Church attendance", name: "Church attendance report", cadence: "Weekly, with a monthly roll-up", domain: "Church_Attendance", build: buildAttendance },
  { key: "assets", area: "Assets", name: "Assets report", cadence: "Monthly, with a quarterly stock check", domain: "Asset", build: buildAssets },
  { key: "finance", area: "Finance", name: "Finance report", cadence: "Weekly, with monthly, quarterly and annual roll-ups", domain: "Financials", build: buildFinance },
  { key: "lifecenters", area: "Life centers", name: "Life centers report", cadence: "Monthly, with a quarterly roll-up", domain: "Life Center", build: buildLifeCenters },
];

export const REPORT_MAP = new Map(REPORTS.map((r) => [r.key, r]));
