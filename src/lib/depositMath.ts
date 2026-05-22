/**
 * Pure deposit balance math — independent of services/supabase so it can be
 * unit-tested without env credentials.
 */
import type { BookingDepositApplicationRow } from '@/types/database';

export interface DepositBalance {
  security_deposit: number;
  returned_amount: number;
  applied_amount: number;
  surplus_amount: number;
  /** Aún retenido (≥ 0). */
  available: number;
  /** Total ya resuelto (devuelto + aplicado + excedente). */
  resolved: number;
}

export const computeDepositBalance = (
  security_deposit: number | null | undefined,
  applications: Pick<BookingDepositApplicationRow, 'kind' | 'amount'>[],
): DepositBalance => {
  const s = Number(security_deposit ?? 0) || 0;
  let r = 0, a = 0, i = 0;
  for (const ap of applications) {
    const v = Number(ap.amount) || 0;
    if (ap.kind === 'returned_to_guest')      r += v;
    else if (ap.kind === 'applied_to_damage') a += v;
    else if (ap.kind === 'surplus_to_income') i += v;
  }
  const resolved = r + a + i;
  return {
    security_deposit: s,
    returned_amount: r,
    applied_amount: a,
    surplus_amount: i,
    available: Math.max(0, s - resolved),
    resolved,
  };
};
