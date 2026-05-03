/**
 * Helpers para descripciones de daños.
 *
 * `reportDamage` (services/inventory.ts) embebe un tag de idempotencia en la
 * descripción del expense y de los movimientos:
 *   - `__item:<uuid>` cuando el daño es a un item de inventario.
 *   - `__subject:<texto>` cuando el daño es estructural / no inventariado.
 *
 * Estos tags NO deben mostrarse al usuario, pero sí deben preservarse al
 * editar el gasto para no romper la lógica de matching.
 */

const TAG_RE = /\s*__(?:item|subject):[A-Za-z0-9-]+(?:\s|$)/g;

export interface ParsedDamageDesc {
  /** Texto limpio para mostrar al usuario. */
  visible: string;
  /** Tag tipo `__item:xxx` o `__subject:xxx`. Vacío si no había. */
  tag: string;
}

export const parseDamageDescription = (desc: string | null | undefined): ParsedDamageDesc => {
  if (!desc) return { visible: '', tag: '' };
  const match = desc.match(/__(?:item|subject):[A-Za-z0-9-]+/);
  const tag = match ? match[0] : '';
  const visible = desc.replace(TAG_RE, ' ').replace(/\s{2,}/g, ' ').trim();
  return { visible, tag };
};

/** Devuelve solo el texto visible (sin el tag interno). */
export const cleanDamageDescription = (desc: string | null | undefined): string => {
  return parseDamageDescription(desc).visible;
};

/**
 * Vuelve a componer `visible + tag` para guardar. Si el usuario editó la
 * parte visible, el tag se reanexa al final para preservar idempotencia.
 */
export const composeDamageDescription = (visible: string, tag: string): string | null => {
  const v = (visible ?? '').trim();
  if (!v && !tag) return null;
  if (!tag) return v || null;
  return v ? `${v} ${tag}` : tag;
};
