import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { Workbook as ExcelWorkbook } from "exceljs";

import { prisma } from "../../Models/context";
import { InputValidationError } from "../../utils/custom-error-handlers";
import {
  escapeHtml,
  generatePdfBufferFromHtml,
  getChurchLogoBuffer,
  getChurchLogoDataUri,
  getChurchLogoMimeType,
  slugifyFilePart,
} from "../../utils/documentRenderer";

export const MEETING_EXPORT_FORMATS = ["pdf", "docx", "xlsx"] as const;
export type MeetingExportFormat = (typeof MEETING_EXPORT_FORMATS)[number];

const CONTENT_TYPE_BY_FORMAT: Record<MeetingExportFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export type MeetingExportParams = {
  lifeCenterId: number;
  createdById: number;
  from?: Date;
  to?: Date;
};

export type ExportedFile = {
  buffer: Buffer;
  contentType: string;
  fileName: string;
};

type ExportAttendeeRow = {
  name: string;
  phone: string;
  gender: string;
  type: "First Timer" | "Member";
};

type ExportMeetingRow = {
  date: Date;
  dateLabel: string;
  offeringAmount: number;
  currency: string;
  note: string;
  attendeeCount: number;
  firstTimerCount: number;
  attendees: ExportAttendeeRow[];
};

type MeetingExportPayload = {
  lifeCenterName: string;
  rangeLabel: string;
  fromLabel: string;
  toLabel: string;
  generatedAt: string;
  meetings: ExportMeetingRow[];
  totals: {
    meetings: number;
    attendees: number;
    firstTimers: number;
    /** Offering is summed per currency — a life center may log in more than one. */
    offeringByCurrency: Array<{ currency: string; amount: number }>;
  };
};

const EM_DASH = "—";

const formatDisplayDate = (date: Date): string =>
  date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const toYmd = (date: Date): string => date.toISOString().slice(0, 10);

const formatAmount = (value: number): string =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * Strips the HTML a rich-text note is stored as, so the same plain string can
 * go into a PDF cell, a DOCX run, and a spreadsheet cell without any of them
 * rendering raw markup.
 */
const stripHtml = (value: string | null | undefined): string =>
  String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Parses a `YYYY-MM-DD` boundary into a UTC instant. `from` anchors to the
 * start of the day and `to` to the end of it, so a same-day range still
 * contains that day's meetings.
 */
export const parseRangeBoundary = (
  value: unknown,
  edge: "from" | "to",
): Date | undefined => {
  if (value === undefined || value === null || value === "") return undefined;

  const raw = String(value).trim();
  const ymdMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = ymdMatch
    ? new Date(
        Date.UTC(
          Number(ymdMatch[1]),
          Number(ymdMatch[2]) - 1,
          Number(ymdMatch[3]),
          ...(edge === "from" ? [0, 0, 0, 0] : [23, 59, 59, 999]),
        ),
      )
    : new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    throw new InputValidationError(`${edge} must be a valid date`);
  }
  return parsed;
};

export const parseExportFormat = (value: unknown): MeetingExportFormat => {
  const format = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!MEETING_EXPORT_FORMATS.includes(format as MeetingExportFormat)) {
    throw new InputValidationError(
      `format must be one of ${MEETING_EXPORT_FORMATS.join(", ")}`,
    );
  }
  return format as MeetingExportFormat;
};

export const buildMeetingExportPayload = async (
  params: MeetingExportParams,
): Promise<MeetingExportPayload> => {
  const { lifeCenterId, createdById, from, to } = params;

  if (from && to && from.getTime() > to.getTime()) {
    throw new InputValidationError("from must not be after to");
  }

  const dateFilter = {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };

  const [lifeCenter, meetings] = await Promise.all([
    prisma.life_center.findUnique({
      where: { id: lifeCenterId },
      select: { name: true },
    }),
    prisma.life_center_meeting.findMany({
      // Same scoping as GET /lifecenter/meetings — the export must never
      // widen what the caller can already read in the list.
      where: {
        lifeCenterId,
        createdById,
        ...(from || to ? { date: dateFilter } : {}),
      },
      include: {
        attendees: {
          include: {
            soulWon: {
              select: {
                first_name: true,
                last_name: true,
                contact_number: true,
                country_code: true,
                gender: true,
              },
            },
          },
        },
      },
      orderBy: { date: "desc" },
    }),
  ]);

  if (!lifeCenter) {
    throw new InputValidationError("Life center not found");
  }

  const rows: ExportMeetingRow[] = meetings.map((meeting) => {
    const attendees: ExportAttendeeRow[] = meeting.attendees.map((attendee) => {
      const soul = attendee.soulWon;
      const name =
        [soul?.first_name, soul?.last_name].filter(Boolean).join(" ") || EM_DASH;
      const phone =
        soul?.country_code && soul?.contact_number
          ? `${soul.country_code} ${soul.contact_number}`
          : soul?.contact_number || EM_DASH;
      return {
        name,
        phone,
        gender: soul?.gender || EM_DASH,
        type: attendee.isFirstTimer ? "First Timer" : "Member",
      };
    });

    const firstTimerCount = attendees.filter(
      (a) => a.type === "First Timer",
    ).length;

    return {
      date: meeting.date,
      dateLabel: formatDisplayDate(meeting.date),
      offeringAmount: Number(meeting.offeringAmount),
      currency: meeting.currency,
      note: stripHtml(meeting.note),
      attendeeCount: attendees.length - firstTimerCount,
      firstTimerCount,
      attendees,
    };
  });

  const offeringByCurrency = Array.from(
    rows
      .reduce((acc, row) => {
        acc.set(row.currency, (acc.get(row.currency) ?? 0) + row.offeringAmount);
        return acc;
      }, new Map<string, number>())
      .entries(),
  ).map(([currency, amount]) => ({ currency, amount }));

  const fromLabel = from ? formatDisplayDate(from) : "Beginning";
  const toLabel = to ? formatDisplayDate(to) : "Today";
  const rangeLabel =
    !from && !to ? "All time" : `${fromLabel} ${EM_DASH} ${toLabel}`;

  return {
    lifeCenterName: lifeCenter.name,
    rangeLabel,
    fromLabel,
    toLabel,
    generatedAt: formatDisplayDate(new Date()),
    meetings: rows,
    totals: {
      meetings: rows.length,
      attendees: rows.reduce((sum, row) => sum + row.attendeeCount, 0),
      firstTimers: rows.reduce((sum, row) => sum + row.firstTimerCount, 0),
      offeringByCurrency,
    },
  };
};

/* -------------------------------------------------------------------------- */
/* Spreadsheet                                                                */
/* -------------------------------------------------------------------------- */

const HEADER_FILL = "FF1F3A5F";

const styleHeaderRow = (
  worksheet: ExcelWorkbook["worksheets"][number],
  rowNumber: number,
) => {
  const row = worksheet.getRow(rowNumber);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: HEADER_FILL },
  };
  row.commit();
};

/**
 * exceljs is CommonJS with a large dependency graph, so it loads on demand
 * rather than at process start. Under NodeNext a dynamic `import()` stays a
 * real ESM import, which hangs a CJS module's `module.exports` off `.default`
 * — the `?? mod` arm covers runtimes where cjs-module-lexer instead surfaces
 * the named exports directly.
 */
const loadExcelJs = async (): Promise<typeof import("exceljs")> => {
  const mod = (await import("exceljs")) as unknown as {
    default?: typeof import("exceljs");
  } & typeof import("exceljs");
  return mod.default ?? mod;
};

const renderXlsx = async (payload: MeetingExportPayload): Promise<Buffer> => {
  const ExcelJS = await loadExcelJs();
  const workbook: ExcelWorkbook = new ExcelJS.Workbook();
  workbook.creator = "World Wide Word Ministries";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Meetings");
  summary.columns = [
    { header: "Date", key: "date", width: 16 },
    { header: "Offering", key: "offering", width: 14 },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Attendees", key: "attendees", width: 12 },
    { header: "First timers", key: "firstTimers", width: 14 },
    { header: "Note", key: "note", width: 60 },
  ];
  styleHeaderRow(summary, 1);

  payload.meetings.forEach((meeting) => {
    const row = summary.addRow({
      date: meeting.date,
      offering: meeting.offeringAmount,
      currency: meeting.currency,
      attendees: meeting.attendeeCount,
      firstTimers: meeting.firstTimerCount,
      note: meeting.note,
    });
    row.getCell("date").numFmt = "dd mmm yyyy";
    row.getCell("offering").numFmt = "#,##0.00";
  });

  summary.addRow({});
  const totalsRow = summary.addRow({
    date: "TOTAL",
    offering: payload.totals.offeringByCurrency
      .map((entry) => `${entry.currency} ${formatAmount(entry.amount)}`)
      .join(", "),
    attendees: payload.totals.attendees,
    firstTimers: payload.totals.firstTimers,
  });
  totalsRow.font = { bold: true };

  const roster = workbook.addWorksheet("Attendees");
  roster.columns = [
    { header: "Meeting date", key: "meetingDate", width: 16 },
    { header: "Name", key: "name", width: 30 },
    { header: "Phone", key: "phone", width: 20 },
    { header: "Gender", key: "gender", width: 12 },
    { header: "Type", key: "type", width: 14 },
  ];
  styleHeaderRow(roster, 1);

  payload.meetings.forEach((meeting) => {
    meeting.attendees.forEach((attendee) => {
      const row = roster.addRow({
        meetingDate: meeting.date,
        name: attendee.name,
        phone: attendee.phone,
        gender: attendee.gender,
        type: attendee.type,
      });
      row.getCell("meetingDate").numFmt = "dd mmm yyyy";
    });
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
};

/* -------------------------------------------------------------------------- */
/* Word                                                                       */
/* -------------------------------------------------------------------------- */

const docxCell = (text: string, bold = false) =>
  new TableCell({
    children: [
      new Paragraph({ children: [new TextRun({ text, bold, size: 20 })] }),
    ],
  });

const docxTable = (header: string[], rows: string[][]) =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: header.map((label) => docxCell(label, true)),
      }),
      ...rows.map(
        (cells) =>
          new TableRow({ children: cells.map((cell) => docxCell(cell)) }),
      ),
    ],
  });

const renderDocx = async (payload: MeetingExportPayload): Promise<Buffer> => {
  const logo = getChurchLogoBuffer();
  const children: Array<Paragraph | Table> = [];

  if (logo) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [
          new ImageRun({
            data: logo,
            type: getChurchLogoMimeType() === "image/png" ? "png" : "jpg",
            transformation: { width: 150, height: 123 },
          }),
        ],
      }),
    );
  }

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.HEADING_1,
      children: [
        new TextRun({ text: `${payload.lifeCenterName} — Meetings`, bold: true }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: `${payload.rangeLabel}  •  Generated ${payload.generatedAt}`,
          size: 20,
          color: "666666",
        }),
      ],
    }),
  );

  if (payload.meetings.length === 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "No meetings were recorded in this period.",
            italics: true,
          }),
        ],
      }),
    );
  } else {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { after: 120 },
        children: [new TextRun({ text: "Summary", bold: true })],
      }),
      docxTable(
        ["Date", "Offering", "Attendees", "First timers", "Note"],
        payload.meetings.map((meeting) => [
          meeting.dateLabel,
          `${meeting.currency} ${formatAmount(meeting.offeringAmount)}`,
          String(meeting.attendeeCount),
          String(meeting.firstTimerCount),
          meeting.note || EM_DASH,
        ]),
      ),
      new Paragraph({
        spacing: { before: 160, after: 240 },
        children: [
          new TextRun({
            text: `Totals — ${payload.totals.meetings} meeting(s), ${payload.totals.attendees} attendee(s), ${payload.totals.firstTimers} first timer(s), offering ${
              payload.totals.offeringByCurrency
                .map(
                  (entry) => `${entry.currency} ${formatAmount(entry.amount)}`,
                )
                .join(", ") || EM_DASH
            }`,
            bold: true,
            size: 20,
          }),
        ],
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { after: 120 },
        children: [new TextRun({ text: "Attendee rosters", bold: true })],
      }),
    );

    payload.meetings.forEach((meeting) => {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
          children: [
            new TextRun({
              text: `${meeting.dateLabel} — ${meeting.attendees.length} present`,
              bold: true,
            }),
          ],
        }),
      );

      if (meeting.attendees.length === 0) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: "No attendees recorded.", italics: true }),
            ],
          }),
        );
        return;
      }

      children.push(
        docxTable(
          ["Name", "Phone", "Gender", "Type"],
          meeting.attendees.map((attendee) => [
            attendee.name,
            attendee.phone,
            attendee.gender,
            attendee.type,
          ]),
        ),
      );
    });
  }

  const document = new Document({ sections: [{ children }] });
  return Packer.toBuffer(document);
};

/* -------------------------------------------------------------------------- */
/* PDF                                                                        */
/* -------------------------------------------------------------------------- */

const renderHtml = (payload: MeetingExportPayload): string => {
  const logoDataUri = getChurchLogoDataUri();

  const summaryRows = payload.meetings
    .map(
      (meeting) => `
        <tr>
          <td>${escapeHtml(meeting.dateLabel)}</td>
          <td class="num">${escapeHtml(meeting.currency)} ${escapeHtml(formatAmount(meeting.offeringAmount))}</td>
          <td class="num">${meeting.attendeeCount}</td>
          <td class="num">${meeting.firstTimerCount}</td>
          <td>${escapeHtml(meeting.note || EM_DASH)}</td>
        </tr>`,
    )
    .join("");

  const rosterSections = payload.meetings
    .map((meeting) => {
      const rows = meeting.attendees
        .map(
          (attendee) => `
            <tr>
              <td>${escapeHtml(attendee.name)}</td>
              <td>${escapeHtml(attendee.phone)}</td>
              <td>${escapeHtml(attendee.gender)}</td>
              <td>${escapeHtml(attendee.type)}</td>
            </tr>`,
        )
        .join("");

      return `
        <section class="roster">
          <h3>${escapeHtml(meeting.dateLabel)} <span class="muted">— ${meeting.attendees.length} present</span></h3>
          ${
            meeting.attendees.length
              ? `<table>
                   <thead><tr><th>Name</th><th>Phone</th><th>Gender</th><th>Type</th></tr></thead>
                   <tbody>${rows}</tbody>
                 </table>`
              : `<p class="muted">No attendees recorded.</p>`
          }
        </section>`;
    })
    .join("");

  const offeringTotals =
    payload.totals.offeringByCurrency
      .map((entry) => `${entry.currency} ${formatAmount(entry.amount)}`)
      .join(", ") || EM_DASH;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(payload.lifeCenterName)} — Meetings</title>
    <style>
      * { box-sizing: border-box; }
      /* Chromium applies its dark-mode UA stylesheet when the rendering host
         prefers dark, which inverts unset backgrounds and leaves the dark body
         text unreadable. Pin the scheme and paint the ground explicitly so the
         document renders identically wherever it is generated. */
      :root { color-scheme: light; }
      html, body { background: #ffffff; }
      body {
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
        color: #1f2937;
        font-size: 11px;
        margin: 0;
      }
      header { text-align: center; margin-bottom: 20px; }
      header img { width: 110px; margin-bottom: 6px; }
      h1 { font-size: 18px; margin: 0 0 4px; color: #1f3a5f; }
      h2 { font-size: 13px; margin: 22px 0 8px; color: #1f3a5f; }
      h3 { font-size: 12px; margin: 14px 0 6px; color: #1f3a5f; }
      .muted { color: #6b7280; font-weight: normal; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
      th, td {
        background: #ffffff;
        border: 1px solid #d1d5db;
        padding: 5px 7px;
        text-align: left;
        vertical-align: top;
      }
      th { background: #1f3a5f; color: #fff; font-weight: 600; }
      td.num { text-align: right; white-space: nowrap; }
      tbody tr:nth-child(even) { background: #f9fafb; }
      .totals {
        margin-top: 10px;
        padding: 8px 10px;
        background: #f3f4f6;
        border-radius: 4px;
        font-weight: 600;
      }
      .roster { page-break-inside: avoid; }
      .empty { font-style: italic; color: #6b7280; }
    </style>
  </head>
  <body>
    <header>
      ${logoDataUri ? `<img src="${logoDataUri}" alt="" />` : ""}
      <h1>${escapeHtml(payload.lifeCenterName)} — Meetings</h1>
      <div class="muted">${escapeHtml(payload.rangeLabel)} &bull; Generated ${escapeHtml(payload.generatedAt)}</div>
    </header>

    ${
      payload.meetings.length === 0
        ? `<p class="empty">No meetings were recorded in this period.</p>`
        : `<h2>Summary</h2>
           <table>
             <thead>
               <tr><th>Date</th><th>Offering</th><th>Attendees</th><th>First timers</th><th>Note</th></tr>
             </thead>
             <tbody>${summaryRows}</tbody>
           </table>
           <div class="totals">
             ${payload.totals.meetings} meeting(s) &bull;
             ${payload.totals.attendees} attendee(s) &bull;
             ${payload.totals.firstTimers} first timer(s) &bull;
             Offering ${escapeHtml(offeringTotals)}
           </div>
           <h2>Attendee rosters</h2>
           ${rosterSections}`
    }
  </body>
</html>`;
};

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

export const exportMeetings = async (
  params: MeetingExportParams & { format: MeetingExportFormat },
): Promise<ExportedFile> => {
  const { format, ...query } = params;
  const payload = await buildMeetingExportPayload(query);

  const rangePart =
    !query.from && !query.to
      ? "all-time"
      : `${query.from ? toYmd(query.from) : "start"}-to-${query.to ? toYmd(query.to) : "today"}`;
  const fileName = `${slugifyFilePart(payload.lifeCenterName, "life-center")}-meetings-${rangePart}.${format}`;

  const buffer =
    format === "xlsx"
      ? await renderXlsx(payload)
      : format === "docx"
        ? await renderDocx(payload)
        : await generatePdfBufferFromHtml(renderHtml(payload));

  return { buffer, contentType: CONTENT_TYPE_BY_FORMAT[format], fileName };
};
