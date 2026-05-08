import type { BookingAdjustmentKind } from '@/types/database';

export const ADJ_KIND_LABEL: Record<BookingAdjustmentKind, string> = {
  extra_income:    'Ingreso extra',
  discount:        'Descuento',
  damage_charge:   'Cobro por daño',
  platform_refund: 'Reembolso plataforma',
  extra_guest_fee: 'Huésped adicional',
};

export const ADJ_KIND_STYLE: Record<BookingAdjustmentKind, string> = {
  extra_income:    'bg-emerald-100 text-emerald-700',
  discount:        'bg-rose-100 text-rose-700',
  damage_charge:   'bg-amber-100 text-amber-700',
  platform_refund: 'bg-sky-100 text-sky-700',
  extra_guest_fee: 'bg-teal-100 text-teal-700',
};
