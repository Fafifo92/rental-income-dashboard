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
import { supabase } from '@/lib/supabase/client';
import type { ChartGranularity } from '@/services/financial';

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

type ChartDataRow = Record<string, string | number>;

// ── Tooltip ───────────────────────────────────────────────────────────────────

interface TooltipEntry { name: string; value: number; color: string; dataKey: string }
interface TTProps { active?: boolean; payload?: TooltipEntry[]; label?: string; totalProperties: number }

function CustomTooltip({ active, payload, label, totalProperties }: TTProps) {
  if (!active || !payload?.length) return null;
  const entries = payload.filter(p => p.value > 0);
  const total = entries.reduce((s, p) => s + p.value, 0);
  const pct = totalProperties > 0 ? Math.round((total / totalProperties) * 100) : 0;
  return (
    <div className="bg-white rounded-xl shadow-xl border p-3 text-sm min-w-[180px]">
      <p className="font-bold text-slate-700 mb-1">{label}</p>
      <p className="text-xs text-slate-400 mb-2">{total} de {totalProperties} propiedades · {pct}% ocupación</p>
      {entries.map(p => (
        <div key={p.dataKey} className="flex items-center justify-between gap-3 mb-1">
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: p.color }} />
            <span className="truncate max-w-[130px]">{p.name}</span>
          </span>
          <span className="font-semibold text-slate-800 shrink-0">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface BookingRaw {
  start_date: string;
  end_date: string;
  listing_id: string;
}

export default function OccupancyByProperty({ granularity, from, to, propertyIds, breakEvenOccupancy }: Props) {
  const [chartData, setChartData]   = useState<ChartDataRow[]>([]);
  const [groups, setGroups]         = useState<Group[]>([]);
  const [totalProps, setTotalProps] = useState(0);
  const [loading, setLoading]       = useState(true);

  const propIdsKey = propertyIds?.join(',') ?? '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      // 1. Properties + their group_id
      let propQ = supabase.from('properties').select('id, group_id').order('name');
      if (propertyIds?.length) propQ = propQ.in('id', propertyIds);
      const { data: props } = await propQ;
      if (cancelled) return;
      if (!props?.length) {
        setGroups([]); setChartData([]); setTotalProps(0); setLoading(false);
        return;
      }
      type PropRow = { id: string; group_id: string | null };
      const propArr = props as PropRow[];

      // 2. Property groups
      const uniqueGroupIds = Array.from(new Set(propArr.map(p => p.group_id).filter(Boolean))) as string[];
      const groupMap = new Map<string, Group>(); // id → Group
      if (uniqueGroupIds.length) {
        const { data: gRows } = await supabase
          .from('property_groups')
          .select('id, name, color')
          .in('id', uniqueGroupIds);
        for (const g of (gRows ?? []) as Array<{ id: string; name: string; color: string }>) {
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
      const { data: listings } = await supabase
        .from('listings')
        .select('id, property_id')
        .in('property_id', propIds);
      if (cancelled) return;

      const listingToProp = new Map<string, string>(); // listingId → propertyId
      for (const l of (listings ?? []) as Array<{ id: string; property_id: string }>) {
        listingToProp.set(l.id, l.property_id);
      }
      const listingIds = [...listingToProp.keys()];

      // 4. Bookings overlapping [from, to], exclude cancelled
      let bookings: BookingRaw[] = [];
      if (listingIds.length) {
        const { data: bkgs } = await supabase
          .from('bookings')
          .select('start_date, end_date, listing_id')
          .gte('end_date', from)
          .lte('start_date', to)
          .in('listing_id', listingIds)
          .not('status', 'ilike', '%cancel%');
        bookings = (bkgs ?? []) as BookingRaw[];
      }
      if (cancelled) return;

      // 5. Build buckets and count DISTINCT properties occupied per group per bucket
      const buckets = buildBuckets(from, to, granularity);

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

        // Count occupied properties per group
        const row: ChartDataRow = { bucket: bucket.label };
        for (const g of orderedGroups) row[g.id] = 0;

        for (const propId of occupiedProps) {
          const group = propToGroup.get(propId);
          if (group) row[group.id] = (row[group.id] as number) + 1;
        }
        return row;
      });

      if (!cancelled) {
        setGroups(orderedGroups);
        setChartData(data);
        setTotalProps(propArr.length);
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
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
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

      <div className="h-64 w-full">
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
            <Tooltip content={<CustomTooltip totalProperties={totalProps} />} />
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
      </div>
    </div>
  );
}
