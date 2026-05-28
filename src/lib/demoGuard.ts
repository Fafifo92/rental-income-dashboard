// Bloqueo de escritura en modo demo. Cualquier servicio create/update/delete
// debe llamar demoBlockWrite() al inicio; si retorna true, hacer return inmediato.
// La UI escucha el evento 'demo:upgrade-prompt' y abre el modal de upgrade.

import { isDemoMode } from './demoMode';

export const DEMO_UPGRADE_EVENT = 'demo:upgrade-prompt';
export const WHATSAPP_NUMBER = '573013467531';
export const WHATSAPP_URL =
  `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
    'Hola Francisco, vi el demo de STR Analytics y me interesa adquirir acceso.',
  )}`;

export interface DemoUpgradePromptDetail {
  action: string;
}

/**
 * Llamar al inicio de cualquier mutación. Si retorna true:
 *  - el modo demo está activo
 *  - se disparó el evento para mostrar el modal de upgrade
 *  - el caller debe retornar inmediatamente sin tocar la BD.
 */
export const demoBlockWrite = (action: string): boolean => {
  if (!isDemoMode()) return false;
  if (typeof window === 'undefined') return true;
  try {
    window.dispatchEvent(
      new CustomEvent<DemoUpgradePromptDetail>(DEMO_UPGRADE_EVENT, {
        detail: { action },
      }),
    );
  } catch {
    /* ignore */
  }
  return true;
};

/** Resultado estándar para mutaciones bloqueadas. */
export const demoWriteBlockedResult = <_T>(): { data: null; error: string } => ({
  data: null,
  error: 'demo_read_only',
});
