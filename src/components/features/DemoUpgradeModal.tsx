'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DEMO_UPGRADE_EVENT, WHATSAPP_URL, type DemoUpgradePromptDetail } from '@/lib/demoGuard';

/**
 * Modal global que escucha el evento 'demo:upgrade-prompt' y muestra CTA de WhatsApp.
 * Se monta una sola vez en el Layout.
 */
export default function DemoUpgradeModal() {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<string>('esta acción');

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<DemoUpgradePromptDetail>).detail;
      setAction(detail?.action ?? 'esta acción');
      setOpen(true);
    };
    window.addEventListener(DEMO_UPGRADE_EVENT, handler as EventListener);
    return () => window.removeEventListener(DEMO_UPGRADE_EVENT, handler as EventListener);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 px-6 pt-8 pb-6 text-center text-white">
              <h2 className="text-xl font-bold">Funcionalidad disponible al adquirir</h2>
            </div>
            <div className="px-6 py-6 space-y-4">
              <p className="text-slate-700 text-sm leading-relaxed">
                Estás en <strong>modo demo</strong>. Para <em>{action}</em> y empezar a gestionar tus
                propiedades reales, contáctame por WhatsApp y te activo el acceso completo.
              </p>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800">
                Acceso inmediato &nbsp;·&nbsp; Configuración guiada &nbsp;·&nbsp; Soporte directo
              </div>
              <div className="flex flex-col gap-2 pt-2">
                <a
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/30"
                >
                  Escríbeme por WhatsApp
                </a>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl text-sm transition-colors"
                >
                  Seguir explorando demo
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
