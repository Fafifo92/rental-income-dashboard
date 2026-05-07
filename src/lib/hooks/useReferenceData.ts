import { useState, useEffect } from 'react';
import { listProperties } from '@/services/properties';
import { listBankAccounts } from '@/services/bankAccounts';
import { listListings } from '@/services/listings';
import type { PropertyRow, BankAccountRow, ListingRow } from '@/types/database';
import type { AuthStatus } from '@/lib/useAuth';

interface UseReferenceDataOptions {
  authStatus: AuthStatus;
  /** Cargar properties. Default: false. */
  withProperties?: boolean;
  /** Cargar bankAccounts (filtra activas por defecto). Default: false. */
  withBankAccounts?: boolean;
  /** Si true (default), filtra cuentas inactivas. */
  activeBankAccountsOnly?: boolean;
  /** Cargar listings. Default: false. */
  withListings?: boolean;
}

/**
 * Carga catálogos de referencia (properties, bankAccounts, listings) cuando el usuario
 * está autenticado. Cada catálogo es opt-in para no traer datos innecesarios.
 */
export function useReferenceData({
  authStatus,
  withProperties = false,
  withBankAccounts = false,
  activeBankAccountsOnly = true,
  withListings = false,
}: UseReferenceDataOptions) {
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[]>([]);
  const [listings, setListings] = useState<ListingRow[]>([]);

  useEffect(() => {
    if (authStatus !== 'authed') return;
    if (withProperties) {
      listProperties().then(res => { if (!res.error) setProperties(res.data ?? []); });
    }
    if (withBankAccounts) {
      listBankAccounts().then(res => {
        if (!res.error) {
          const data = res.data ?? [];
          setBankAccounts(activeBankAccountsOnly ? data.filter(a => a.is_active) : data);
        }
      });
    }
    if (withListings) {
      listListings().then(res => { if (!res.error) setListings(res.data ?? []); });
    }
  }, [authStatus, withProperties, withBankAccounts, activeBankAccountsOnly, withListings]);

  return { properties, bankAccounts, listings };
}
