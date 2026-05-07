/**
 * Smoke tests — expenseClassify (Strategy Pattern)
 *
 * Cubren el motor de clasificación puro sin ninguna dependencia de Supabase.
 * Objetivo: garantizar que el Strategy Pattern retorne resultados correctos
 * para los casos de uso más frecuentes.
 */
import { describe, it, expect } from 'vitest';
import { classifyExpense } from '@/lib/expenseClassify';
import type { Expense } from '@/types';

// ── Helpers ────────────────────────────────────────────────────────────────
const makeExpense = (overrides: Partial<Expense>): Expense =>
  ({
    id: 'test-id',
    owner_id: 'owner-1',
    property_id: 'prop-1',
    category: 'Otros',
    subcategory: null,
    type: 'variable',
    amount: 100,
    date: '2026-01-15',
    description: null,
    status: 'pending',
    bank_account_id: null,
    booking_id: null,
    vendor: null,
    person_in_charge: null,
    adjustment_id: null,
    vendor_id: null,
    shared_bill_id: null,
    expense_group_id: null,
  } satisfies Expense, overrides as Expense);

// ── Tests ──────────────────────────────────────────────────────────────────
describe('classifyExpense — Strategy Pattern', () => {
  it('clasifica por subcategoría canónica: utilities → property', () => {
    const result = classifyExpense(makeExpense({ subcategory: 'utilities' }));
    expect(result.section).toBe('property');
    expect(result.subcategory).toBe('utilities');
  });

  it('clasifica por subcategoría canónica: cleaning → booking', () => {
    const result = classifyExpense(makeExpense({ subcategory: 'cleaning' }));
    expect(result.section).toBe('booking');
    expect(result.subcategory).toBe('cleaning');
  });

  it('clasifica por texto de categoría: "Multas cancelación" → penalty', () => {
    const result = classifyExpense(makeExpense({ category: 'Multas cancelación', subcategory: null }));
    expect(result.section).toBe('booking');
    expect(result.subcategory).toBe('penalty');
  });

  it('clasifica por texto de categoría: "Aseo" → cleaning', () => {
    const result = classifyExpense(makeExpense({ category: 'Aseo', subcategory: null }));
    expect(result.section).toBe('booking');
    expect(result.subcategory).toBe('cleaning');
  });

  it('clasifica por texto: "Daño huésped" → damage', () => {
    const result = classifyExpense(makeExpense({ category: 'Daño huésped', subcategory: null }));
    expect(result.section).toBe('booking');
    expect(result.subcategory).toBe('damage');
  });

  it('clasifica por adjustment_id → damage (priority 40)', () => {
    const result = classifyExpense(makeExpense({
      adjustment_id: 'adj-123',
      subcategory: null,
      category: 'Otros',
    }));
    expect(result.section).toBe('booking');
    expect(result.subcategory).toBe('damage');
  });

  it('subcategoría tiene precedencia sobre texto de categoría (priority 20 < 30)', () => {
    // maintenance (subcategory) vs "Aseo" (category-text) — subcategory gana
    const result = classifyExpense(makeExpense({
      subcategory: 'maintenance',
      category: 'Aseo',
    }));
    expect(result.section).toBe('property');
    expect(result.subcategory).toBe('maintenance');
  });

  it('fallback: gasto sin pistas → property, subcategory null', () => {
    const result = classifyExpense(makeExpense({ category: 'Otros', subcategory: null }));
    expect(result.section).toBe('property');
    expect(result.subcategory).toBeNull();
  });

  it('gasto sintético fine- → booking/penalty (priority 10, máxima)', () => {
    const result = classifyExpense(makeExpense({ id: 'fine-abc123', subcategory: null }));
    expect(result.section).toBe('booking');
    expect(result.subcategory).toBe('penalty');
  });
});
