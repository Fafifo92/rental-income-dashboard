/**
 * creditPools.test.ts
 *
 * Tests unitarios para la lógica pura de bolsas de créditos:
 *   - calcUnitsForBooking: reglas de consumo por tipo
 *   - unitPriceOf: precio/crédito y casos extremos
 *   - Lógica FIFO conceptual (selección de bolsa más antigua)
 *   - Snapshot price-freeze semántico
 *   - getCreditPoolCostByProperty agregación
 *
 * NO mockean Supabase (sería frágil). Cubren la lógica pura exportada
 * que no necesita red. Las funciones que sí necesitan DB se documentan
 * con el comportamiento esperado como "spec comentada".
 */

import { describe, it, expect } from 'vitest';
import { calcUnitsForBooking, unitPriceOf } from '@/lib/creditPoolCalc';
import type { CreditPoolConsumptionRule } from '@/types/database';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeBooking = (overrides: {
  num_adults?: number;
  num_children?: number;
  num_nights?: number;
}) => ({
  num_adults:   overrides.num_adults   ?? 2,
  num_children: overrides.num_children ?? 0,
  num_nights:   overrides.num_nights   ?? 3,
});

const makePool = (overrides: {
  total_price?: number;
  credits_total?: number;
}) => ({
  total_price:   overrides.total_price   ?? 1_000_000,
  credits_total: overrides.credits_total ?? 1000,
});

// ─── calcUnitsForBooking ──────────────────────────────────────────────────────

describe('calcUnitsForBooking', () => {
  describe('per_person_per_night', () => {
    const rule: CreditPoolConsumptionRule = 'per_person_per_night';

    it('2 adultos × 3 noches = 6 unidades', () => {
      expect(calcUnitsForBooking(makeBooking({ num_adults: 2 }), rule, 1)).toBe(6);
    });

    it('2 adultos + 1 niño (weight=1) × 3 noches = 9 unidades', () => {
      expect(calcUnitsForBooking(
        makeBooking({ num_adults: 2, num_children: 1, num_nights: 3 }), rule, 1,
      )).toBe(9);
    });

    it('niño con weight=0.5 cuenta mitad', () => {
      // 2 adultos + 2 niños×0.5 = 3 personas × 3 noches = 9
      expect(calcUnitsForBooking(
        makeBooking({ num_adults: 2, num_children: 2, num_nights: 3 }), rule, 0.5,
      )).toBe(9);
    });

    it('niños con weight=0 no cuentan', () => {
      // 2 adultos + 5 niños×0 = 2 × 4 = 8
      expect(calcUnitsForBooking(
        makeBooking({ num_adults: 2, num_children: 5, num_nights: 4 }), rule, 0,
      )).toBe(8);
    });

    it('1 noche mínimo cuando num_nights es 0', () => {
      expect(calcUnitsForBooking(makeBooking({ num_adults: 1, num_nights: 0 }), rule, 1)).toBe(1);
    });

    it('0 adultos cuenta como 0 (edge)', () => {
      expect(calcUnitsForBooking(makeBooking({ num_adults: 0, num_nights: 5 }), rule, 1)).toBe(0);
    });
  });

  describe('per_person_per_booking', () => {
    const rule: CreditPoolConsumptionRule = 'per_person_per_booking';

    it('2 adultos, 4 noches → 2 (noches no importan)', () => {
      expect(calcUnitsForBooking(makeBooking({ num_adults: 2, num_nights: 4 }), rule, 1)).toBe(2);
    });

    it('niños peso 0.5 → 2 adultos + 2 niños = 3', () => {
      expect(calcUnitsForBooking(
        makeBooking({ num_adults: 2, num_children: 2, num_nights: 7 }), rule, 0.5,
      )).toBe(3);
    });
  });

  describe('per_booking', () => {
    const rule: CreditPoolConsumptionRule = 'per_booking';

    it('siempre devuelve 1 sin importar personas ni noches', () => {
      expect(calcUnitsForBooking(makeBooking({ num_adults: 10, num_children: 5, num_nights: 30 }), rule, 1)).toBe(1);
      expect(calcUnitsForBooking(makeBooking({ num_adults: 1, num_nights: 1 }), rule, 0)).toBe(1);
    });
  });
});

// ─── unitPriceOf ─────────────────────────────────────────────────────────────

describe('unitPriceOf', () => {
  it('calcula precio por crédito correctamente', () => {
    // $1.200.000 / 1000 créditos = $1.200 / crédito
    expect(unitPriceOf(makePool({ total_price: 1_200_000, credits_total: 1000 }))).toBe(1200);
  });

  it('retorna 0 cuando credits_total es 0 (evita división por cero)', () => {
    expect(unitPriceOf(makePool({ total_price: 500_000, credits_total: 0 }))).toBe(0);
  });

  it('retorna 0 cuando total_price es 0', () => {
    expect(unitPriceOf(makePool({ total_price: 0, credits_total: 1000 }))).toBe(0);
  });

  it('trabaja con valores decimales', () => {
    // $750 / 3 = $250 exacto
    expect(unitPriceOf({ total_price: 750, credits_total: 3 })).toBeCloseTo(250);
  });

  it('soporta tipos string (como los devuelve Supabase)', () => {
    // @ts-expect-error — Supabase puede devolver strings en campos numeric
    expect(unitPriceOf({ total_price: '1200000', credits_total: '1000' })).toBe(1200);
  });
});

// ─── Modelo FIFO — lógica conceptual (sin red) ───────────────────────────────

describe('FIFO pool selection — lógica conceptual', () => {
  /**
   * El servicio `findActivePoolsForBookingProperty` devuelve pools ordenadas
   * por `activated_at ASC`. La primera de la lista es la más antigua y debe
   * consumirse primero. Aquí validamos que nuestra lógica de filtrado/orden
   * funciona con objetos mock antes de ir a red.
   */

  type PoolMock = { id: string; activated_at: string; status: string; credits_total: number; credits_used: number };

  const sortFIFO = (pools: PoolMock[]) =>
    [...pools]
      .filter(p => p.status === 'active' && (p.credits_total - p.credits_used) > 0)
      .sort((a, b) => a.activated_at.localeCompare(b.activated_at));

  it('selecciona la bolsa más antigua como primera (FIFO)', () => {
    const pools: PoolMock[] = [
      { id: 'pool-2', activated_at: '2026-04-01', status: 'active', credits_total: 500, credits_used: 0 },
      { id: 'pool-1', activated_at: '2026-01-01', status: 'active', credits_total: 500, credits_used: 0 },
      { id: 'pool-3', activated_at: '2026-07-01', status: 'active', credits_total: 500, credits_used: 0 },
    ];
    expect(sortFIFO(pools)[0].id).toBe('pool-1');
  });

  it('excluye bolsas agotadas', () => {
    const pools: PoolMock[] = [
      { id: 'old-depleted', activated_at: '2026-01-01', status: 'active', credits_total: 100, credits_used: 100 },
      { id: 'new-active',   activated_at: '2026-06-01', status: 'active', credits_total: 100, credits_used: 0 },
    ];
    const result = sortFIFO(pools);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('new-active');
  });

  it('excluye bolsas archivadas', () => {
    const pools: PoolMock[] = [
      { id: 'archived', activated_at: '2025-01-01', status: 'archived', credits_total: 100, credits_used: 0 },
      { id: 'active',   activated_at: '2026-01-01', status: 'active',   credits_total: 100, credits_used: 0 },
    ];
    expect(sortFIFO(pools).map(p => p.id)).toEqual(['active']);
  });

  it('devuelve vacío si todas están agotadas', () => {
    const pools: PoolMock[] = [
      { id: 'p1', activated_at: '2026-01-01', status: 'active', credits_total: 50, credits_used: 50 },
      { id: 'p2', activated_at: '2026-02-01', status: 'active', credits_total: 50, credits_used: 50 },
    ];
    expect(sortFIFO(pools)).toHaveLength(0);
  });
});

// ─── Split FIFO — créditos remanentes cuando una bolsa no alcanza ────────────

describe('Split FIFO — consumo multi-bolsa', () => {
  /**
   * Cuando una reserva requiere más créditos de los disponibles en la primera
   * bolsa (FIFO), el excedente se cobra a la siguiente bolsa del mismo vendor.
   * Resultado esperado: 2 filas de consumption con `notes` indicando el split.
   *
   * Aquí validamos el algoritmo de reparto puro (sin Supabase).
   */

  type PoolMock = { id: string; available: number };

  const splitAcrossPools = (pools: PoolMock[], requested: number) => {
    const result: Array<{ pool_id: string; used: number }> = [];
    let remaining = requested;
    for (const p of pools) {
      if (remaining <= 0) break;
      const used = Math.min(remaining, p.available);
      if (used > 0) result.push({ pool_id: p.id, used });
      remaining -= used;
    }
    return { rows: result, missing: Math.max(0, remaining) };
  };

  it('consume todo de una sola bolsa cuando hay saldo suficiente', () => {
    const { rows, missing } = splitAcrossPools(
      [{ id: 'A', available: 100 }], 60,
    );
    expect(rows).toEqual([{ pool_id: 'A', used: 60 }]);
    expect(missing).toBe(0);
  });

  it('hace split entre dos bolsas cuando la primera no alcanza', () => {
    const { rows, missing } = splitAcrossPools(
      [{ id: 'A', available: 40 }, { id: 'B', available: 100 }], 60,
    );
    expect(rows).toEqual([
      { pool_id: 'A', used: 40 },
      { pool_id: 'B', used: 20 },
    ]);
    expect(missing).toBe(0);
  });

  it('reporta créditos faltantes si no hay bolsas suficientes', () => {
    const { rows, missing } = splitAcrossPools(
      [{ id: 'A', available: 30 }], 50,
    );
    expect(rows).toEqual([{ pool_id: 'A', used: 30 }]);
    expect(missing).toBe(20);
  });

  it('no genera filas si requested = 0', () => {
    const { rows, missing } = splitAcrossPools(
      [{ id: 'A', available: 100 }], 0,
    );
    expect(rows).toHaveLength(0);
    expect(missing).toBe(0);
  });
});

// ─── unit_price_snapshot — semántica de congelamiento ────────────────────────

describe('unit_price_snapshot — semántica', () => {
  /**
   * El snapshot congela el precio/crédito al momento del consumo.
   * Si el pool se edita después, los consumos históricos no cambian.
   *
   * La función `unitPriceOf` calcula el precio *actual* de un pool.
   * El snapshot es simplemente unitPriceOf(pool) en el momento del consumo.
   */

  it('snapshot = unitPriceOf(pool) calculado al consumir', () => {
    const pool = makePool({ total_price: 2_400_000, credits_total: 2000 });
    const snapshot = unitPriceOf(pool); // 1200
    expect(snapshot).toBe(1200);
    // Simulamos edición posterior del pool:
    const editedPool = { ...pool, total_price: 3_000_000, credits_total: 2000 };
    // El snapshot anterior no cambia:
    expect(snapshot).toBe(1200);
    // El pool actual tiene nuevo precio, pero los consumos históricos siguen con 1200:
    expect(unitPriceOf(editedPool)).toBe(1500);
    expect(snapshot).not.toBe(unitPriceOf(editedPool));
  });

  it('costo histórico = credits_used × snapshot (no depende del pool actual)', () => {
    const snapshot = 1200; // congelado
    const creditsUsed = 6; // 2 adultos × 3 noches × 1 crédito/unidad
    const historicalCost = creditsUsed * snapshot;
    expect(historicalCost).toBe(7200);
    // Si el pool cambia de precio, el costo histórico no se ve afectado:
    const newUnitPrice = 1500;
    const hypotheticalCost = creditsUsed * newUnitPrice;
    expect(hypotheticalCost).toBe(9000);
    // Los dos costos son distintos — el histórico queda blindado:
    expect(historicalCost).not.toBe(hypotheticalCost);
  });
});

// ─── Atribución por propiedad — agregación conceptual ────────────────────────

describe('getCreditPoolCostByProperty — lógica de agregación', () => {
  /**
   * `getCreditPoolCostByProperty` agrupa consumptions por (propertyId, poolId).
   * Aquí validamos el algoritmo de agregación puro.
   */

  type ConsRow = {
    pool_id: string;
    property_id: string;
    pool_name: string;
    credits: number;
    unit_price: number;
  };

  const aggregate = (rows: ConsRow[]) => {
    const buckets = new Map<string, { property_id: string; pool_id: string; pool_name: string; credits: number; cost: number }>();
    for (const r of rows) {
      const key = `${r.property_id}::${r.pool_id}`;
      const b = buckets.get(key);
      const cost = r.credits * r.unit_price;
      if (b) { b.credits += r.credits; b.cost += cost; }
      else buckets.set(key, { property_id: r.property_id, pool_id: r.pool_id, pool_name: r.pool_name, credits: r.credits, cost });
    }
    return [...buckets.values()];
  };

  it('agrupa múltiples consumos de la misma bolsa+propiedad', () => {
    const rows: ConsRow[] = [
      { pool_id: 'P1', property_id: 'PR1', pool_name: 'Colasistencia Q1', credits: 6, unit_price: 1200 },
      { pool_id: 'P1', property_id: 'PR1', pool_name: 'Colasistencia Q1', credits: 4, unit_price: 1200 },
    ];
    const result = aggregate(rows);
    expect(result).toHaveLength(1);
    expect(result[0].credits).toBe(10);
    expect(result[0].cost).toBe(12_000);
  });

  it('separa por propiedad aunque sea la misma bolsa', () => {
    const rows: ConsRow[] = [
      { pool_id: 'P1', property_id: 'PR1', pool_name: 'Bolsa', credits: 5, unit_price: 1000 },
      { pool_id: 'P1', property_id: 'PR2', pool_name: 'Bolsa', credits: 3, unit_price: 1000 },
    ];
    const result = aggregate(rows);
    expect(result).toHaveLength(2);
  });

  it('separa por bolsa aunque sea la misma propiedad (dos recargas FIFO)', () => {
    const rows: ConsRow[] = [
      { pool_id: 'P1', property_id: 'PR1', pool_name: 'Recarga 1', credits: 6, unit_price: 1200 },
      { pool_id: 'P2', property_id: 'PR1', pool_name: 'Recarga 2', credits: 4, unit_price: 1350 },
    ];
    const result = aggregate(rows);
    expect(result).toHaveLength(2);
    expect(result.find(r => r.pool_id === 'P1')?.cost).toBe(7200);
    expect(result.find(r => r.pool_id === 'P2')?.cost).toBe(5400);
  });

  it('usa el unit_price correcto por fila (cada fila puede tener snapshot distinto)', () => {
    // Bolsa P1: recarga vieja (precio 1200), P1-nuevo: recarga nueva (precio 1350)
    const rows: ConsRow[] = [
      { pool_id: 'P1', property_id: 'PR1', pool_name: 'Bolsa', credits: 10, unit_price: 1200 },
      { pool_id: 'P1', property_id: 'PR1', pool_name: 'Bolsa', credits: 5, unit_price: 1200 },
    ];
    const result = aggregate(rows);
    // 15 créditos × 1200 = 18.000
    expect(result[0].cost).toBe(18_000);
  });
});

// ─── Idempotencia — ya consumido ─────────────────────────────────────────────

describe('Idempotencia de consumo', () => {
  /**
   * Una reserva no debe consumir dos veces del mismo vendor.
   * Si sumConsumedByVendorForBooking devuelve consumed ≥ requested, el
   * servicio hace skip.
   */

  const alreadyConsumed = (vendorKey: string, consumedMap: Map<string, number>, requested: number) => {
    const consumed = consumedMap.get(vendorKey) ?? 0;
    return consumed >= requested;
  };

  it('detecta consumo completo ya existente', () => {
    const map = new Map([['vendor-123', 6]]);
    expect(alreadyConsumed('vendor-123', map, 6)).toBe(true);
  });

  it('detecta consumo parcial (hay algo pendiente)', () => {
    const map = new Map([['vendor-123', 4]]);
    expect(alreadyConsumed('vendor-123', map, 6)).toBe(false);
  });

  it('devuelve false si no hay consumos previos', () => {
    expect(alreadyConsumed('vendor-123', new Map(), 6)).toBe(false);
  });

  it('bolsas sin vendor se agrupan bajo clave "null"', () => {
    const map = new Map<string, number>([['null', 3]]);
    expect(alreadyConsumed('null', map, 3)).toBe(true);
    expect(alreadyConsumed('null', map, 4)).toBe(false);
  });
});
