/**
 * OccupancyByProperty
 *
 * Stacked bar chart:
 *   X-axis = time buckets (days / weeks / months matching the selected period)
 *   Y-axis = number of properties occupied (0 → total property count)
 *   Each stack segment = a property group, colored with the group's color
 *   A property is "occupied" in a bucket if it has at least 1 non-cancelled
 *   booking overlapping that bucket.
 *
 * "Sin grupo" properties share a neutral color.
 */
import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import type { ChartGranularity } from '@/services/financial';
import { listPropertiesSlim } from '@/services/properties';
import { getPropertyGroupsByIds } from '@/services/propertyGroups';
import { listListingsByPropertyIds } from '@/services/listings';
import { listBookingsForOccupancy } from '@/services/bookings';

interface Props {
  granularity: ChartGranularity;
  from: string;
  to: string;
  propertyIds?: string[];
  breakEvenOccupancy: number; // 0-100, for reference line
}

import { resolveColor } from './PropertiesClient';

const NO_GROUP_COLOR = '#94a3b8'; // slate-400 for ungrouped
const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function isoToDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function weekStart(d: Date): Date {
  const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = dt.getDay();
  dt.setDate(dt.getDate() - (day === 0 ? 6 : day - 1));
  return dt;
}

function dateFmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthFmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface Bucket {
  key: string;
  label: string;
  start: Date;
  end: Date; // exclusive
}

function buildBuckets(from: string, to: string, granularity: ChartGranularity): Bucket[] {
  const fromDate = isoToDate(from);
  const toDate = isoToDate(to);
  const buckets: Bucket[] = [];

  if (granularity === 'day') {
    const cur = new Date(fromDate);
    while (cur <= toDate) {
      const label = `${cur.getDate()} ${MONTHS_ES[cur.getMonth()]}`;
      const next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
      buckets.push({ key: dateFmt(cur), label, start: new Date(cur), end: next });
      cur.setDate(cur.getDate() + 1);
    }
  } else if (granularity === 'week') {
    const cur = weekStart(fromDate);
    let weekNum = 1;
    while (cur <= toDate) {
      const next = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 7);
      const label = `Sem ${weekNum} ${MONTHS_ES[cur.getMonth()]}`;
      buckets.push({ key: dateFmt(cur), label, start: new Date(cur), end: next });
      cur.setDate(cur.getDate() + 7);
      weekNum++;
    }
  } else {
    const cur = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
    const endMonth = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
    while (cur <= endMonth) {
      const yr2 = String(cur.getFullYear() % 100).padStart(2, '0');
      const label = `${MONTHS_ES[cur.getMonth()]} ${yr2}`;
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      buckets.push({ key: monthFmt(cur), label, start: new Date(cur), end: next });
      cur.setMonth(cur.getMonth() + 1);
    }
  }
  return buckets;
}

/** True if a booking overlaps [bucketStart, bucketEnd) */
function overlaps(bucketStart: Date, bucketEnd: Date, bkStart: Date, bkEnd: Date): boolean {
  return bkStart < bucketEnd && bkEnd > bucketStart;
}

interface Group {
  id: string;   // real group id or '__none__'
  name: string;
  color: string;
}

type ChartDataRow = Record<string, string | number | string[]>;

// ── Tooltip ───────────────────────────────────────────────────────────────────

interface TooltipEntry { name: string; value: number; color: string; dataKey: string; payload: ChartDataRow }
interface TTProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  totalProperties: number;
  coordinate?: { x: number; y: number };
  viewBox?: { x: number; y: number; width: number; height: number };
}

function CustomTooltip({ active, payload, label, totalProperties, coordinate, viewBox }: TTProps) {
  if (!active || !payload?.length) return null;
  const entries = payload.filter(p => p.value > 0);
  const total = entries.reduce((s, p) => s + p.value, 0);
  const pct = totalProperties > 0 ? Math.round((total / totalProperties) * 100) : 0;

  // For bar charts: default to above the coordinate (bars grow from bottom, space is above).
  // Only drop below if very near the top of the chart area.
  const nearTop = coordinate && viewBox && coordinate.y < viewBox.y + viewBox.height * 0.25;
  const flipX   = coordinate && viewBox && coordinate.x > viewBox.x + viewBox.width  * 0.55;

  const transform = [
    flipX ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
    nearTop ? 'translateY(8px)' : 'translateY(calc(-100% - 8px))',
  ].join(' ');

  return (
    <div
      style={{
        background: '#ffffff',
        transform,
        zIndex: 9999,
        boxShadow: '0 4px 24px 0 rgba(15,23,42,0.13), 0 1px 4px 0 rgba(15,23,42,0.08)',
        borderRadius: 12,
        border: '1px solid #e2e8f0',
        padding: '12px 14px',
        minWidth: 200,
        maxWidth: 290,
        fontSize: 13,
        pointerEvents: 'none',
      }}
    >
      <p style={{ fontWeight: 700, color: '#1e293b', marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
        {total} de {totalProperties} propiedades · {pct}% ocupación
      </p>
      {entries.map(p => {
        const namesKey = `_names_${p.dataKey}`;
        const names: string[] = (p.payload[namesKey] as string[] | undefined) ?? [];
        return (
          <div key={p.dataKey} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#475569', fontWeight: 600, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flexShrink: 0, display: 'inline-block' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{p.name}</span>
              </span>
              <span style={{ fontWeight: 700, color: '#1e293b', flexShrink: 0 }}>{p.value}</span>
            </div>
            {names.length > 0 && (
              <ul style={{ margin: '3px 0 0 14px', padding: 0, listStyle: 'none' }}>
                {names.map(n => (
                  <li key={n} style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    · {n}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface BookingRaw {
  start_date: string;
  end_date: string;
  listing_id: string;
}

interface OccupancyStats {
  mostOccupied: { name: string; buckets: number } | null;
  leastOccupied: { name: string; buckets: number } | null;
  totalBuckets: number;
}

export default function OccupancyByProperty({ granularity, from, to, propertyIds, breakEvenOccupancy }: Props) {
  const [mounted, setMounted]       = useState(false);
  const [chartData, setChartData]   = useState<ChartDataRow[]>([]);
  const [groups, setGroups]         = useState<Group[]>([]);
  const [totalProps, setTotalProps] = useState(0);
  const [stats, setStats]           = useState<OccupancyStats>({ mostOccupied: null, leastOccupied: null, totalBuckets: 0 });
  const [loading, setLoading]       = useState(true);

  useEffect(() => setMounted(true), []);

  const propIdsKey = propertyIds?.join(',') ?? '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      // 1. Properties + their group_id
      const { data: props } = await listPropertiesSlim(propertyIds);
      if (cancelled) return;
      if (!props?.length) {
        setGroups([]); setChartData([]); setTotalProps(0); setLoading(false);
        return;
      }
      type PropRow = { id: string; name: string; group_id: string | null };
      const propArr = props as PropRow[];

      // Build id → name map for tooltip and stats
      const propNameMap = new Map<string, string>();
      for (const p of propArr) propNameMap.set(p.id, p.name);

      // 2. Property groups
      const uniqueGroupIds = Array.from(new Set(propArr.map(p => p.group_id).filter(Boolean))) as string[];
      const groupMap = new Map<string, Group>(); // id → Group
      if (uniqueGroupIds.length) {
        const { data: gRows } = await getPropertyGroupsByIds(uniqueGroupIds);
        for (const g of (gRows ?? [])) {
          groupMap.set(g.id, { id: g.id, name: g.name, color: resolveColor(g.color) });
        }
      }
      if (cancelled) return;

      // Assign each property to its group (or the synthetic "Sin grupo" group)
      const propToGroup = new Map<string, Group>();
      let hasUngrouped = false;
      for (const p of propArr) {
        if (p.group_id && groupMap.has(p.group_id)) {
          propToGroup.set(p.id, groupMap.get(p.group_id)!);
        } else {
          hasUngrouped = true;
          propToGroup.set(p.id, { id: '__none__', name: 'Sin grupo', color: NO_GROUP_COLOR });
        }
      }

      // Build ordered group list (for Bar rendering + Legend)
      const orderedGroups: Group[] = [...groupMap.values()];
      if (hasUngrouped) orderedGroups.push({ id: '__none__', name: 'Sin grupo', color: NO_GROUP_COLOR });

      // 3. Listings → property map
      const propIds = propArr.map(p => p.id);
      const { data: listings } = await listListingsByPropertyIds(propIds);
      if (cancelled) return;

      const listingToProp = new Map<string, string>(); // listingId → propertyId
      for (const l of (listings ?? [])) {
        listingToProp.set(l.id, l.property_id);
      }
      const listingIds = [...listingToProp.keys()];

      // 4. Bookings overlapping [from, to], exclude cancelled
      let bookings: BookingRaw[] = [];
      if (listingIds.length) {
        const { data: bkgs } = await listBookingsForOccupancy({ from, to, listingIds, excludeCancelled: true });
        bookings = (bkgs ?? []) as BookingRaw[];
      }
      if (cancelled) return;

      // 5. Build buckets and count DISTINCT properties occupied per group per bucket
      const buckets = buildBuckets(from, to, granularity);

      // Track per-property bucket occupation count for stats
      const propOccupancyCount = new Map<string, number>(); // propId → buckets occupied
      for (const p of propArr) propOccupancyCount.set(p.id, 0);

      const data: ChartDataRow[] = buckets.map(bucket => {
        // For this bucket, which properties have at least 1 booking overlapping?
        const occupiedProps = new Set<string>();
        for (const bk of bookings) {
          const propId = listingToProp.get(bk.listing_id);
          if (!propId) continue;
          const bkStart = isoToDate(bk.start_date);
          const bkEnd   = isoToDate(bk.end_date); // checkout = not occupied
          if (overlaps(bucket.start, bucket.end, bkStart, bkEnd)) {
            occupiedProps.add(propId);
          }
        }

        // Count occupied properties per group, tracking names
        const row: ChartDataRow = { bucket: bucket.label };
        for (const g of orderedGroups) {
          row[g.id] = 0;
          row[`_names_${g.id}`] = [];
        }

        for (const propId of occupiedProps) {
          const group = propToGroup.get(propId);
          if (group) {
            row[group.id] = (row[group.id] as number) + 1;
            const nameList = row[`_names_${group.id}`] as string[];
            const propName = propNameMap.get(propId) ?? propId;
            nameList.push(propName);
          }
          propOccupancyCount.set(propId, (propOccupancyCount.get(propId) ?? 0) + 1);
        }
        return row;
      });

      // Compute most/least occupied property
      let mostOccupied: { name: string; buckets: number } | null = null;
      let leastOccupied: { name: string; buckets: number } | null = null;
      for (const p of propArr) {
        const count = propOccupancyCount.get(p.id) ?? 0;
        const entry = { name: p.name, buckets: count };
        if (!mostOccupied || count > mostOccupied.buckets) mostOccupied = entry;
        if (!leastOccupied || count < leastOccupied.buckets) leastOccupied = entry;
      }

      if (!cancelled) {
        setGroups(orderedGroups);
        setChartData(data);
        setTotalProps(propArr.length);
        setStats({ mostOccupied, leastOccupied, totalBuckets: buckets.length });
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, propIdsKey, granularity]);

  if (loading) {
    return (
      <div className="bg-white border rounded-xl shadow-sm p-6 h-72 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!chartData.length || !groups.length) {
    return (
      <div className="bg-white border rounded-xl shadow-sm p-6 h-48 flex items-center justify-center text-slate-400 text-sm">
        Sin datos de ocupación para el período seleccionado.
      </div>
    );
  }

  // Break-even reference in absolute property count
  const breakEvenCount = breakEvenOccupancy > 0
    ? Math.round((breakEvenOccupancy / 100) * totalProps)
    : 0;

  return (
    <div className="p-6 bg-white border rounded-xl shadow-sm">
      <div className="flex items-start justify-between mb-3 gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-bold text-slate-800">Ocupación por grupo</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Propiedades ocupadas por período · total {totalProps} propiedad{totalProps !== 1 ? 'es' : ''}
          </p>
        </div>
        {breakEvenOccupancy > 0 && (
          <div className="flex items-center gap-2 text-xs shrink-0">
            <svg width="20" height="4" viewBox="0 0 20 4">
              <line x1="0" y1="2" x2="20" y2="2" stroke="#f59e0b" strokeWidth="2" strokeDasharray="5 3" />
            </svg>
            <span className="text-amber-600 font-semibold">Break-even {breakEvenOccupancy}%</span>
          </div>
        )}
      </div>

      {/* Occupancy stats: most & least occupied */}
      {(stats.mostOccupied || stats.leastOccupied) && (
        <div className="flex gap-3 mb-4 flex-wrap">
          {stats.mostOccupied && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 text-xs min-w-0">
              <span className="w-1 self-stretch rounded-full bg-emerald-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-emerald-800 font-semibold truncate max-w-[160px]">{stats.mostOccupied.name}</p>
                <p className="text-emerald-500 mt-0.5">
                  Más ocupada · {stats.mostOccupied.buckets}/{stats.totalBuckets} períodos
                </p>
              </div>
            </div>
          )}
          {stats.leastOccupied && stats.mostOccupied?.name !== stats.leastOccupied.name && (
            <div className="flex items-center gap-2 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 text-xs min-w-0">
              <span className="w-1 self-stretch rounded-full bg-rose-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-rose-800 font-semibold truncate max-w-[160px]">{stats.leastOccupied.name}</p>
                <p className="text-rose-400 mt-0.5">
                  Menos ocupada · {stats.leastOccupied.buckets}/{stats.totalBuckets} períodos
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="h-64 w-full">
        {mounted && (
        <ResponsiveContainer width="100%" height="100%" minHeight={0} minWidth={0}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis
              dataKey="bucket"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#64748b', fontSize: 11 }}
              dy={8}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#64748b', fontSize: 11 }}
              allowDecimals={false}
              domain={[0, totalProps]}
              label={{ value: 'Propiedades', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 10, fill: '#94a3b8' } }}
            />
            {breakEvenCount > 0 && (
              <ReferenceLine
                y={breakEvenCount}
                stroke="#f59e0b"
                strokeDasharray="6 3"
                strokeWidth={2}
              />
            )}
            <Tooltip
              content={<CustomTooltip totalProperties={totalProps} />}
              wrapperStyle={{ zIndex: 9999, outline: 'none' }}
              allowEscapeViewBox={{ x: true, y: true }}
              isAnimationActive={false}
            />
            <Legend
              iconType="square"
              iconSize={10}
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
            />
            {groups.map((g, i) => (
              <Bar
                key={g.id}
                dataKey={g.id}
                name={g.name}
                stackId="occ"
                fill={g.color}
                radius={i === groups.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                maxBarSize={40}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
