import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listPendingRecurringForOwner, type PendingRecurring } from '@/services/recurringPeriods';
import { getNotificationSettings } from '@/services/notificationSettings';
import { isSupabaseConfigured } from '@/services/auth';
import { formatCurrency } from '@/lib/utils';
import { formatDateDisplay } from '@/lib/dateUtils';
import { listBookingAlerts, type BookingAlert } from '@/services/bookings';
import { getUpcomingAndOverdueSchedules } from '@/services/maintenanceSchedules';
import { getEndOfLifeItems } from '@/services/inventory';
import type { MaintenanceScheduleRow, InventoryItemRow } from '@/types/database';

const ymLabel = (ym: string): string => {
  const [y, m] = ym.split('-');
  const names = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${names[Number(m) - 1]} ${y.slice(2)}`;
};

const ISSUE_LABEL: Record<string, string> = {
  checkout:  'Checkout por confirmar',
  inventory: 'Inventario por revisar',
  payout:    'Liquidación pendiente',
  cleaning:  'Aseo pendiente',
};

const fmtDate = (iso: string): string => formatDateDisplay(iso);

export default function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingRecurring[]>([]);
  const [bookingAlerts, setBookingAlerts] = useState<BookingAlert[]>([]);
  const [maintAlerts, setMaintAlerts] = useState<MaintenanceScheduleRow[]>([]);
  const [eolItems, setEolItems] = useState<InventoryItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured()) { setLoading(false); return; }
    let cancelled = false;
    const refresh = async () => {
      const settings = await getNotificationSettings();
      if (cancelled) return;
      if (settings.data && !settings.data.reminders_enabled) {
        setEnabled(false);
        setLoading(false);
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const [recurringRes, alertsRes, maintRes, eolRes] = await Promise.all([
        listPendingRecurringForOwner(6),
        listBookingAlerts(45),
        getUpcomingAndOverdueSchedules(),
        getEndOfLifeItems(),
      ]);
      if (cancelled) return;
      if (!recurringRes.error) setPending(recurringRes.data ?? []);
      if (!alertsRes.error) setBookingAlerts(alertsRes.data ?? []);
      if (!maintRes.error) {
        // Show overdue + schedules within notify_before_days window
        const relevant = (maintRes.data ?? []).filter(s => {
          const daysUntil = (new Date(s.scheduled_date).getTime() - new Date(today).getTime()) / 86_400_000;
          return daysUntil <= (s.notify_before_days ?? 3);
        });
        setMaintAlerts(relevant);
      }
      if (!eolRes.error) setEolItems(eolRes.data ?? []);
      setLoading(false);
    };
    refresh();
    const onChange = () => refresh();
    const onFocus = () => refresh();
    window.addEventListener('recurring-period-changed', onChange);
    window.addEventListener('maintenance-changed', onChange);
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('recurring-period-changed', onChange);
      window.removeEventListener('maintenance-changed', onChange);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  if (!isSupabaseConfigured() || !enabled) return null;

  const count = pending.length;
  const overdueCount = pending.filter(p => !p.isCurrentMonth).length;
  const alertCount = bookingAlerts.length;
  const cleaningCount = bookingAlerts.filter(a => a.issues.includes('cleaning')).length;
  const maintCount = maintAlerts.length;
  const eolCount = eolItems.length;
  const totalCount = count + alertCount + maintCount + eolCount;
  const today = new Date().toISOString().slice(0, 10);
  const maintOverdueCount = maintAlerts.filter(s => s.scheduled_date <= today).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label="Pendientes"
        className="relative p-2 rounded-full hover:bg-slate-100 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0a3 3 0 11-6 0" />
        </svg>
        {!loading && totalCount > 0 && (
          <span className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white rounded-full ${
            (overdueCount > 0 || maintOverdueCount > 0 || eolCount > 0) ? 'bg-rose-600' : 'bg-amber-500'
          }`}>
            {totalCount > 99 ? '99+' : totalCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-10 z-20 w-80 bg-white border border-slate-200 rounded-xl shadow-xl py-1 max-h-[70vh] overflow-y-auto"
            >
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-800">Pendientes</p>
                  <p className="text-xs text-slate-500">
                    {totalCount === 0
                      ? 'Todo al día ✓'
                      : [
                          count > 0 && `${count} recurrente${count > 1 ? 's' : ''}${overdueCount > 0 ? ` (${overdueCount} atrasado${overdueCount > 1 ? 's' : ''})` : ''}`,
                          alertCount > 0 && `${alertCount} reserva${alertCount > 1 ? 's' : ''} por completar`,
                          cleaningCount > 0 && `${cleaningCount} aseo${cleaningCount > 1 ? 's' : ''} pendiente${cleaningCount > 1 ? 's' : ''}`,
                          maintCount > 0 && `${maintCount} mantenimiento${maintCount > 1 ? 's' : ''} pendiente${maintCount > 1 ? 's' : ''}`,
                          eolCount > 0 && `${eolCount} ítem${eolCount > 1 ? 's' : ''} con vida útil cumplida`,
                        ].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <a href="/notificaciones" className="text-xs text-blue-600 hover:underline">⚙ Config</a>
              </div>

              {loading ? (
                <div className="p-4">
                  <div className="h-4 bg-slate-100 rounded animate-pulse mb-2" />
                  <div className="h-4 bg-slate-100 rounded animate-pulse w-3/4" />
                </div>
              ) : totalCount === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-500">
                  Sin pendientes. ¡Todo al día! 🎉
                </div>
              ) : (
                <>
                  {/* ── Vida útil cumplida ── */}
                  {eolCount > 0 && (
                    <>
                      <div className="px-4 pt-3 pb-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-purple-500">Vida útil cumplida</p>
                      </div>
                      <ul>
                        {eolItems.slice(0, 6).map(item => (
                          <li key={item.id} className="border-b border-slate-50 last:border-0">
                            <a href={`/inventory?item=${item.id}`} className="block px-4 py-2.5 hover:bg-slate-50">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-slate-800 truncate">{item.name}</div>
                                  <div className="text-xs text-slate-500">
                                    {item.expected_lifetime_months ? `${item.expected_lifetime_months} meses de vida útil` : 'Vida útil agotada'}
                                  </div>
                                </div>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-purple-100 text-purple-700">
                                  reemplazar
                                </span>
                              </div>
                            </a>
                          </li>
                        ))}
                        {eolCount > 6 && (
                          <li className="px-4 py-2 text-xs text-slate-400 text-center">
                            +{eolCount - 6} más… revisa en inventario.
                          </li>
                        )}
                      </ul>
                    </>
                  )}
                  {/* ── Alertas de reservas ── */}
                  {alertCount > 0 && (
                    <>
                      <div className="px-4 pt-3 pb-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Reservas por completar</p>
                      </div>
                      <ul>
                        {bookingAlerts.slice(0, 8).map(a => (
                          <li key={a.id} className="border-b border-slate-50 last:border-0">
                            <a href={`/bookings?booking=${a.id}`} className="block px-4 py-2.5 hover:bg-slate-50">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-slate-800 truncate">
                                    {a.guest_name ?? a.confirmation_code}
                                  </div>
                                  <div className="text-xs text-slate-500">
                                    Checkout: {fmtDate(a.end_date)}
                                  </div>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {a.issues.map(issue => (
                                      <span key={issue} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${issue === "cleaning" ? "bg-cyan-100 text-cyan-700" : "bg-rose-100 text-rose-700"}`}>
                                        {ISSUE_LABEL[issue]}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </a>
                          </li>
                        ))}
                        {alertCount > 8 && (
                          <li className="px-4 py-2 text-xs text-slate-400 text-center">
                            +{alertCount - 8} más… revisa en /reservas.
                          </li>
                        )}
                      </ul>
                    </>
                  )}

                  {/* ── Mantenimientos pendientes ── */}
                  {maintCount > 0 && (
                    <>
                      <div className="px-4 pt-3 pb-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Mantenimientos de inventario</p>
                      </div>
                      <ul>
                        {maintAlerts.slice(0, 8).map(s => {
                          const isOverdue = s.scheduled_date <= today;
                          return (
                            <li key={s.id} className="border-b border-slate-50 last:border-0">
                              <a href={`/inventory?schedule=${s.id}`} className="block px-4 py-2.5 hover:bg-slate-50">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium text-slate-800 truncate">🔧 {s.title}</div>
                                    <div className="text-xs text-slate-500">
                                      {isOverdue ? 'Vencido' : 'Vence'}: {fmtDate(s.scheduled_date)}
                                      {s.is_recurring && <span className="ml-1 text-amber-600">· recurrente</span>}
                                    </div>
                                  </div>
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                                    isOverdue ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                                  }`}>
                                    {isOverdue ? 'vencido' : 'próximo'}
                                  </span>
                                </div>
                              </a>
                            </li>
                          );
                        })}
                        {maintCount > 8 && (
                          <li className="px-4 py-2 text-xs text-slate-400 text-center">
                            +{maintCount - 8} más… revisa en inventario.
                          </li>
                        )}
                      </ul>
                    </>
                  )}

                  {/* ── Recurrentes pendientes ── */}
                  {count > 0 && (
                    <>
                      <div className="px-4 pt-3 pb-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Gastos recurrentes</p>
                      </div>
                      <ul>
                        {pending.slice(0, 12).map((p, i) => (
                          <li key={`${p.recurring.id}-${p.yearMonth}-${i}`} className="border-b border-slate-50 last:border-0">
                            <a href={`/expenses?recurring=${p.recurring.id}&ym=${p.yearMonth}`} className="block px-4 py-2.5 hover:bg-slate-50">
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-slate-800 truncate">{p.recurring.category}</div>
                                  <div className="text-xs text-slate-500 truncate">
                                    {formatCurrency(Number(p.recurring.amount))} · {ymLabel(p.yearMonth)}
                                  </div>
                                </div>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${
                                  p.isCurrentMonth ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
                                }`}>
                                  {p.isCurrentMonth ? 'mes actual' : 'atrasado'}
                                </span>
                              </div>
                            </a>
                          </li>
                        ))}
                        {pending.length > 12 && (
                          <li className="px-4 py-2 text-xs text-slate-400 text-center">
                            +{pending.length - 12} más… resuélvelos en cada propiedad.
                          </li>
                        )}
                      </ul>
                    </>
                  )}
                </>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
