import { useState, useMemo, useRef } from 'react';
import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';
import { motion, AnimatePresence } from 'framer-motion';
import { getBookingStatus, statusUI, type DerivedBookingStatus } from '@/lib/bookingStatus';
import { formatCurrency } from '@/lib/utils';
import DataTable from '../DataTable';
import type { DisplayBooking } from './types';
import { BOOKING_COLUMN_ORDER } from './useBookingsColumns';

const INITIAL_ORDER: DerivedBookingStatus[] = [
  'checkout_today',
  'checkin_today',
  'in_progress',
  'upcoming',
  'past_unverified',
  'completed',
  'cancelled',
];

// All sections start collapsed
const DEFAULT_OPEN: Record<DerivedBookingStatus, boolean> = {
  checkout_today: false,
  checkin_today: false,
  in_progress: false,
  upcoming: false,
  past_unverified: false,
  completed: false,
  cancelled: false,
};

interface Props {
  bookings: DisplayBooking[];
  columns: ColumnDef<DisplayBooking, unknown>[];
  loading: boolean;
  onAddBooking: () => void;
}

export default function BookingsStatusAccordion({ bookings, columns, loading, onAddBooking }: Props) {
  const [openSections, setOpenSections] = useState<Record<DerivedBookingStatus, boolean>>(DEFAULT_OPEN);
  const [sectionOrder, setSectionOrder] = useState<DerivedBookingStatus[]>(INITIAL_ORDER);
  const [dragOverStatus, setDragOverStatus] = useState<DerivedBookingStatus | null>(null);
  const draggingStatus = useRef<DerivedBookingStatus | null>(null);

  const grouped = useMemo(() => {
    const groups: Partial<Record<DerivedBookingStatus, DisplayBooking[]>> = {};
    for (const b of bookings) {
      const status = getBookingStatus({
        start_date: b.start_date,
        end_date: b.end_date,
        checkin_done: b.checkin_done,
        checkout_done: b.checkout_done,
        status: b.status,
      });
      if (!groups[status]) groups[status] = [];
      groups[status]!.push(b);
    }
    return groups;
  }, [bookings]);

  const toggle = (status: DerivedBookingStatus) => {
    setOpenSections(prev => ({ ...prev, [status]: !prev[status] }));
  };

  function reorderSections(fromStatus: DerivedBookingStatus, toStatus: DerivedBookingStatus) {
    setSectionOrder(prev => {
      const order = [...prev];
      const from = order.indexOf(fromStatus);
      const to = order.indexOf(toStatus);
      if (from !== -1 && to !== -1) {
        order.splice(from, 1);
        order.splice(to, 0, fromStatus);
      }
      return order;
    });
  }

  if (!loading && bookings.length === 0) {
    return (
      <div className="bg-white border rounded-xl shadow-sm p-16 text-center text-slate-400">
        <div className="text-3xl mb-2">📋</div>
        <p className="font-medium">Sin reservas importadas</p>
        <div className="text-sm mt-2">
          <button onClick={onAddBooking} className="text-blue-600 hover:underline font-medium mr-2">
            + Añadir manualmente
          </button>
          o{' '}
          <a href="/dashboard" className="text-blue-600 hover:underline font-medium">
            importar desde Airbnb →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sectionOrder.map(status => {
        const items = grouped[status] ?? [];
        if (!loading && items.length === 0) return null;

        const ui = statusUI[status];
        const isOpen = openSections[status];
        const isCancelledSection = status === 'cancelled';
        const activeItems = isCancelledSection ? [] : items;
        const sectionNights = activeItems.reduce((s, b) => s + b.num_nights, 0);
        const sectionRevenue = activeItems.reduce((s, b) => s + (b.adjusted_gross ?? b.total_revenue), 0);
        const isDragOver = dragOverStatus === status;

        return (
          <div
            key={status}
            draggable
            onDragStart={() => { draggingStatus.current = status; }}
            onDragOver={e => { e.preventDefault(); setDragOverStatus(status); }}
            onDrop={e => {
              e.preventDefault();
              if (draggingStatus.current && draggingStatus.current !== status) {
                reorderSections(draggingStatus.current, status);
              }
              draggingStatus.current = null;
              setDragOverStatus(null);
            }}
            onDragEnd={() => { draggingStatus.current = null; setDragOverStatus(null); }}
            className={[
              'border rounded-xl shadow-sm overflow-hidden bg-white transition-shadow',
              isDragOver ? 'ring-2 ring-blue-400 shadow-md' : '',
            ].filter(Boolean).join(' ')}
          >
            {/* Accordion header */}
            <div className="flex items-center">
              {/* Drag handle */}
              <div
                className="pl-3 pr-1 py-3.5 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-400 transition-colors shrink-0"
                title="Arrastrar para reordenar"
              >
                <GripVertical className="w-4 h-4" />
              </div>
              <button
                onClick={() => toggle(status)}
                className="flex-1 flex items-center justify-between pr-5 py-3.5 text-left hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isOpen
                    ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                  }
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${ui.className}`}
                  >
                    {ui.label}
                  </span>
                  <span className="text-sm font-medium text-slate-600">
                    {loading ? '…' : `${items.length} reserva${items.length !== 1 ? 's' : ''}`}
                  </span>
                </div>

                {!loading && !isCancelledSection && items.length > 0 && (
                  <div className="flex items-center gap-4 text-xs text-slate-500 mr-1">
                    <span>{sectionNights} noche{sectionNights !== 1 ? 's' : ''}</span>
                    <span className="font-semibold text-slate-700">{formatCurrency(sectionRevenue)}</span>
                  </div>
                )}
              </button>
            </div>

            {/* Collapsible table */}
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key="content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="border-t">
                    <DataTable<DisplayBooking>
                      columns={columns}
                      data={loading ? [] : items}
                      loading={loading}
                      showSearch={false}
                      defaultPageSize={25}
                      skeletonRows={3}
                      initialColumnOrder={[...BOOKING_COLUMN_ORDER]}
                      enableResizing
                      renderFooter={filteredData => {
                        const active = isCancelledSection ? [] : filteredData;
                        const rev = active.reduce((s, b) => s + (b.adjusted_gross ?? b.total_revenue), 0);
                        const net = active.reduce((s, b) => s + (b.net_payout ?? 0), 0);
                        const nights = active.reduce((s, b) => s + b.num_nights, 0);
                        return (
                          <tr className="border-t bg-slate-50">
                            <td className="px-3 py-3 text-xs font-semibold text-slate-600">
                              {filteredData.length} reserva{filteredData.length !== 1 ? 's' : ''}
                            </td>
                            <td />
                            <td className="px-3 py-3 text-xs font-semibold text-slate-500">
                              {nights > 0 ? `${nights} noches` : ''}
                            </td>
                            <td /><td />
                            <td className="px-3 py-3 text-right font-bold text-slate-900 whitespace-nowrap text-xs">
                              {rev > 0 ? formatCurrency(rev) : '—'}
                            </td>
                            <td className="px-3 py-3 text-right font-bold text-emerald-700 whitespace-nowrap text-xs">
                              {net > 0 ? formatCurrency(net) : '—'}
                            </td>
                            <td />
                          </tr>
                        );
                      }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}


