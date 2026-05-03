/**
 * Wrapper unificado sobre react-hot-toast.
 * Centraliza estilos y semántica para toda la app.
 *
 * Uso:
 *   import { toast } from '@/lib/toast';
 *   toast.success('Reserva guardada');
 *   toast.error('No se pudo guardar');
 *   toast.warning('Hay una superposición');
 *   toast.info('Sincronizando…');
 */

import hot from 'react-hot-toast';

const baseStyle: React.CSSProperties = {
  borderRadius: '12px',
  fontSize: '14px',
  fontWeight: 500,
  padding: '12px 16px',
  maxWidth: '420px',
};

export const toast = {
  success: (msg: string) =>
    hot.success(msg, {
      duration: 3000,
      style: { ...baseStyle, background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0' },
      iconTheme: { primary: '#059669', secondary: '#ecfdf5' },
    }),

  error: (msg: string) =>
    hot.error(msg, {
      duration: 5000,
      style: { ...baseStyle, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' },
      iconTheme: { primary: '#dc2626', secondary: '#fef2f2' },
    }),

  warning: (msg: string) =>
    hot(msg, {
      duration: 4500,
      icon: '⚠️',
      style: { ...baseStyle, background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' },
    }),

  info: (msg: string) =>
    hot(msg, {
      duration: 3500,
      icon: 'ℹ️',
      style: { ...baseStyle, background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' },
    }),

  loading: (msg: string) =>
    hot.loading(msg, {
      style: { ...baseStyle, background: '#f8fafc', color: '#334155', border: '1px solid #e2e8f0' },
    }),

  dismiss: (id?: string) => hot.dismiss(id),

  promise: hot.promise.bind(hot),
};
