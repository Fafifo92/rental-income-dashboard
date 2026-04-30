/**
 * money.ts — Utilidades de dinero para Colombia (COP) y multimoneda.
 *
 * REGLAS DE ORO:
 * 1. La UI usa **coma `,` como separador decimal** y **punto `.` como separador
 *    de miles** (formato es-CO).
 * 2. En memoria, todas las operaciones aritméticas se hacen en **centavos enteros**
 *    para evitar errores de coma flotante de JavaScript
 *    (ej. `0.1 + 0.2 = 0.30000000000000004`).
 * 3. La capa de servicio expone `number` en unidades de la moneda (pesos con hasta
 *    2 decimales) — la BD guarda `numeric(14,2)`. Solo dentro de operaciones
 *    matemáticas convertimos a centavos.
 *
 * USO TÍPICO:
 *   const total = addMoney(itemA.amount, itemB.amount);          // suma exacta
 *   const formatted = formatMoney(total);                        // "1.234,56"
 *   const parsed = parseMoney("1.234,56");                       // 1234.56
 *   const cents = toCents(parsed);                               // 123456
 */

const CENT_FACTOR = 100;

// ─── Conversión centavos ⇄ unidades ─────────────────────────────────────

/** Convierte unidades de moneda (pesos) a centavos enteros con redondeo bancario seguro. */
export function toCents(amount: number | null | undefined): number {
  if (amount == null || !Number.isFinite(amount)) return 0;
  // Math.round con multiplicación segura: dividimos al ajustar para minimizar drift
  return Math.round(amount * CENT_FACTOR);
}

/** Convierte centavos a unidades de moneda (pesos con hasta 2 decimales). */
export function fromCents(cents: number): number {
  return Math.round(cents) / CENT_FACTOR;
}

// ─── Aritmética exacta (siempre en centavos) ────────────────────────────

export function addMoney(...amounts: Array<number | null | undefined>): number {
  const sum = amounts.reduce<number>((acc, a) => acc + toCents(a), 0);
  return fromCents(sum);
}

export function subMoney(a: number | null | undefined, b: number | null | undefined): number {
  return fromCents(toCents(a) - toCents(b));
}

/** Multiplica un monto por un factor entero o real. Si factor es real, redondea al centavo. */
export function mulMoney(amount: number | null | undefined, factor: number): number {
  return fromCents(Math.round(toCents(amount) * factor));
}

/** Divide un monto por un divisor (resultado redondeado al centavo). */
export function divMoney(amount: number | null | undefined, divisor: number): number {
  if (divisor === 0) return 0;
  return fromCents(Math.round(toCents(amount) / divisor));
}

/**
 * Reparte un total en N partes lo más iguales posibles. Los centavos sobrantes
 * se asignan a las primeras partes (orden estable).
 *
 *   splitMoney(100, 3) => [33.34, 33.33, 33.33]
 */
export function splitMoney(total: number | null | undefined, parts: number): number[] {
  if (parts <= 0) return [];
  const totalCents = toCents(total);
  const base = Math.floor(totalCents / parts);
  const remainder = totalCents - base * parts;
  return Array.from({ length: parts }, (_, i) => fromCents(base + (i < remainder ? 1 : 0)));
}

/**
 * Reparte un total según pesos relativos (ej. consumo por propiedad).
 * weights = [3, 1, 1] → 60% / 20% / 20%. Centavos sobrantes al primero.
 */
export function splitMoneyByWeights(total: number | null | undefined, weights: number[]): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return weights.map(() => 0);
  const totalCents = toCents(total);
  const raw = weights.map((w) => Math.floor((totalCents * w) / totalWeight));
  const used = raw.reduce((a, b) => a + b, 0);
  const remainder = totalCents - used;
  return raw.map((c, i) => fromCents(c + (i < remainder ? 1 : 0)));
}

// ─── Parsing y formato ──────────────────────────────────────────────────

/**
 * Convierte un string en formato es-CO ("1.234.567,89") a número.
 * Tolera entradas parciales del usuario:
 *   - "1234,5"  → 1234.5
 *   - "1.234"   → 1234   (interpretado como miles)
 *   - "1234.56" → 1234.56 (solo si no hay coma — fallback compatibilidad)
 *   - ""        → null
 *   - "abc"     → null
 */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const hasComma = trimmed.includes(',');
  const hasDot = trimmed.includes('.');

  let normalized: string;
  if (hasComma) {
    // Coma es decimal → quitar puntos (miles) y reemplazar coma por punto.
    normalized = trimmed.replace(/\./g, '').replace(',', '.');
  } else if (hasDot) {
    // Sin coma: si hay un solo punto y exactamente 1-2 decimales después,
    // tratarlo como decimal (compat con "1234.56"). Si hay múltiples puntos
    // o 3 decimales, tratarlos como miles.
    const parts = trimmed.split('.');
    const last = parts[parts.length - 1];
    if (parts.length === 2 && last.length > 0 && last.length <= 2) {
      normalized = trimmed; // "1234.56" → 1234.56
    } else {
      normalized = trimmed.replace(/\./g, ''); // "1.234" o "1.234.567" → entero
    }
  } else {
    normalized = trimmed;
  }

  // Permitir signo negativo opcional
  if (!/^-?\d*(\.\d*)?$/.test(normalized)) return null;
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Formatea un número en formato es-CO con dos decimales si hay centavos,
 * o sin decimales si es entero. Punto como separador de miles, coma decimal.
 *
 *   formatMoney(1234567)    → "1.234.567"
 *   formatMoney(1234.56)    → "1.234,56"
 *   formatMoney(1234.5)     → "1.234,50"
 *   formatMoney(0)          → "0"
 */
export function formatMoney(
  value: number | null | undefined,
  opts: { alwaysDecimals?: boolean; minDecimals?: 0 | 2 } = {},
): string {
  if (value == null || !Number.isFinite(value)) return '';
  const cents = toCents(value);
  const hasDecimals = cents % 100 !== 0;
  const showDecimals = opts.alwaysDecimals || opts.minDecimals === 2 || hasDecimals;

  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Como formatMoney pero con prefijo `$ `. */
export function formatCOP(value: number | null | undefined): string {
  const s = formatMoney(value);
  return s === '' ? '' : `$ ${s}`;
}

// ─── Helpers para inputs enmascarados ───────────────────────────────────

/**
 * Toma el texto crudo de un input (lo que el usuario tipeó) y lo devuelve
 * con la máscara aplicada (puntos de miles + coma decimal). Limita a 2 decimales.
 *
 * Ejemplos:
 *   maskMoneyInput("1234")       → "1.234"
 *   maskMoneyInput("1234,5")     → "1.234,5"
 *   maskMoneyInput("1.234,567")  → "1.234,56"  (recorta a 2 dec)
 *   maskMoneyInput("abc1.000")   → "1.000"
 */
export function maskMoneyInput(raw: string, allowNegative = false): string {
  if (raw == null) return '';
  // Conservar signo negativo si aplica
  let sign = '';
  let body = raw;
  if (allowNegative && body.trim().startsWith('-')) {
    sign = '-';
    body = body.replace(/^-/, '');
  }
  // Quedarse solo con dígitos y comas
  let cleaned = body.replace(/[^\d,]/g, '');
  // Una sola coma; el resto se concatena al lado decimal
  const parts = cleaned.split(',');
  if (parts.length > 2) {
    cleaned = parts[0] + ',' + parts.slice(1).join('');
  }
  const [intRaw = '', decRaw] = cleaned.split(',');
  // Quitar ceros líderes innecesarios excepto el último (permite "0,5")
  const intTrimmed = intRaw.replace(/^0+(?=\d)/, '');
  // Insertar puntos cada 3 dígitos desde la derecha
  const intGrouped = intTrimmed.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  // Limitar decimales a 2
  const decLimited = decRaw === undefined ? undefined : decRaw.slice(0, 2);
  const result = decLimited === undefined ? intGrouped : `${intGrouped},${decLimited}`;
  return sign + result;
}
