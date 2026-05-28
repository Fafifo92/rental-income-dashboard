'use client';

import { useEffect, useState } from 'react';
import { isDemoMode, exitDemoMode } from '@/lib/demoMode';
import { startDemoTour, startDemoTourIfNeeded } from '@/lib/demoTour';

/**
 * Banner sticky superior visible solo en modo demo.
 * Incluye CTA WhatsApp + botón ver tour + botón salir.
 * Auto-arranca el tour de la página actual la primera vez que se visita.
 */
export default function DemoBanner() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const isOn = isDemoMode();
    setActive(isOn);
    if (isOn) startDemoTourIfNeeded();
  }, []);

  if (!active) return null;

  const handleExit = () => {
    exitDemoMode();
    window.location.href = '/login';
  };

  return (
    <div
      data-tour="demo-banner"
      className="sticky top-0 z-40 w-full bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 text-slate-900 shadow-md"
    >
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-3 flex-wrap text-sm">
        <div className="flex items-center gap-2 font-medium">
          <span>Modo demo activo · Datos ficticios</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => startDemoTour({ force: true })}
            className="px-3 py-1 rounded-md bg-white/30 hover:bg-white/50 text-slate-900 text-xs font-semibold transition-colors"
          >
            Ver tour
          </button>
          <a
            href={`https://wa.me/573013467531?text=${encodeURIComponent('Hola Francisco, vi el demo de STR Analytics y me interesa adquirir acceso.')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
          >
            Adquirir vía WhatsApp
          </a>
          <button
            type="button"
            onClick={handleExit}
            className="px-3 py-1 rounded-md bg-slate-900/20 hover:bg-slate-900/40 text-slate-900 text-xs font-semibold transition-colors"
          >
            Salir del demo
          </button>
        </div>
      </div>
    </div>
  );
}
