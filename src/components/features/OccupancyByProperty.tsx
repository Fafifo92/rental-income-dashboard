import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { supabase } from '@/lib/supabase/client';
import type { ChartGranularity } from '@/services/financial';

interface Props {
  granularity: ChartGranularity;
  from: string;
  to: string;
  propertyIds?: string[];
  breakEvenOccupancy: number;
}

const COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899',
  '#14b8a6', '#84cc16',
];

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
      buckets.push({ key: dateFmt(cur), label: `Semana ${weekNum}`, start: new Date(cur), end: next });
      cur.setDate(cur.getDate() + 7);
      weekNum++;
    }
  } else {
    // month
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

function nightsOverlap(bucketStart: Date, bucketEnd: Date, bookingStart: Date, bookingEnd: Date): number {
  const overlapStart = bucketStart > bookingStart ? bucketStart : bookingStart;
  const overlapEnd = bucketEnd < bookingEnd ? bucketEnd : bookingEnd;
  const ms = overlapEnd.getTime() - overlapStart.getTime();
  return ms > 0 ? Math.round(ms / 86_400_000) : 0;
}

interface TooltipPayloadEntry {
  dataKey: string;
  name: string;
  value: number;
  color: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const entries = payload.filter(p => p.value > 0);
  return (
    <div className="bg-white rounded-xl shadow-xl border p-3 text-sm min-w-[180px]">
      <p className="font-bold text-slate-700 mb-2">{label}</p>
      {entries.map(p => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 mb-1">
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="truncate max-w-[130px]">{p.name}</span>
          </span>
          <span className="font-semibold text-slate-800 shrink-0">{p.value}n</span>
        </div>
      ))}
    </div>
  );
}

interface BookingRow {
  start_date: string;
  end_date: string;
  listing_id: string;
  status: string;
}

type ChartDataRow = Record<string, string | number>;

export default function OccupancyByProperty({ granularity, from, to, propertyIds, breakEvenOccupancy }: Props) {
  const [chartData, setChartData] = useState<ChartDataRow[]>([]);
  const [propNames, setPropNames] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const propIdsKey = propertyIds?.join(',') ?? '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      // 1. Fetch properties
      let propQuery = supabase.from('properties').select('id, name').order('name');
      if (propertyIds?.length) propQuery = propQuery.in('id', propertyIds);
      const { data: props } = await propQuery;

      if (cancelled) return;
      if (!props?.length) {
        setPropNames([]);
        setChartData([]);
        setLoading(false);
        return;
      }

      // 2. Fetch listings → listing → property map
      const propIds = props.map((p: { id: string; name: string }) => p.id);
      const { data: listings } = await supabase
        .from('listings')
        .select('id, property_id')
        .in('property_id', propIds);

      if (cancelled) return;

      const listingToProp = new Map<string, string>();
      (listings ?? []).forEach((l: { id: string; property_id: string }) =>
        listingToProp.set(l.id, l.property_id),
      );
      const listingIds = [...listingToProp.keys()];

      // 3. Fetch bookings overlapping [from, to], exclude cancelled
      let bookings: BookingRow[] = [];
      if (listingIds.length) {
        const { data: bkgs } = await supabase
          .from('bookings')
          .select('start_date, end_date, listing_id, status')
          .gte('end_date', from)
          .lte('start_date', to)
          .in('listing_id', listingIds)
          .not('status', 'ilike', '%cancel%');
        bookings = (bkgs ?? []) as BookingRow[];
      }

      if (cancelled) return;

      // 4. Build time buckets
      const buckets = buildBuckets(from, to, granularity);

      // 5. For each bucket × property, count overlapping nights
      const propMap = new Map<string, string>(); // id → name
      props.forEach((p: { id: string; name: string }) => propMap.set(p.id, p.name));

      const data: ChartDataRow[] = buckets.map(bucket => {
        const row: ChartDataRow = { bucket: bucket.label };
        props.forEach((p: { id: string; name: string }) => {
          row[p.name] = 0;
        });

        for (const bk of bookings) {
          const propId = listingToProp.get(bk.listing_id);
          if (!propId) continue;
          const propName = propMap.get(propId);
          if (!propName) continue;

          const bkStart = isoToDate(bk.start_date);
          const bkEnd = isoToDate(bk.end_date); // checkout = not occupied

          const nights = nightsOverlap(bucket.start, bucket.end, bkStart, bkEnd);
          (row[propName] as number) += nights;
        }

        return row;
      });

      if (!cancelled) {
        setPropNames(props);
        setChartData(data);
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

  if (!propNames.length || !chartData.length) {
    return (
      <div className="bg-white border rounded-xl shadow-sm p-6 h-48 flex items-center justify-center text-slate-400 text-sm">
        Sin datos de ocupacion para el periodo seleccionado.
      </div>
    );
  }

  const hasAnyData = chartData.some(row =>
    propNames.some(p => (row[p.name] as number) > 0),
  );

  return (
    <div className="p-6 bg-white border rounded-xl shadow-sm">
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-bold text-slate-800">Ocupacion por Propiedad</h3>
          <p className="text-sm text-slate-500 mt-0.5">Noches reservadas por propiedad y periodo</p>
        </div>
        {breakEvenOccupancy > 0 && (
          <div className="flex items-center gap-2 text-xs shrink-0">
            <span className="text-amber-600 font-semibold">Break-even {breakEvenOccupancy}%</span>
          </div>
        )}
      </div>

      {!hasAnyData ? (
        <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
          Sin datos de ocupacion para el periodo seleccionado.
        </div>
      ) : (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%" minHeight={0} minWidth={0}>
            <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
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
                unit="n"
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              {propNames.map((p, i) => (
                <Bar
                  key={p.id}
                  dataKey={p.name}
                  name={p.name}
                  fill={COLORS[i % COLORS.length]}
                  radius={[4, 4, 0, 0]}
                  barSize={16}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
