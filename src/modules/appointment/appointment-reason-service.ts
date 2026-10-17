import { prisma } from "../../Models/context";
import {
  InputValidationError,
  NotFoundError,
} from "../../utils/custom-error-handlers";
import {
  ReasonCreateInput,
  ReasonUpdateInput,
  SerializedReason,
  findDuplicateLabel,
  serializeReason,
} from "./appointment-reason-validation";

const REASON_ORDER = [{ sort_order: "asc" as const }, { id: "asc" as const }];

/*
  The duplicate check compares in JS rather than trusting the column
  collation: the list is small (admin-curated), and this keeps the
  case-insensitive rule true whatever collation the table ends up with.
*/
const assertLabelAvailable = async (label: string, ignoreId?: number) => {
  const existing = await prisma.appointment_reason.findMany({
    select: { id: true, label: true },
  });
  if (findDuplicateLabel(label, existing, ignoreId)) {
    throw new InputValidationError("A reason with this label already exists");
  }
};

const findReasonOrThrow = async (id: number) => {
  const reason = await prisma.appointment_reason.findUnique({ where: { id } });
  if (!reason) throw new NotFoundError("Appointment reason not found");
  return reason;
};

export class AppointmentReasonService {
  /** Active reasons, as members see them when booking. */
  static async listActive(): Promise<SerializedReason[]> {
    const rows = await prisma.appointment_reason.findMany({
      where: { is_active: true },
      orderBy: REASON_ORDER,
    });
    return rows.map(serializeReason);
  }

  /** Every reason, including inactive ones, for the admin screen. */
  static async listAll(): Promise<SerializedReason[]> {
    const rows = await prisma.appointment_reason.findMany({
      orderBy: REASON_ORDER,
    });
    return rows.map(serializeReason);
  }

  static async create(input: ReasonCreateInput): Promise<SerializedReason> {
    await assertLabelAvailable(input.label);
    const last = await prisma.appointment_reason.aggregate({
      _max: { sort_order: true },
    });
    const sortOrder =
      last._max.sort_order === null ? 0 : last._max.sort_order + 1;
    const row = await prisma.appointment_reason.create({
      data: { ...input, sort_order: sortOrder },
    });
    return serializeReason(row);
  }

  static async update(
    id: number,
    input: ReasonUpdateInput,
  ): Promise<SerializedReason> {
    await findReasonOrThrow(id);
    if (input.label !== undefined) await assertLabelAvailable(input.label, id);
    const row = await prisma.appointment_reason.update({
      where: { id },
      data: input,
    });
    return serializeReason(row);
  }

  static async remove(id: number): Promise<SerializedReason> {
    const reason = await findReasonOrThrow(id);
    await prisma.appointment_reason.delete({ where: { id } });
    return serializeReason(reason);
  }

  /** Sets sort_order to each id's index. Every id must exist. */
  static async reorder(ids: number[]): Promise<SerializedReason[]> {
    const found = await prisma.appointment_reason.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      const known = new Set(found.map((row) => row.id));
      const missing = ids.filter((id) => !known.has(id));
      throw new NotFoundError(
        `Appointment reason not found: ${missing.join(", ")}`,
      );
    }

    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.appointment_reason.update({
          where: { id },
          data: { sort_order: index },
        }),
      ),
    );

    return AppointmentReasonService.listAll();
  }
}
