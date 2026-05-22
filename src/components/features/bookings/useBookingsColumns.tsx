import { useMemo } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { CalendarCheck, Pencil, HandCoins, Trash2, LogIn, LogOut, Coins } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { formatDateDisplay } from '@/lib/dateUtils';
import { getBookingStatus } from '@/lib/bookingStatus';
import RegistryStatusIcon, { type RegistryTone } from './RegistryStatusIcon';
import type { DisplayBooking } from './types';

const helper = createColumnHelper<DisplayBooking>();

interface ColumnHandlers {
  onView: (b: DisplayBooking) => void;
  onEdit: (b: DisplayBooking) => void;
  onPayout: (b: DisplayBooking) => void;
  onDelete: (b: DisplayBooking) => void;
  pendingCleaningIds?: Set<string>;
}

/** Orden predeterminado de columnas en la tabla de reservas. */
export const BOOKING_COLUMN_ORDER = [
  'checkin_status',
  'start_date',
  'end_date',
  'guest_name',
  'channel',
  'adjusted_gross',
  'net_payout',
  'actions',
] as const;

export function useBookingsColumns({ onView, onEdit, onPayout, onDelete, pendingCleaningIds }: ColumnHandlers) {
  return useMemo<ColumnDef<DisplayBooking, unknown>[]>(() => [
    // ── Col 1: Estado de check-in / check-out / depósito ───────────────────
    helper.display({
      id: 'checkin_status',
      header: 'Registro',
      meta: { align: 'center' },
      cell: info => {
        const b = info.row.original;
        const derived = getBookingStatus({
          start_date: b.start_date,
          end_date: b.end_date,
          checkin_done: b.checkin_done,
          checkout_done: b.checkout_done,
          status: b.status,
        });
        if (derived === 'cancelled') {
          return <span className="text-slate-300 text-xs select-none">—</span>;
        }

        // ── Depósito: derivar tono + tooltip a partir de campos del row.
        const sec = Number(b.security_deposit ?? 0);
        const applied = Number(b.deposit_applied_amount ?? 0);
        const returned = Number(b.deposit_returned_amount ?? 0);
        const available = Number(b.deposit_available ?? 0);
        let depTone: RegistryTone = 'gray';
        let depTooltip: React.ReactNode = 'Sin depósito de seguridad';
        if (sec > 0) {
          if (applied > 0) {
            // Rojo: se usó (en parte o todo) para daños.
            depTone = 'rose';
            depTooltip = (
              <>
                <div className="font-semibold mb-0.5">Depósito usado para daños</div>
                <div>Aplicado: {formatCurrency(applied)}</div>
                {returned > 0 && <div>Devuelto al huésped: {formatCurrency(returned)}</div>}
                {available > 0 && <div>Retenido aún: {formatCurrency(available)}</div>}
              </>
            );
          } else if (available <= 0) {
            // Verde: cerrado, todo devuelto (sin daños).
            depTone = 'emerald';
            depTooltip = (
              <>
                <div className="font-semibold mb-0.5">Depósito devuelto</div>
                <div>{formatCurrency(returned || sec)} devueltos al huésped</div>
                {b.deposit_return_date && (
                  <div className="text-slate-300">el {formatDateDisplay(b.deposit_return_date)}</div>
                )}
              </>
            );
          } else {
            // Amarillo: recibido, pendiente de devolución.
            depTone = 'amber';
            depTooltip = (
              <>
                <div className="font-semibold mb-0.5">Depósito retenido</div>
                <div>{formatCurrency(available)} pendiente de devolución</div>
                {returned > 0 && <div className="text-slate-300">(ya devuelto: {formatCurrency(returned)})</div>}
              </>
            );
          }
        }

        return (
          <div className="flex items-center justify-center gap-1.5">
            <RegistryStatusIcon
              Icon={LogIn}
              tone={b.checkin_done ? 'emerald' : 'gray'}
              label={`Check-in: ${b.checkin_done ? 'completado' : 'pendiente'}`}
              tooltip={
                <>
                  <div className="font-semibold mb-0.5">
                    Check-in {b.checkin_done ? 'completado' : 'pendiente'}
                  </div>
                  <div className="text-slate-300">{formatDateDisplay(b.start_date)}</div>
                </>
              }
            />
            <RegistryStatusIcon
              Icon={LogOut}
              tone={b.checkout_done ? 'emerald' : 'gray'}
              label={`Check-out: ${b.checkout_done ? 'completado' : 'pendiente'}`}
              tooltip={
                <>
                  <div className="font-semibold mb-0.5">
                    Check-out {b.checkout_done ? 'completado' : 'pendiente'}
                  </div>
                  <div className="text-slate-300">{formatDateDisplay(b.end_date)}</div>
                </>
              }
            />
            <RegistryStatusIcon
              Icon={Coins}
              tone={depTone}
              label="Estado del depósito de seguridad"
              tooltip={depTooltip}
            />
          </div>
        );
      },
    }),
    // ── Col 2: Check-in ────────────────────────────────────────────────────
    helper.accessor('start_date', {
      header: 'Check-in',
      meta: { className: 'whitespace-nowrap' },
      cell: info => (
        <span className="text-sm text-slate-700">{formatDateDisplay(info.getValue())}</span>
      ),
    }),
    // ── Col 3: Check-out ───────────────────────────────────────────────────
    helper.accessor('end_date', {
      header: 'Check-out',
      meta: { className: 'whitespace-nowrap' },
      cell: info => {
        const b = info.row.original;
        return (
          <div className="flex flex-col text-xs">
            <span className="text-slate-700">{formatDateDisplay(b.end_date)}</span>
            <span className="text-slate-400">{b.num_nights} noche{b.num_nights !== 1 ? 's' : ''}</span>
          </div>
        );
      },
    }),
    // ── Col 4: Huésped ─────────────────────────────────────────────────────
    helper.accessor('guest_name', {
      header: 'Huésped',
      cell: info => {
        const b = info.row.original;
        const hasPendingCleaning = pendingCleaningIds?.has(b.id) ?? false;
        return (
          <div className="flex flex-col min-w-0 max-w-[180px] sm:max-w-[220px]">
            <span className="font-medium text-slate-800 truncate" title={b.guest_name}>{b.guest_name}</span>
            <div className="flex items-center gap-1 flex-wrap mt-0.5">
              <span className="font-mono text-[10px] text-slate-400 truncate">
                {b.confirmation_code}{(b.property_name ?? b.listing_name) ? ` · ${b.property_name ?? b.listing_name}` : ''}
              </span>
              {hasPendingCleaning && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700 whitespace-nowrap shrink-0">
                  🧹 Aseo pendiente
                </span>
              )}
            </div>
          </div>
        );
      },
    }),
    helper.accessor('channel', {
      header: 'Canal',
      meta: { align: 'center' },
      cell: info => {
        const c = (info.getValue() || 'airbnb').toLowerCase();
        const styles: Record<string, string> = {
          airbnb:  'bg-rose-50 text-rose-700 border-rose-200',
          booking: 'bg-blue-50 text-blue-700 border-blue-200',
          vrbo:    'bg-amber-50 text-amber-700 border-amber-200',
          direct:  'bg-emerald-50 text-emerald-700 border-emerald-200',
        };
        const label: Record<string, string> = { airbnb: 'Airbnb', booking: 'Booking', vrbo: 'Vrbo', direct: 'Directo', other: 'Otro' };
        return (
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${styles[c] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
            {label[c] ?? c}
          </span>
        );
      },
    }),
    helper.accessor('adjusted_gross', {
      header: 'Bruto',
      meta: { align: 'right' },
      sortingFn: 'basic',
      cell: info => {
        const v = info.getValue() ?? info.row.original.total_revenue;
        return <span className="font-semibold text-slate-800 whitespace-nowrap">{formatCurrency(v)}</span>;
      },
    }),
    helper.accessor('net_payout', {
      header: 'Neto al banco',
      meta: { align: 'right' },
      sortingFn: 'basic',
      cell: info => {
        const v = info.getValue();
        if (v === null || v === undefined) return <span className="text-slate-300 text-xs">—</span>;
        const n = Number(v);
        return n < 0
          ? <span className="font-semibold text-rose-600 whitespace-nowrap">−{formatCurrency(Math.abs(n))}</span>
          : <span className="font-semibold text-emerald-700 whitespace-nowrap">{formatCurrency(n)}</span>;
      },
    }),
    helper.display({
      id: 'actions',
      header: '',
      cell: info => {
        const b = info.row.original;
        if (b.isDemo) return null;
        const hasPayout = b.net_payout !== null && b.net_payout !== undefined;
        const isCancelledNegative = b.status.toLowerCase().includes('cancel') && b.total_revenue < 0;
        return (
          <div className="flex items-center gap-1 justify-end whitespace-nowrap">
            <button
              onClick={() => onView(b)}
              title="Ver detalle de reserva"
              aria-label="Ver detalle"
              className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
            >
              <CalendarCheck className="w-4 h-4" />
            </button>
            <button
              onClick={() => onEdit(b)}
              title="Editar reserva"
              aria-label="Editar reserva"
              className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
            >
              <Pencil className="w-4 h-4" />
            </button>
            {isCancelledNegative ? (
              <button
                onClick={() => onPayout(b)}
                title="Registrar cuenta de débito de multa"
                aria-label="Cuenta de débito"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-md border transition-colors bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
              >
                <HandCoins className="w-3.5 h-3.5" />
                Débito
              </button>
            ) : (
              <button
                onClick={() => onPayout(b)}
                title={hasPayout ? 'Editar payout real' : 'Registrar payout real'}
                aria-label="Payout de reserva"
                className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-md border transition-colors ${
                  hasPayout
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-blue-300 hover:text-blue-700'
                }`}
              >
                <HandCoins className="w-3.5 h-3.5" />
                Payout
              </button>
            )}
            <button
              onClick={() => onDelete(b)}
              title="Eliminar reserva"
              aria-label="Eliminar reserva"
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      },
    }),
  ], [onView, onEdit, onPayout, onDelete, pendingCleaningIds]);
}
