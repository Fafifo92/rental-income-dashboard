/**
 * Utilidades de fecha con soporte de zona horaria.
 *
 * El bug clásico: `new Date().toISOString()` devuelve UTC.
 * En Bogotá (GMT-5) a las 11 PM, UTC ya muestra el día siguiente.
 *
 * Solución: Intl.DateTimeFormat con la timezone configurada por el usuario.
 * Fallback: componentes locales del Date (getFullYear/getMonth/getDate).
 */

export const TIMEZONE_CACHE_KEY = 'str_user_timezone';
export const DEFAULT_TZ = 'America/Bogota';

/** Devuelve la fecha de hoy en formato YYYY-MM-DD para la timezone dada. */
export const todayInTZ = (tz: string = DEFAULT_TZ): string => {
  try {
    // 'en-CA' produce YYYY-MM-DD, que es exactamente lo que necesitamos.
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  } catch {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
};

/** Lee la timezone del caché de localStorage (o el default). */
export const getCachedTimezone = (): string => {
  if (typeof window === 'undefined') return DEFAULT_TZ;
  return localStorage.getItem(TIMEZONE_CACHE_KEY) ?? DEFAULT_TZ;
};

/** Guarda la timezone en el caché de localStorage. */
export const setCachedTimezone = (tz: string): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(TIMEZONE_CACHE_KEY, tz);
  }
};

/** Hora "hoy" usando la timezone del usuario (desde localStorage). */
export const todayISO = (): string => todayInTZ(getCachedTimezone());

/** Formatea una fecha YYYY-MM-DD para mostrar en pantalla como DD-MM-YYYY. */
export const formatDateDisplay = (d: string | null | undefined): string => {
  if (!d) return '—';
  const clean = d.slice(0, 10);
  const [y, m, day] = clean.split('-');
  return `${day}-${m}-${y}`;
};

/** Lista curada de timezones para el selector UI. */
export const COMMON_TIMEZONES: { value: string; label: string }[] = [
  // América Latina
  { value: 'America/Bogota',     label: 'Bogotá / Lima / Quito (GMT-5)' },
  { value: 'America/Caracas',    label: 'Caracas (GMT-4)' },
  { value: 'America/La_Paz',     label: 'La Paz / San José (GMT-4)' },
  { value: 'America/Santiago',   label: 'Santiago (GMT-4/-3)' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires / Asunción (GMT-3)' },
  { value: 'America/Sao_Paulo',  label: 'São Paulo / Brasília (GMT-3)' },
  { value: 'America/Mexico_City',label: 'Ciudad de México (GMT-6)' },
  { value: 'America/Managua',    label: 'Guatemala / Managua (GMT-6)' },
  { value: 'America/New_York',   label: 'Nueva York / Miami (GMT-5/-4)' },
  { value: 'America/Chicago',    label: 'Chicago / Dallas (GMT-6/-5)' },
  { value: 'America/Denver',     label: 'Denver (GMT-7/-6)' },
  { value: 'America/Los_Angeles',label: 'Los Ángeles / Vancouver (GMT-8/-7)' },
  // Europa
  { value: 'Europe/Madrid',      label: 'Madrid / Roma / París (GMT+1/+2)' },
  { value: 'Europe/London',      label: 'Londres (GMT+0/+1)' },
  // UTC
  { value: 'UTC',                label: 'UTC (GMT+0)' },
];
