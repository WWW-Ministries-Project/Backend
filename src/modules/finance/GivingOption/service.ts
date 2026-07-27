import { prisma } from "../../../Models/context";
import {
  createSubaccount,
  listBanks,
  resolveAccount,
  updateSubaccount,
  type PaystackBank,
} from "../../../libs/paystack/paystackSubaccount";
import { isPaystackFailure } from "../../../libs/paystack/paystackClient";
import {
  getBranchScopedWhere,
  resolveBranchIdOrDefault,
} from "../../branches/branchService";
import { FinanceHttpError, PaginationQuery } from "../common";
import type { GivingOptionPayload } from "./validation";

/**
 * Payments are ROUTED, not split: the whole transaction lands in the giving
 * option's own settlement account and the subaccount bears the Paystack fee.
 * That is what percentage_charge 100 + bearer "subaccount" encodes.
 */
const ROUTING_PERCENTAGE_CHARGE = 100;
const ROUTING_BEARER = "subaccount";

const SELECT_FIELDS = {
  id: true,
  name: true,
  description: true,
  currency: true,
  account_type: true,
  settlement_bank: true,
  bank_name: true,
  account_number: true,
  account_name: true,
  subaccount_code: true,
  percentage_charge: true,
  bearer: true,
  is_active: true,
  archived_at: true,
  paystack_synced_at: true,
  branch_id: true,
  createdAt: true,
  updatedAt: true,
} as const;

type GivingOptionRecord = {
  id: string;
  name: string;
  description: string | null;
  currency: string;
  account_type: string;
  settlement_bank: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  subaccount_code: string | null;
  percentage_charge: number;
  bearer: string;
  is_active: boolean;
  archived_at: Date | null;
  paystack_synced_at: Date | null;
  branch_id: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type GivingOptionEntity = GivingOptionRecord & {
  masked_account_number: string;
  is_synced: boolean;
};

const maskAccountNumber = (accountNumber: string): string => {
  const visible = accountNumber.slice(-4);
  return `${"•".repeat(Math.max(accountNumber.length - 4, 0))}${visible}`;
};

/** Paystack failures are surfaced with their own status codes, unchanged. */
const toFinanceError = (error: unknown, fallback: string): FinanceHttpError => {
  if (error instanceof FinanceHttpError) {
    return error;
  }

  if (isPaystackFailure(error)) {
    return new FinanceHttpError(error.statusCode, error.message);
  }

  return new FinanceHttpError(400, fallback);
};

export class GivingOptionService {
  private mapResponse(record: GivingOptionRecord): GivingOptionEntity {
    return {
      ...record,
      masked_account_number: maskAccountNumber(record.account_number),
      is_synced: record.paystack_synced_at !== null,
    };
  }

  /**
   * Names must be unique per branch, but only among options that are still
   * live. Archiving is a soft delete, so an archived option must not hold its
   * name hostage — hence a service-level check rather than a DB constraint.
   */
  private async ensureNameIsFree(
    name: string,
    branchId: number,
    idToExclude?: string,
  ): Promise<void> {
    const clash = await prisma.givingOption.findFirst({
      where: {
        name,
        branch_id: branchId,
        archived_at: null,
        ...(idToExclude !== undefined && { id: { not: idToExclude } }),
      },
      select: { id: true },
    });

    if (clash) {
      throw new FinanceHttpError(
        409,
        "An active giving option with this name already exists for this branch",
      );
    }
  }

  private async findRecordOrThrow(id: string): Promise<GivingOptionRecord> {
    const record = await prisma.givingOption.findUnique({
      where: { id },
      select: SELECT_FIELDS,
    });

    if (!record) {
      throw new FinanceHttpError(404, "Giving option not found");
    }

    return record;
  }

  async create(
    data: GivingOptionPayload,
    createdBy?: number,
  ): Promise<GivingOptionEntity> {
    const branchId = await resolveBranchIdOrDefault(data.branch_id);
    await this.ensureNameIsFree(data.name, branchId);

    // Paystack first: a giving option without a live subaccount cannot receive
    // money, so there is no point persisting one.
    const subaccount = await createSubaccount(
      {
        business_name: data.name,
        settlement_bank: data.settlement_bank,
        account_number: data.account_number,
        percentage_charge: ROUTING_PERCENTAGE_CHARGE,
        ...(data.description !== undefined && { description: data.description }),
      },
      branchId,
    ).catch((error) => {
      throw toFinanceError(error, "Unable to create the Paystack subaccount");
    });

    try {
      const created = await prisma.givingOption.create({
        data: {
          name: data.name,
          ...(data.description !== undefined && {
            description: data.description,
          }),
          currency: data.currency,
          account_type: data.account_type,
          settlement_bank: data.settlement_bank,
          bank_name: data.bank_name,
          account_number: data.account_number,
          account_name: data.account_name,
          subaccount_code: subaccount.subaccount_code,
          percentage_charge: ROUTING_PERCENTAGE_CHARGE,
          bearer: ROUTING_BEARER,
          paystack_synced_at: new Date(),
          branch_id: branchId,
          ...(createdBy !== undefined && { created_by: createdBy }),
        },
        select: SELECT_FIELDS,
      });

      return this.mapResponse(created);
    } catch (error) {
      // Compensate: deactivate the subaccount we just created so it cannot
      // silently receive payments with no local record behind it.
      await updateSubaccount(
        subaccount.subaccount_code,
        { active: false },
        branchId,
      ).catch(() => undefined);

      throw toFinanceError(error, "Unable to save the giving option");
    }
  }

  async findAll(
    pagination: PaginationQuery,
    branchId?: unknown,
    includeArchived = false,
  ): Promise<{ data: GivingOptionEntity[]; total: number }> {
    const where = {
      ...getBranchScopedWhere(branchId),
      ...(includeArchived ? {} : { archived_at: null }),
    };

    const [total, records] = await Promise.all([
      prisma.givingOption.count({ where }),
      prisma.givingOption.findMany({
        where,
        orderBy: [{ archived_at: "asc" }, { createdAt: "desc" }],
        skip: pagination.skip,
        take: pagination.take,
        select: SELECT_FIELDS,
      }),
    ]);

    return {
      total,
      data: records.map((record) => this.mapResponse(record)),
    };
  }

  async findOne(id: string): Promise<GivingOptionEntity> {
    const record = await this.findRecordOrThrow(id);
    return this.mapResponse(record);
  }

  async update(
    id: string,
    data: GivingOptionPayload,
  ): Promise<GivingOptionEntity> {
    const existing = await this.findRecordOrThrow(id);

    if (existing.archived_at) {
      throw new FinanceHttpError(
        409,
        "Restore this giving option before editing it",
      );
    }

    const branchId =
      data.branch_id !== undefined
        ? await resolveBranchIdOrDefault(data.branch_id)
        : (existing.branch_id ?? (await resolveBranchIdOrDefault(undefined)));

    await this.ensureNameIsFree(data.name, branchId, id);

    // Push to Paystack before touching the DB, so a rejected settlement account
    // never gets persisted as if it were accepted.
    let subaccountCode = existing.subaccount_code;

    if (subaccountCode) {
      await updateSubaccount(
        subaccountCode,
        {
          business_name: data.name,
          settlement_bank: data.settlement_bank,
          account_number: data.account_number,
          percentage_charge: ROUTING_PERCENTAGE_CHARGE,
          ...(data.description !== undefined && {
            description: data.description,
          }),
        },
        branchId,
      ).catch((error) => {
        throw toFinanceError(error, "Unable to update the Paystack subaccount");
      });
    } else {
      // Self-heal: an option that lost its subaccount gets a fresh one instead
      // of staying permanently unable to receive payments.
      const created = await createSubaccount(
        {
          business_name: data.name,
          settlement_bank: data.settlement_bank,
          account_number: data.account_number,
          percentage_charge: ROUTING_PERCENTAGE_CHARGE,
          ...(data.description !== undefined && {
            description: data.description,
          }),
        },
        branchId,
      ).catch((error) => {
        throw toFinanceError(error, "Unable to create the Paystack subaccount");
      });

      subaccountCode = created.subaccount_code;
    }

    try {
      const updated = await prisma.givingOption.update({
        where: { id },
        data: {
          name: data.name,
          description: data.description ?? null,
          currency: data.currency,
          account_type: data.account_type,
          settlement_bank: data.settlement_bank,
          bank_name: data.bank_name,
          account_number: data.account_number,
          account_name: data.account_name,
          subaccount_code: subaccountCode,
          percentage_charge: ROUTING_PERCENTAGE_CHARGE,
          bearer: ROUTING_BEARER,
          paystack_synced_at: new Date(),
          branch_id: branchId,
        },
        select: SELECT_FIELDS,
      });

      return this.mapResponse(updated);
    } catch (error) {
      // Roll Paystack back to what the DB still believes is true.
      if (existing.subaccount_code) {
        await updateSubaccount(
          existing.subaccount_code,
          {
            business_name: existing.name,
            settlement_bank: existing.settlement_bank,
            account_number: existing.account_number,
            percentage_charge: existing.percentage_charge,
          },
          existing.branch_id,
        ).catch(() => undefined);
      } else if (subaccountCode) {
        await updateSubaccount(
          subaccountCode,
          { active: false },
          branchId,
        ).catch(() => undefined);
      }

      throw toFinanceError(error, "Unable to update the giving option");
    }
  }

  /**
   * Soft delete. Paystack has no delete-subaccount endpoint, so the best it can
   * offer is active:false. The local archive is authoritative — a hidden option
   * can never be selected at checkout — so archiving proceeds even when Paystack
   * is unreachable, and paystack_synced_at is cleared to record the drift.
   */
  async archive(id: string): Promise<GivingOptionEntity> {
    const existing = await this.findRecordOrThrow(id);

    if (existing.archived_at) {
      return this.mapResponse(existing);
    }

    let synced = true;

    if (existing.subaccount_code) {
      synced = await updateSubaccount(
        existing.subaccount_code,
        { active: false },
        existing.branch_id,
      )
        .then(() => true)
        .catch(() => false);
    }

    const archived = await prisma.givingOption.update({
      where: { id },
      data: {
        is_active: false,
        archived_at: new Date(),
        paystack_synced_at: synced ? new Date() : null,
      },
      select: SELECT_FIELDS,
    });

    return this.mapResponse(archived);
  }

  /**
   * Restoring is the mirror image and is strict about it: an option that is
   * visible in the UI must actually be able to receive money, so a Paystack
   * failure here aborts the restore.
   */
  async restore(id: string): Promise<GivingOptionEntity> {
    const existing = await this.findRecordOrThrow(id);

    if (!existing.archived_at) {
      return this.mapResponse(existing);
    }

    const branchId =
      existing.branch_id ?? (await resolveBranchIdOrDefault(undefined));

    await this.ensureNameIsFree(existing.name, branchId, id);

    if (existing.subaccount_code) {
      await updateSubaccount(
        existing.subaccount_code,
        { active: true },
        branchId,
      ).catch((error) => {
        throw toFinanceError(
          error,
          "Unable to reactivate the Paystack subaccount",
        );
      });
    }

    const restored = await prisma.givingOption.update({
      where: { id },
      data: {
        is_active: true,
        archived_at: null,
        paystack_synced_at: existing.subaccount_code ? new Date() : null,
      },
      select: SELECT_FIELDS,
    });

    return this.mapResponse(restored);
  }

  async listBanks(
    currency: string,
    branchId?: unknown,
  ): Promise<PaystackBank[]> {
    const scopedBranchId = getBranchScopedWhere(branchId)?.branch_id ?? null;

    return listBanks(currency, scopedBranchId).catch((error) => {
      throw toFinanceError(error, "Unable to load the bank list from Paystack");
    });
  }

  async resolveAccount(
    params: { account_number: string; bank_code: string },
    branchId?: unknown,
  ): Promise<{ account_number: string; account_name: string } | null> {
    const scopedBranchId = getBranchScopedWhere(branchId)?.branch_id ?? null;

    // Best effort by design: Paystack account resolution has patchy coverage in
    // Ghana, and a failed lookup must never block creating a giving option.
    return resolveAccount(params, scopedBranchId).catch(() => null);
  }
}
