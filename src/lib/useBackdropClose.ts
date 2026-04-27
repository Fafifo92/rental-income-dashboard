import { useRef, useCallback } from 'react';

/**
 * Evita que un modal se cierre cuando el usuario:
 *   1. Hace mousedown dentro del contenido del modal
 *   2. Arrastra el cursor hacia afuera (p.ej. al seleccionar texto)
 *   3. Suelta (mouseup) sobre el backdrop
 *
 * Sólo se cierra si el botón del ratón se presionó Y se soltó
 * directamente sobre el backdrop (currentTarget).
 *
 * Uso:
 *   const backdrop = useBackdropClose(onClose);
 *   <div {...backdrop} className="fixed inset-0 bg-black/40 ...">
 *     <div onClick={e => e.stopPropagation()}>...</div>
 *   </div>
 */
export function useBackdropClose(onClose: () => void) {
  const mouseDownOnBackdrop = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    mouseDownOnBackdrop.current = e.target === e.currentTarget;
  }, []);

  const onMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (mouseDownOnBackdrop.current && e.target === e.currentTarget) {
        onClose();
      }
      mouseDownOnBackdrop.current = false;
    },
    [onClose],
  );

  return { onMouseDown, onMouseUp };
}

/**
 * Variante sin hook — útil dentro de bloques condicionales (AnimatePresence)
 * donde no se puede llamar un hook. Cada render crea un par de handlers
 * nuevos pero comparten closure dentro del mismo par mousedown/mouseup.
 */
export function makeBackdropHandlers(onClose: () => void) {
  let mouseDownOnBackdrop = false;
  return {
    onMouseDown: (e: React.MouseEvent) => {
      mouseDownOnBackdrop = e.target === e.currentTarget;
    },
    onMouseUp: (e: React.MouseEvent) => {
      if (mouseDownOnBackdrop && e.target === e.currentTarget) onClose();
      mouseDownOnBackdrop = false;
    },
  };
}

