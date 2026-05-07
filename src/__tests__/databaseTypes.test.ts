/**
 * Smoke tests — database types (Bloque 4.4)
 *
 * Verifican que los tipos TypeScript críticos coincidan con la estructura
 * esperada. Si una migración agrega/renombra columnas, estos tests
 * documentan el contrato y fallan rápido.
 *
 * Son compilación-time checks: si compilan → el tipo es correcto.
 */
import { describe, it, expect } from 'vitest';
import type {
  AuditLogRow,
  AuditLogAction,
  ExpenseRow,
  VendorRow,
  BookingRow,
  MaintenanceScheduleRow,
} from '@/types/database';

// Utility: fuerza que un tipo sea asignable (falla en compilación si no)
type Expect<T extends true> = T;
type IsAssignable<A, B> = A extends B ? true : false;

describe('database types — estructura correcta', () => {
  it('AuditLogRow tiene los campos obligatorios', () => {
    const row: AuditLogRow = {
      id: 1,
      user_id: 'user-uuid',
      table_name: 'properties',
      record_id: 'record-uuid',
      action: 'update',
      old_data: { name: 'antes' },
      new_data: { name: 'después' },
      occurred_at: '2026-01-01T00:00:00Z',
    };
    expect(row.action).toBe('update');
    expect(row.table_name).toBe('properties');
  });

  it('AuditLogAction sólo acepta insert | update | delete', () => {
    const actions: AuditLogAction[] = ['insert', 'update', 'delete'];
    expect(actions).toHaveLength(3);
  });

  it('ExpenseRow tiene vendor_id (migration_008) y shared_bill_id (migration_013)', () => {
    // Si este test compila → ambos campos existen en el tipo
    const partial: Pick<ExpenseRow, 'vendor_id' | 'shared_bill_id'> = {
      vendor_id: null,
      shared_bill_id: null,
    };
    expect(partial.vendor_id).toBeNull();
  });

  it('VendorRow incluye start_year_month (migration_025)', () => {
    const partial: Pick<VendorRow, 'start_year_month'> = { start_year_month: '2026-01' };
    expect(partial.start_year_month).toBe('2026-01');
  });

  it('BookingRow incluye campos operativos (migration_011)', () => {
    const partial: Pick<BookingRow, 'checkin_done' | 'checkout_done' | 'inventory_checked'> = {
      checkin_done: false,
      checkout_done: false,
      inventory_checked: false,
    };
    expect(partial.checkin_done).toBe(false);
  });

  it('MaintenanceScheduleRow incluye campos de recurrencia (migration_033)', () => {
    const partial: Pick<MaintenanceScheduleRow, 'is_recurring' | 'recurrence_days' | 'expense_registered'> = {
      is_recurring: false,
      recurrence_days: null,
      expense_registered: false,
    };
    expect(partial.is_recurring).toBe(false);
  });
});
