import { useMemo } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { CalendarCheck, Pencil, HandCoins, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { getBookingStatus, statusUI } from '@/lib/bookingStatus';
import type { DisplayBooking } from './types';

const helper = createColumnHelper<DisplayBooking>();

interface ColumnHandlers {
  onView: (b: DisplayBooking) => void;
  onEdit: (b: DisplayBooking) => void;
  onPayout: (b: DisplayBooking) => void;
  onDelete: (b: DisplayBooking) => void;
}

export function useBookingsColumns({ onView, onEdit, onPayout, onDelete }: ColumnHandlers) {
  return useMemo<ColumnDef<DisplayBooking, any>[]>(() => [
    helper.accessor('status', {
      header: 'Estado',
      cell: info => {
        const row = info.row.original;
        const derived = getBookingStatus({
          start_date: row.start_date,
          end_date: row.end_date,
          checkin_done: row.checkin_done,
          checkout_done: row.checkout_done,
          status: row.status,
        });
        const ui = statusUI[derived];
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${ui.className}`}
            title={info.getValue() || ui.label}
          >
            {ui.label}
          </span>
        );
      },
    }),
    helper.accessor('guest_name', {
      header: 'Huésped',
      cell: info => {
        const b = info.row.original;
        return (
          <div className="flex flex-col min-w-0 max-w-[180px] sm:max-w-[220px]">
            <span className="font-medium text-slate-800 truncate" title={b.guest_name}>{b.guest_name}</span>
            <span className="font-mono text-[10px] text-slate-400 truncate">
              {b.confirmation_code}{(b.property_name ?? b.listing_name) ? ` · ${b.property_name ?? b.listing_name}` : ''}
            </span>
          </div>
        );
      },
    }),
    helper.accessor('start_date', {
      header: 'Estadía',
      meta: { className: 'whitespace-nowrap' },
      cell: info => {
        const b = info.row.original;
        const fmt = (d: string) => {
          if (!d) return '—';
          const [y, m, day] = d.split('-');
          return `${day}/${m}/${y.slice(2)}`;
        };
        return (
          <div className="flex flex-col text-xs">
            <span className="text-slate-700">{fmt(b.start_date)} → {fmt(b.end_date)}</span>
            <span className="text-slate-400">{b.num_nights} noche{b.num_nights !== 1 ? 's' : ''}</span>
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
    helper.accessor('total_revenue', {
      header: 'Bruto',
      meta: { align: 'right' },
      sortingFn: 'basic',
      cell: info => (
        <span className="font-semibold text-slate-800 whitespace-nowrap">{formatCurrency(info.getValue())}</span>
      ),
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
  ], [onView, onEdit, onPayout, onDelete]);
}
