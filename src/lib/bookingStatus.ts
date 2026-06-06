/**
 * Bloque 11 — Estado derivado de reservas.
 *
 * En vez de añadir campos nuevos, deducimos el estado a partir de fechas y flags
 * operativos. Permite mostrar un chip consistente en toda la app sin duplicar
 * lógica.
 */

import { todayISO as todayISOFromUtils } from '@/lib/dateUtils';

export type DerivedBookingStatus =
  | 'cancelled'
  | 'upcoming'          // start_date > today
  | 'checkin_today'     // start_date == today y checkin_done=false (entra hoy, pendiente check-in)
  | 'checkout_today'    // end_date == today y checkout_done=false (sale hoy, pendiente check-out)
  | 'in_progress'       // start_date <= today < end_date (checkin hecho, checkout pendiente)
  | 'completed'         // checkout_done=true (huésped ya hizo check-out)
  | 'past_unverified';  // end_date < today pero checkout_done=false (se quedó sin verificar)

export interface BookingStatusInput {
  start_date?: string | null;
  end_date?: string | null;
  checkin_done?: boolean | null;
  checkout_done?: boolean | null;
  status?: string | null; // texto crudo del CSV (Airbnb): 'Cancelled' / 'Cancelada' / etc.
  cancelled_at?: string | null;
}

const todayISO = (): string => todayISOFromUtils();

export const isCancelled = (b: BookingStatusInput): boolean => {
  if (b.cancelled_at) return true;
  const s = (b.status ?? '').toLowerCase();
  return s.includes('cancel');
};

export const getBookingStatus = (
  b: BookingStatusInput,
  today: string = todayISO(),
): DerivedBookingStatus => {
  if (isCancelled(b)) return 'cancelled';
  const start = b.start_date ?? '';
  const end = b.end_date ?? '';
  // Si el checkout está marcado como hecho, la reserva está completada
  // sin importar si end_date aún está en el futuro (salida anticipada).
  if (b.checkout_done) return 'completed';
  if (start && start > today) return 'upcoming';
  // "Check in hoy": empieza hoy (o llegó tarde) y aún no se ha marcado check-in.
  // Mientras la reserva no haya terminado (end >= today), priorizamos check-in.
  if (start && !b.checkin_done && (!end || today <= end) && start <= today) return 'checkin_today';
  // "Check out hoy": sale hoy y aún no se ha marcado check-out.
  if (end && end === today && !b.checkout_done) return 'checkout_today';
  // Reserva en curso: ya hubo check-in y aún no termina.
  if (start && end && start <= today && today < end) return 'in_progress';
  // end_date pasado sin checkout marcado → sin verificar.
  if (end && end < today) return 'past_unverified';
  return 'past_unverified';
};

export interface StatusUI {
  label: string;
  emoji: string;
  className: string; // tailwind classes para el chip
}

export const statusUI: Record<DerivedBookingStatus, StatusUI> = {
  cancelled:       { label: 'Cancelada',     emoji: '', className: 'bg-red-100 text-red-700 border-red-200' },
  upcoming:        { label: 'Próxima',       emoji: '', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  checkin_today:   { label: 'Check-in hoy',  emoji: '', className: 'bg-sky-100 text-sky-700 border-sky-200' },
  checkout_today:  { label: 'Check-out hoy', emoji: '', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  in_progress:     { label: 'En curso',      emoji: '', className: 'bg-violet-100 text-violet-700 border-violet-200' },
  completed:       { label: 'Completada',    emoji: '', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  past_unverified: { label: 'Sin verificar', emoji: '', className: 'bg-amber-100 text-amber-700 border-amber-200' },
};

/**
 * Indica si una reserva ya empezó (o terminó). Sólo en ese caso tiene sentido
 * registrar daños del inventario o de la propiedad: no podemos cobrarle al
 * huésped algo que aún no ocurrió.
 */
export const hasBookingStarted = (
  b: BookingStatusInput,
  today: string = todayISO(),
): boolean => {
  if (isCancelled(b)) return false;
  const start = b.start_date ?? '';
  return !!start && start <= today;
};

/**
 * Para reservas importadas (Excel/CSV): infiere los flags operativos según las
 * fechas. Pasadas → ya hubo checkin y checkout. Futuras → ambos en false. En
 * curso → checkin_done=true, checkout_done=false.
 */
export const inferOperationalFlags = (
  startDate: string,
  endDate: string,
  today: string = todayISO(),
): { checkin_done: boolean; checkout_done: boolean } => {
  // Fully past (end_date strictly before today): guest has already left.
  if (endDate && endDate < today) {
    return { checkin_done: true, checkout_done: true };
  }
  // Started but not yet fully past — includes:
  //   • checking out today (end_date == today)
  //   • currently in progress (start_date <= today < end_date)
  // checkout_done is intentionally left false so the auto-checkout edge
  // function marks it at the appropriate hour (12:00 local time).
  if (startDate && startDate <= today) {
    return { checkin_done: true, checkout_done: false };
  }
  return { checkin_done: false, checkout_done: false };
};
