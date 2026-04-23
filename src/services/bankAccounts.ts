import { supabase } from '@/lib/supabase/client';
import type { ServiceResult } from './expenses';
import type { BankAccountRow } from '@/types/database';

export interface BankAccountBalance {
  account: BankAccountRow;
  inflows: number;      // sum of bookings.net_payout with this bank
  outflows: number;     // sum of expenses.amount paid from this bank
  currentBalance: number;
}

export const listBankAccounts = async (): Promise<ServiceResult<BankAccountRow[]>> => {
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('*')
    .order('is_active', { ascending: false })
    .order('name');
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const createBankAccount = async (
  input: Omit<BankAccountRow, 'id' | 'owner_id' | 'created_at'>,
): Promise<ServiceResult<BankAccountRow>> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'No autenticado' };

  const { data, error } = await supabase
    .from('bank_accounts')
    .insert({ ...input, owner_id: user.id })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const updateBankAccount = async (
  id: string,
  patch: Partial<Omit<BankAccountRow, 'id' | 'owner_id' | 'created_at'>>,
): Promise<ServiceResult<BankAccountRow>> => {
  const { data, error } = await supabase
    .from('bank_accounts')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data, error: null };
};

export const deleteBankAccount = async (id: string): Promise<ServiceResult<true>> => {
  const { error } = await supabase.from('bank_accounts').delete().eq('id', id);
  if (error) return { data: null, error: error.message };
  return { data: true, error: null };
};

/**
 * Compute current balance for each account by summing inflows (booking payouts)
 * and outflows (expenses) tied to that account.
 */
export const computeBalances = async (): Promise<ServiceResult<BankAccountBalance[]>> => {
  const accRes = await listBankAccounts();
  if (accRes.error) return { data: null, error: accRes.error };

  const balances: BankAccountBalance[] = [];

  for (const account of accRes.data) {
    // Inflows = sum of net_payout on bookings with this bank
    const { data: inflowData } = await supabase
      .from('bookings')
      .select('net_payout')
      .eq('payout_bank_account_id', account.id);

    const inflows = (inflowData ?? []).reduce(
      (sum: number, row: { net_payout: number | null }) => sum + Number(row.net_payout ?? 0),
      0,
    );

    // Outflows = sum of expenses amount with this bank
    const { data: outflowData } = await supabase
      .from('expenses')
      .select('amount')
      .eq('bank_account_id', account.id);

    const outflows = (outflowData ?? []).reduce(
      (sum: number, row: { amount: number }) => sum + Number(row.amount),
      0,
    );

    balances.push({
      account,
      inflows,
      outflows,
      currentBalance: Number(account.opening_balance) + inflows - outflows,
    });
  }

  return { data: balances, error: null };
};
