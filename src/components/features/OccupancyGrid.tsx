import { useState, useEffect, useRef, useCallback } from 'react';
import type { ListingRow } from '@/types/database';
import { listPropertiesSlim } from '@/services/properties';
import { listListingsByPropertyIds } from '@/services/listings';
import { listBookingsForOccupancy, type OccupancyBooking } from '@/services/bookings';
import { supabase } from '@/lib/supabase/client';

interface Props {
  from: string;
  to: string;
  propertyIds?: string[];
  totalNights: number;
  availableNights: number;
  occupancyRate: number;  // 0-1
  breakEvenOccupancy: number; // 0-100
  onBookingClick?: (bookingId: string) => void;
}

const CELL_W = 38;
const ROW_H = 44;
const LABEL_W = 140;
const MAX_DAYS = 180; // cap visible window to avoid freeze on "Todo"

const MONTHS_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const DOW_ES = ['D', 'L', 'M', 'X', 'J', 'V', 'S']; // indexed by JS Date.getDay()

type GanttBooking = OccupancyBooking;

interface DayInfo {
  date: Date;
  num: number;
  dow: string;
  isWeekend: boolean;
  isToday: boolean;
}

interface MonthGroup {
  label: string;
  startIdx: number;
  count: number;
}

interface TooltipState {
  booking: GanttBooking;
  x: number;
  y: number;
}

function isoToDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function isCancelled(status: string | null): boolean {
  return (status ?? '').toLowerCase().includes('cancel');
}

function channelColor(channel: string | null, cancelled: boolean): string {
  if (cancelled) return '#94a3b8';
  const ch = (channel ?? '').toLowerCase();
  if (ch.includes('airbnb')) return '#ef4444';
  if (ch.includes('booking')) return '#3b82f6';
  if (ch.includes('vrbo') || ch.includes('homeaway')) return '#0ea5e9';
  if (ch.includes('direct') || ch.includes('directo')) return '#22c55e';
  return '#8b5cf6';
}

function formatIso(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const LEGEND_ITEMS = [
  { label: 'Airbnb', color: '#ef4444' },
  { label: 'Booking.com', color: '#3b82f6' },
  { label: 'VRBO', color: '#0ea5e9' },
  { label: 'Directo', color: '#22c55e' },
  { label: 'Otro', color: '#8b5cf6' },
  { label: 'Cancelada', color: '#94a3b8' },
];

type PropertySlim = { id: string; name: string };

function DragHandle() {
  return (
    <svg
      width="10"
      height="14"
      viewBox="0 0 10 14"
      fill="currentColor"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <circle cx="2.5" cy="2"   r="1.4" />
      <circle cx="7.5" cy="2"   r="1.4" />
      <circle cx="2.5" cy="7"   r="1.4" />
      <circle cx="7.5" cy="7"   r="1.4" />
      <circle cx="2.5" cy="12"  r="1.4" />
      <circle cx="7.5" cy="12"  r="1.4" />
    </svg>
  );
}

export default function OccupancyGrid({
  from,
  to,
  propertyIds,
  totalNights,
  availableNights,
  occupancyRate,
  breakEvenOccupancy,
  onBookingClick,
}: Props) {
  const [properties, setProperties] = useState<PropertySlim[]>([]);
  const [orderedProperties, setOrderedProperties] = useState<PropertySlim[]>([]);
  const [bookingsByProp, setBookingsByProp] = useState<Map<string, GanttBooking[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Drag state ────────────────────────────────────────────────────────────
  const [draggedId, setDraggedId]   = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [userId, setUserId]         = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const storageKey = userId ? `calendar_prop_order_${userId}` : null;

  // Apply saved order when properties change
  useEffect(() => {
    if (!properties.length) return;
    if (!storageKey) { setOrderedProperties(properties); return; }
    try {
      const saved: string[] = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
      if (!saved.length) { setOrderedProperties(properties); return; }
      const propMap = new Map(properties.map(p => [p.id, p]));
      const sorted = saved.filter(id => propMap.has(id)).map(id => propMap.get(id)!);
      // Append any new properties not yet in saved order
      const savedSet = new Set(saved);
      properties.filter(p => !savedSet.has(p.id)).forEach(p => sorted.push(p));
      setOrderedProperties(sorted);
    } catch {
      setOrderedProperties(properties);
    }
  }, [properties, storageKey]);

  const saveOrder = useCallback((ordered: PropertySlim[]) => {
    if (!storageKey) return;
    localStorage.setItem(storageKey, JSON.stringify(ordered.map(p => p.id)));
  }, [storageKey]);

  const handleDrop = useCallback((targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    setOrderedProperties(prev => {
      const fromIdx = prev.findIndex(p => p.id === draggedId);
      const toIdx   = prev.findIndex(p => p.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [removed] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, removed);
      saveOrder(next);
      return next;
    });
    setDraggedId(null);
    setDragOverId(null);
  }, [draggedId, saveOrder]);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDragOverId(null);
  }, []);

  const propIdsKey = propertyIds?.join(',') ?? '';

  // Auto-scroll to today when data loads
  useEffect(() => {
    if (loading || !scrollRef.current) return;
    const todayD = new Date(); todayD.setHours(0, 0, 0, 0);
    const offset = dayDiff(fromDate, todayD);
    if (offset >= 0 && offset < numDays) {
      const targetX = LABEL_W + offset * CELL_W - (scrollRef.current.clientWidth / 2) + CELL_W / 2;
      scrollRef.current.scrollLeft = Math.max(0, targetX);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      // 1. Fetch properties
      const { data: props } = await listPropertiesSlim(propertyIds);

      if (cancelled) return;
      if (!props?.length) {
        setProperties([]);
        setBookingsByProp(new Map());
        setLoading(false);
        return;
      }

      // 2. Fetch listings → build listingId → propertyId map
      const propIds = props.map(p => p.id);
      const { data: listings } = await listListingsByPropertyIds(propIds);

      if (cancelled) return;

      const listingToProp = new Map<string, string>();
      (listings ?? []).forEach((l: Pick<ListingRow, 'id' | 'property_id'>) =>
        listingToProp.set(l.id, l.property_id),
      );
      const listingIds = [...listingToProp.keys()];

      // 3. Fetch bookings overlapping [from, to] — all statuses
      let bookings: GanttBooking[] = [];
      if (listingIds.length) {
        const { data: bkgs } = await listBookingsForOccupancy({ from, to, listingIds });
        bookings = bkgs ?? [];
      }

      // 4. Group bookings by property
      const byProp = new Map<string, GanttBooking[]>();
      props.forEach(p => byProp.set(p.id, []));
      bookings.forEach(bk => {
        const propId = listingToProp.get(bk.listing_id);
        if (propId && byProp.has(propId)) byProp.get(propId)!.push(bk);
      });

      if (!cancelled) {
        setProperties(props);
        setBookingsByProp(byProp);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, propIdsKey]);

  // ── Clamp visible range to MAX_DAYS centered on today ─────────────────────

  const rawFrom = isoToDate(from);
  const rawTo   = isoToDate(to);
  const rawDays = dayDiff(rawFrom, rawTo) + 1;

  let fromDate: Date;
  let toDate: Date;
  let clamped = false;

  if (rawDays > MAX_DAYS) {
    clamped = true;
    // Center on today if it falls within [rawFrom, rawTo], else use rawFrom
    const todayD = new Date(); todayD.setHours(0, 0, 0, 0);
    const center = todayD >= rawFrom && todayD <= rawTo ? todayD : rawFrom;
    const half = Math.floor(MAX_DAYS / 2);
    fromDate = new Date(center.getFullYear(), center.getMonth(), center.getDate() - half);
    if (fromDate < rawFrom) fromDate = new Date(rawFrom);
    toDate   = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + MAX_DAYS - 1);
    if (toDate > rawTo) toDate = new Date(rawTo);
  } else {
    fromDate = rawFrom;
    toDate   = rawTo;
  }

  const numDays = dayDiff(fromDate, toDate) + 1;

  const todayMs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();

  const days: DayInfo[] = [];
  for (let i = 0; i < numDays; i++) {
    const date = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + i);
    const dow = date.getDay();
    days.push({
      date,
      num: date.getDate(),
      dow: DOW_ES[dow],
      isWeekend: dow === 0 || dow === 6,
      isToday: date.getTime() === todayMs,
    });
  }

  const monthGroups: MonthGroup[] = [];
  days.forEach((day, i) => {
    const label = `${MONTHS_ES[day.date.getMonth()]} ${day.date.getFullYear()}`;
    const last = monthGroups[monthGroups.length - 1];
    if (last && last.label === label) {
      last.count++;
    } else {
      monthGroups.push({ label, startIdx: i, count: 1 });
    }
  });

  const totalW = LABEL_W + numDays * CELL_W;
  const overallPct = availableNights > 0
    ? Math.round((totalNights / availableNights) * 100)
    : Math.round(occupancyRate * 100);

  const toDatePlus1 = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate() + 1);

  return (
    <div className="bg-white border rounded-xl shadow-sm overflow-hidden">

      {/* Summary header */}
      <div className="flex items-start justify-between px-6 pt-5 pb-3 gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-bold text-slate-800">Calendario de Ocupacion</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            {totalNights} de {availableNights} noches &mdash;{' '}
            <span className={overallPct >= breakEvenOccupancy ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>
              {overallPct}% ocupado
            </span>
            {clamped && (
              <span className="ml-2 text-amber-600 text-xs font-medium">
                · Mostrando {MAX_DAYS} días centrados en hoy
              </span>
            )}
          </p>
        </div>
        {breakEvenOccupancy > 0 && (
          <div className="flex items-center gap-2 text-xs shrink-0">
            <svg width="24" height="4" viewBox="0 0 24 4" className="shrink-0">
              <line x1="0" y1="2" x2="24" y2="2" stroke="#f59e0b" strokeWidth="2" strokeDasharray="5 3" />
            </svg>
            <span className="text-amber-600 font-semibold">Break-even {breakEvenOccupancy}%</span>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 px-6 pb-3 text-xs">
        {LEGEND_ITEMS.map(item => (
          <div key={item.label} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: item.color }} />
            <span className="text-slate-500">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Grid scroll container */}
      <div
        ref={scrollRef}
        style={{ overflowX: 'auto', position: 'relative' }}
      >
        <div style={{ minWidth: totalW, position: 'relative' }}>

          {/* Sticky header */}
          <div style={{ position: 'sticky', top: 0, zIndex: 20, backgroundColor: 'white' }}>

            {/* Month row */}
            <div style={{ display: 'flex', height: 26, borderBottom: '1px solid #e2e8f0' }}>
              {/* Corner cell */}
              <div style={{
                width: LABEL_W,
                flexShrink: 0,
                position: 'sticky',
                left: 0,
                zIndex: 30,
                backgroundColor: 'white',
                borderRight: '1px solid #e2e8f0',
              }} />
              {monthGroups.map(mg => (
                <div
                  key={mg.label}
                  style={{
                    width: mg.count * CELL_W,
                    flexShrink: 0,
                    paddingLeft: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    borderRight: '1px solid #e2e8f0',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {mg.label}
                </div>
              ))}
            </div>

            {/* Day row */}
            <div style={{ display: 'flex', height: 26, borderBottom: '2px solid #e2e8f0' }}>
              {/* Corner cell */}
              <div style={{
                width: LABEL_W,
                flexShrink: 0,
                position: 'sticky',
                left: 0,
                zIndex: 30,
                backgroundColor: 'white',
                borderRight: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                paddingLeft: 10,
                fontSize: 10,
                color: '#94a3b8',
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}>
                <DragHandle />
                Propiedad
              </div>
              {days.map((day, i) => (
                <div
                  key={i}
                  style={{
                    width: CELL_W,
                    flexShrink: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    lineHeight: 1,
                    gap: 1,
                    color: day.isToday ? '#2563eb' : day.isWeekend ? '#334155' : '#94a3b8',
                    backgroundColor: day.isToday ? '#dbeafe' : day.isWeekend ? '#f1f5f9' : 'white',
                    borderRight: '1px solid #f1f5f9',
                  }}
                >
                  <span>{day.num}</span>
                  <span style={{ fontSize: 9, opacity: 0.75 }}>{day.dow}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              Cargando...
            </div>
          )}

          {/* Empty */}
          {!loading && orderedProperties.length === 0 && (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              No hay propiedades para mostrar en este periodo.
            </div>
          )}

          {/* Property rows */}
          {!loading && orderedProperties.map((prop, ri) => {
            const isDragging = draggedId === prop.id;
            const isDropTarget = dragOverId === prop.id;
            const rowBg = ri % 2 === 0 ? '#f8fafc' : '#ffffff';
            const propBookings = bookingsByProp.get(prop.id) ?? [];

            return (
              <div
                key={prop.id}
                onDragOver={e => { e.preventDefault(); if (!isDragging) setDragOverId(prop.id); }}
                onDragLeave={e => {
                  // Only clear if leaving the row entirely (not entering a child)
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverId(null);
                }}
                onDrop={e => { e.preventDefault(); handleDrop(prop.id); }}
                style={{
                  display: 'flex',
                  height: ROW_H,
                  backgroundColor: isDragging ? 'rgba(248,250,252,0.4)' : rowBg,
                  borderBottom: '1px solid #f1f5f9',
                  borderTop: isDropTarget ? '2px solid #3b82f6' : '1px solid transparent',
                  position: 'relative',
                  opacity: isDragging ? 0.35 : 1,
                  transition: 'opacity 0.15s ease, border-color 0.1s ease',
                }}
              >
                {/* Sticky property label — drag handle */}
                <div
                  draggable
                  onDragStart={e => {
                    setDraggedId(prop.id);
                    // Ghost image: slightly transparent clone
                    const ghost = e.currentTarget.cloneNode(true) as HTMLElement;
                    ghost.style.opacity = '0.85';
                    ghost.style.position = 'fixed';
                    ghost.style.top = '-9999px';
                    document.body.appendChild(ghost);
                    e.dataTransfer.setDragImage(ghost, 70, 20);
                    requestAnimationFrame(() => document.body.removeChild(ghost));
                  }}
                  onDragEnd={handleDragEnd}
                  title="Arrastrar para reordenar"
                  style={{
                    width: LABEL_W,
                    flexShrink: 0,
                    position: 'sticky',
                    left: 0,
                    zIndex: 10,
                    backgroundColor: isDragging ? '#e0e7ff' : isDropTarget ? '#eff6ff' : rowBg,
                    borderRight: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    paddingLeft: 6,
                    paddingRight: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#334155',
                    cursor: 'grab',
                    userSelect: 'none',
                    transition: 'background-color 0.15s ease',
                  }}
                >
                  <span style={{ color: '#cbd5e1', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                    <DragHandle />
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {prop.name}
                  </span>
                </div>

                {/* Day cells + booking blocks */}
                <div style={{ position: 'relative', width: numDays * CELL_W, flexShrink: 0 }}>
                  {/* Day background cells */}
                  {days.map((day, i) => (
                    <div
                      key={i}
                      style={{
                        position: 'absolute',
                        left: i * CELL_W,
                        top: 0,
                        width: CELL_W - 1,
                        height: ROW_H,
                        borderRight: '1px solid #cbd5e1',
                        backgroundColor: day.isToday
                          ? 'rgba(219,234,254,0.35)'
                          : day.isWeekend
                            ? 'rgba(241,245,249,0.6)'
                            : 'transparent',
                      }}
                    />
                  ))}

                  {/* Booking blocks — cancelled rendered first (behind), active on top */}
                  {[...propBookings]
                    .sort((a, b) => {
                      const ac = isCancelled(a.status) ? 0 : 1;
                      const bc = isCancelled(b.status) ? 0 : 1;
                      return ac - bc;
                    })
                    .map(bk => {
                    const bkStart = isoToDate(bk.start_date);
                    const bkEnd = isoToDate(bk.end_date);

                    // Clamp to visible range
                    const clampedStart = bkStart < fromDate ? fromDate : bkStart;
                    const clampedEnd = bkEnd < toDatePlus1 ? bkEnd : toDatePlus1;

                    const startOffset = dayDiff(fromDate, clampedStart);
                    const nightCount = dayDiff(clampedStart, clampedEnd);

                    if (nightCount <= 0 || startOffset >= numDays) return null;

                    const cancelled = isCancelled(bk.status);
                    const color = channelColor(bk.channel, cancelled);

                    return (
                      <div
                        key={bk.id}
                        onMouseEnter={e => setTooltip({ booking: bk, x: e.clientX, y: e.clientY })}
                        onMouseMove={e => setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)}
                        onMouseLeave={() => setTooltip(null)}
                        onClick={() => onBookingClick?.(bk.id)}
                        style={{
                          position: 'absolute',
                          left: startOffset * CELL_W + 2,
                          top: cancelled ? ROW_H - 13 : 4,
                          width: nightCount * CELL_W - 5,
                          height: cancelled ? 9 : ROW_H - 18,
                          backgroundColor: color,
                          borderRadius: cancelled ? 2 : 4,
                          overflow: 'hidden',
                          display: 'flex',
                          alignItems: 'center',
                          paddingLeft: 5,
                          paddingRight: 3,
                          cursor: onBookingClick ? 'pointer' : 'default',
                          zIndex: cancelled ? 1 : 2,
                          ...(cancelled ? {
                            backgroundImage: `repeating-linear-gradient(
                              45deg,
                              transparent,
                              transparent 4px,
                              rgba(255,255,255,0.2) 4px,
                              rgba(255,255,255,0.2) 8px
                            )`,
                          } : {}),
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: 'white',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            ...(cancelled ? { display: 'none' } : {}),
                          }}
                        >
                          {bk.guest_name ?? bk.confirmation_code}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tooltip — flips up when near bottom of viewport */}
      {tooltip && (() => {
        const TOOLTIP_H = 130;
        const TOOLTIP_W = 210;
        const topPos  = tooltip.y + TOOLTIP_H > window.innerHeight  ? tooltip.y - TOOLTIP_H - 8 : tooltip.y - 8;
        const leftPos = tooltip.x + TOOLTIP_W > window.innerWidth   ? tooltip.x - TOOLTIP_W - 8 : tooltip.x + 14;
        return (
          <div
            style={{
              position: 'fixed',
              left: leftPos,
              top:  topPos,
              zIndex: 9999,
              backgroundColor: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
              padding: '8px 12px',
              fontSize: 12,
              minWidth: 190,
              pointerEvents: 'none',
            }}
          >
            <p style={{ fontWeight: 700, color: '#1e293b', marginBottom: 4, whiteSpace: 'nowrap' }}>
              {tooltip.booking.guest_name ?? '—'}
            </p>
            <div style={{ color: '#64748b', lineHeight: 1.7 }}>
              <div style={{ fontFamily: 'monospace', fontSize: 11 }}>{tooltip.booking.confirmation_code}</div>
              <div>{formatIso(tooltip.booking.start_date)} &rarr; {formatIso(tooltip.booking.end_date)}</div>
              <div>{tooltip.booking.channel ?? 'Canal desconocido'}</div>
              <div
                style={{
                  color: isCancelled(tooltip.booking.status) ? '#ef4444' : '#22c55e',
                  fontWeight: 600,
                }}
              >
                {tooltip.booking.status ?? '—'}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
