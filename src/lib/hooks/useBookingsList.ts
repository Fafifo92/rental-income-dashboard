import { useState, useEffect, useCallback } from 'react';
import { listBookings, type BookingFilters } from '@/services/bookings';
import type { DisplayBooking } from '@/components/features/bookings/types';
import { fromRow } from '@/components/features/bookings/helpers';

interface UseBookingsListOptions {
  filters: BookingFilters;
  propertyIds?: string[];
  /** Returns demo bookings already mapped to DisplayBooking (called only if DB query fails / demo mode). */
  demoFallback: (filters: BookingFilters) => DisplayBooking[];
  /** When false, skips fetching (e.g. while auth is "checking"). Defaults to true. */
  enabled?: boolean;
}

/**
 * Encapsula la carga de reservas con fallback a datos demo.
 * Mantiene `setBookings` expuesto para updates optimistas.
 */
export function useBookingsList({ filters, propertyIds, demoFallback, enabled = true }: UseBookingsListOptions) {
  const [bookings, setBookings] = useState<DisplayBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  const load = useCallback(async (f: BookingFilters) => {
    setLoading(true);
    const result = await listBookings(f);
    if (result.error) {
      setBookings(demoFallback(f));
      setIsDemo(true);
    } else {
      setBookings((result.data ?? []).map(fromRow));
      setIsDemo(false);
    }
    setLoading(false);
  }, [demoFallback]);

  useEffect(() => {
    if (!enabled) return;
    load({ ...filters, propertyIds });
  }, [filters, propertyIds, load, enabled]);

  const reload = useCallback(() => load({ ...filters, propertyIds }), [load, filters, propertyIds]);

  return { bookings, setBookings, loading, isDemo, reload };
}
