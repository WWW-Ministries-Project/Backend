import { paystackRequest } from "./paystackClient";

export type PaystackSubaccount = {
  id: number;
  subaccount_code: string;
  business_name: string;
  settlement_bank: string;
  account_number: string;
  percentage_charge: number;
  active?: boolean;
};

export type PaystackBank = {
  name: string;
  code: string;
  type: string;
  currency: string;
  active: boolean;
};

export type SubaccountCreateInput = {
  business_name: string;
  settlement_bank: string;
  account_number: string;
  percentage_charge: number;
  description?: string;
};

export type SubaccountUpdateInput = Partial<SubaccountCreateInput> & {
  active?: boolean;
};

export const createSubaccount = (
  input: SubaccountCreateInput,
  branchId?: number | null,
): Promise<PaystackSubaccount> =>
  paystackRequest<PaystackSubaccount>({
    method: "post",
    path: "/subaccount",
    branchId,
    body: input,
  });

export const updateSubaccount = (
  subaccountCode: string,
  input: SubaccountUpdateInput,
  branchId?: number | null,
): Promise<PaystackSubaccount> =>
  paystackRequest<PaystackSubaccount>({
    method: "put",
    path: `/subaccount/${encodeURIComponent(subaccountCode)}`,
    branchId,
    body: input,
  });

export const fetchSubaccount = (
  subaccountCode: string,
  branchId?: number | null,
): Promise<PaystackSubaccount> =>
  paystackRequest<PaystackSubaccount>({
    method: "get",
    path: `/subaccount/${encodeURIComponent(subaccountCode)}`,
    branchId,
  });

type BankCacheEntry = {
  banks: PaystackBank[];
  expiresAt: number;
};

const BANK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const bankCache = new Map<string, BankCacheEntry>();

/**
 * Paystack's bank list is effectively static, so it is cached per currency for
 * a day. Includes mobile money providers (type "mobile_money") alongside banks.
 */
export const listBanks = async (
  currency: string,
  branchId?: number | null,
): Promise<PaystackBank[]> => {
  const normalizedCurrency = currency.trim().toUpperCase();
  const cached = bankCache.get(normalizedCurrency);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.banks;
  }

  const banks = await paystackRequest<PaystackBank[]>({
    method: "get",
    path: "/bank",
    branchId,
    params: {
      currency: normalizedCurrency,
      perPage: 200,
    },
  });

  const usableBanks = (banks || []).filter((bank) => bank.active !== false);

  bankCache.set(normalizedCurrency, {
    banks: usableBanks,
    expiresAt: Date.now() + BANK_CACHE_TTL_MS,
  });

  return usableBanks;
};

export type ResolvedAccount = {
  account_number: string;
  account_name: string;
};

export const resolveAccount = (
  params: { account_number: string; bank_code: string },
  branchId?: number | null,
): Promise<ResolvedAccount> =>
  paystackRequest<ResolvedAccount>({
    method: "get",
    path: "/bank/resolve",
    branchId,
    params: {
      account_number: params.account_number,
      bank_code: params.bank_code,
    },
  });
