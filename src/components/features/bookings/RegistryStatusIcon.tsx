'use client';
/**
 * RegistryStatusIcon
 * ==================
 * Ícono pequeño con tooltip rico (burbuja flotante) usado en la columna
 * "Registro" de la tabla de reservas.
 *
 * El tooltip usa `position: fixed` con coordenadas calculadas desde
 * getBoundingClientRect(), escapando cualquier overflow-hidden / overflow-x-auto
 * del árbol de contenedores (DataTable, acordeón, etc.).
 */
import { useState, useRef, useId, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';

export type RegistryTone = 'gray' | 'amber' | 'emerald' | 'rose' | 'blue';

const TONE_CLASS: Record<RegistryTone, string> = {
  gray:    'text-slate-200',
  amber:   'text-amber-500',
  emerald: 'text-emerald-500',
  rose:    'text-rose-500',
  blue:    'text-blue-500',
};

const TIP_WIDTH  = 220; // max-w en px — debe coincidir con el estilo inline
const EDGE_MARGIN = 8;  // px mínimos respecto al borde del viewport
const TIP_GAP    = 8;   // distancia vertical entre ícono y tooltip

export interface RegistryStatusIconProps {
  Icon: LucideIcon;
  tone: RegistryTone;
  label: string;
  tooltip: React.ReactNode;
  className?: string;
}

interface TipPos { left: number; top: number; arrowLeft: number; }

export default function RegistryStatusIcon({
  Icon, tone, label, tooltip, className = '',
}: RegistryStatusIconProps): JSX.Element {
  const [pos, setPos]   = useState<TipPos | null>(null);
  const ref             = useRef<HTMLSpanElement>(null);
  const tipId           = useId();

  const computePos = useCallback((): TipPos | null => {
    if (!ref.current) return null;
    const r   = ref.current.getBoundingClientRect();
    const vw  = window.innerWidth;

    // Centro del ícono
    const iconMidX = r.left + r.width / 2;
    // Posición vertical: justo encima del ícono
    const top = r.top - TIP_GAP;

    // Posición horizontal: centrar el tooltip sobre el ícono, respetando bordes
    let left = iconMidX - TIP_WIDTH / 2;
    left = Math.max(EDGE_MARGIN, Math.min(left, vw - TIP_WIDTH - EDGE_MARGIN));

    // Offset de la flecha respecto al tooltip (para que siga apuntando al ícono)
    const arrowLeft = Math.max(8, Math.min(iconMidX - left, TIP_WIDTH - 8));

    return { left, top, arrowLeft };
  }, []);

  const handleOpen = useCallback(() => setPos(computePos()), [computePos]);
  const handleClose = useCallback(() => setPos(null), []);

  const open = pos !== null;

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={handleOpen}
      onMouseLeave={handleClose}
      onFocus={handleOpen}
      onBlur={handleClose}
      tabIndex={0}
      aria-label={label}
      aria-describedby={open ? tipId : undefined}
    >
      <Icon className={`w-4 h-4 transition-colors ${TONE_CLASS[tone]} ${className}`} />

      {open && typeof document !== 'undefined' && createPortal(
        <span
          role="tooltip"
          id={tipId}
          style={{
            position: 'fixed',
            left: pos!.left,
            top: pos!.top,
            transform: 'translateY(-100%)',
            width: TIP_WIDTH,
            zIndex: 9999,
          }}
          className="pointer-events-none px-2.5 py-1.5
                     rounded-md bg-slate-900 text-white text-[11px] leading-snug
                     shadow-lg whitespace-normal text-left"
        >
          {tooltip}
          {/* Flecha apuntando al ícono */}
          <span
            style={{ left: pos!.arrowLeft }}
            className="absolute top-full -mt-px -translate-x-1/2
                       border-4 border-transparent border-t-slate-900"
          />
        </span>,
        document.body,
      )}
    </span>
  );
}
