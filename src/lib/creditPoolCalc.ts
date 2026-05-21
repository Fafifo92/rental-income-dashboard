/**
 * lib/creditPoolCalc.ts
 *
 * Funciones puras de la bolsa de créditos — SIN dependencias de Supabase.
 * Exportadas aquí para ser testables de forma aislada.
 *
 * services/creditPools.ts re-exporta todo desde aquí para mantener la
 * API pública de ese módulo sin cambios.
 */

import type { CreditPoolConsumptionRule, BookingRow, CreditPoolRow } from '@/types/database';

/**
 * Calcula cuántas "unidades" base consume una reserva según la regla del pool.
 * - `per_person_per_night`  → personas × noches
 * - `per_person_per_booking`→ personas (sin importar noches)
 * - `per_booking`           → siempre 1
 */
export const calcUnitsForBooking = (
  booking: Pick<BookingRow, 'num_adults' | 'num_children' | 'num_nights'>,
  rule: CreditPoolConsumptionRule,
  childWeight: number,
): number => {
  const adults  = Math.max(0, booking.num_adults  ?? 1);
  const children = Math.max(0, booking.num_children ?? 0);
  const nights   = Math.max(1, booking.num_nights   ?? 1);
  const people = adults + children * childWeight;
  switch (rule) {
    case 'per_person_per_night':    return people * nights;
    case 'per_person_per_booking':  return people;
    case 'per_booking':             return 1;
  }
};

/** Precio por crédito de una bolsa. Retorna 0 si no hay créditos (evita ÷0). */
export const unitPriceOf = (
  pool: Pick<CreditPoolRow, 'total_price' | 'credits_total'>,
): number => {
  const total = Number(pool.credits_total);
  return total > 0 ? Number(pool.total_price) / total : 0;
};
