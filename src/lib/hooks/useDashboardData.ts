import { useState, useEffect } from 'react';
import {
  computeFinancials, resolvePeriodRange,
  type Period, type FinancialKPIs, type MonthlyPnL, type PayoutBreakdown, type ChartGranularity,
} from '@/services/financial';
import { listTransactions, type FinancialTransaction } from '@/services/transactions';
import type { AuthStatus } from '@/lib/useAuth';

interface UseDashboardDataOptions {
  period: Period;
  authStatus: AuthStatus;
  propertyIds?: string[];
  customRange?: { from: string; to: string };
}

/**
 * Carga financials + ledger del dashboard. Maneja cancelación cuando cambian dependencias
 * para evitar setState sobre fetches obsoletos (race conditions).
 */
export function useDashboardData({ period, authStatus, propertyIds, customRange }: UseDashboardDataOptions) {
  const [kpis, setKpis] = useState<FinancialKPIs | null>(null);
  const [monthlyPnL, setMonthlyPnL] = useState<MonthlyPnL[]>([]);
  const [exportMonthly, setExportMonthly] = useState<MonthlyPnL[]>([]);
  const [exportMonthlyByBookings, setExportMonthlyByBookings] = useState<MonthlyPnL[]>([]);
  const [payoutBreakdown, setPayoutBreakdown] = useState<PayoutBreakdown | null>(null);
  const [granularity, setGranularity] = useState<ChartGranularity>('week');
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(false);

  useEffect(() => {
    if (authStatus === 'checking') return;
    if (period === 'custom' && (!customRange?.from || !customRange?.to)) return;

    let cancelled = false;
    setLoading(true);
    computeFinancials(period, authStatus === 'authed', propertyIds, customRange).then(result => {
      if (cancelled) return;
      setKpis(result.kpis);
      setMonthlyPnL(result.monthlyPnL);
      setExportMonthly(result.exportMonthly);
      setExportMonthlyByBookings(result.exportMonthlyByBookings);
      setPayoutBreakdown(result.payoutBreakdown);
      setGranularity(result.granularity);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });

    setTxLoading(true);
    const { from, to } = resolvePeriodRange(period, customRange);
    listTransactions(from, to, propertyIds?.length ? propertyIds : undefined).then(result => {
      if (cancelled) return;
      setTransactions(result.data ?? []);
      setTxLoading(false);
    }).catch(() => { if (!cancelled) setTxLoading(false); });

    return () => { cancelled = true; };
  }, [period, authStatus, propertyIds, customRange]);

  return { kpis, monthlyPnL, exportMonthly, exportMonthlyByBookings, payoutBreakdown, granularity, transactions, loading, txLoading };
}
