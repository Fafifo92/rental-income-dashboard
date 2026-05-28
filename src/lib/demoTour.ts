// Tour guiado con driver.js. Solo se carga en cliente.
// Tour multi-página: detecta el pathname y arranca el guion correspondiente.
// Auto-arranca una vez por página la primera vez que el usuario entra en modo demo.

import { driver, type Driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import { isDemoMode } from './demoMode';

let activeDriver: Driver | null = null;

const WHATSAPP_HREF = 'https://wa.me/573013467531?text=Hola%20Francisco,%20vi%20el%20demo%20de%20STR%20Analytics%20y%20me%20interesa%20adquirir%20acceso.';
const WHATSAPP_CTA = `<a href="${WHATSAPP_HREF}" target="_blank" rel="noopener" style="display:inline-block;padding:8px 16px;background:#059669;color:white;border-radius:8px;font-weight:600;text-decoration:none">Contactar por WhatsApp</a>`;

type TourStep = DriveStep;

const STEPS: Record<string, TourStep[]> = {
  dashboard: [
    {
      popover: {
        title: 'Bienvenido a STR Analytics',
        description: 'Te guío en menos de un minuto por las funcionalidades clave del panel. Puedes saltar el tour cuando quieras.',
        side: 'over',
        align: 'center',
      },
    },
    {
      element: '[data-tour="dashboard-kpis"]',
      popover: {
        title: 'KPIs financieros',
        description: 'Ingresos, gastos, utilidad neta, ocupación, ADR y RevPAR — todo segmentado por periodo y propiedad.',
      },
    },
    {
      element: '[data-tour="period-selector"]',
      popover: {
        title: 'Selector de periodo',
        description: 'Compara mes actual, últimos 3 meses, año o un rango personalizado. Cada cambio recalcula todo.',
      },
    },
    {
      element: '[data-tour="pnl-chart"]',
      popover: {
        title: 'Gráfica P&L mensual',
        description: 'Ingresos vs gastos con utilidad neta. La granularidad (día/semana/mes) se ajusta automáticamente.',
      },
    },
    {
      element: '[data-tour="occupancy"]',
      popover: {
        title: 'Ocupación por propiedad',
        description: 'Grilla día a día por cada propiedad. Detecta huecos y solapamientos al instante.',
      },
    },
    {
      element: '[data-tour="nav-properties"]',
      popover: {
        title: 'Propiedades',
        description: 'Tu portafolio: tarifas, RNT, grupos y etiquetas. Sigue el tour entrando aquí.',
      },
    },
    {
      element: '[data-tour="nav-bookings"]',
      popover: {
        title: 'Reservas',
        description: 'Importa desde Airbnb/Booking, registra directas, controla payouts y ajustes.',
      },
    },
    {
      element: '[data-tour="nav-expenses"]',
      popover: {
        title: 'Gastos',
        description: 'Fijos recurrentes y variables por reserva. Asigna a cuentas bancarias y marca como pagado.',
      },
    },
    {
      popover: {
        title: '¿Te gustó lo que viste?',
        description: `<p style="margin-bottom:8px">Escríbeme por WhatsApp y activo tu cuenta real en minutos.</p>${WHATSAPP_CTA}`,
        side: 'over',
        align: 'center',
      },
    },
  ],
  bookings: [
    {
      popover: {
        title: 'Reservas',
        description: 'Acá vives el día a día: importas reservas, controlas payouts, gestionas ajustes y depósitos de seguridad.',
        side: 'over',
        align: 'center',
      },
    },
    {
      element: '[data-tour="bookings-table"]',
      popover: {
        title: 'Listado de reservas',
        description: 'Cada fila se puede abrir como detalle: huésped, montos, canal, ajustes, depósito.',
      },
    },
    {
      element: '[data-tour="bookings-filters"]',
      popover: {
        title: 'Filtros',
        description: 'Filtra por estado, canal, propiedad y fecha. Ideal para reconciliar contra el extracto del banco.',
      },
    },
    {
      element: '[data-tour="bookings-import"]',
      popover: {
        title: 'Importar CSV',
        description: 'Sube el reporte de Airbnb o Booking y lo deduplico contra lo existente.',
      },
    },
    {
      popover: {
        title: 'Listo en reservas',
        description: `<p style="margin-bottom:8px">Sigue explorando gastos, cuentas, propiedades — o agenda una llamada conmigo.</p>${WHATSAPP_CTA}`,
        side: 'over',
        align: 'center',
      },
    },
  ],
  expenses: [
    {
      popover: {
        title: 'Gastos',
        description: 'Fijos recurrentes, variables por reserva, mantenimientos puntuales — todo en un mismo libro.',
        side: 'over',
        align: 'center',
      },
    },
    {
      element: '[data-tour="expenses-summary"]',
      popover: { title: 'Resumen', description: 'Totales por categoría, propiedad y estado de pago.' },
    },
    {
      element: '[data-tour="expenses-table"]',
      popover: { title: 'Listado', description: 'Cada gasto se puede editar, marcar como pagado y vincular a una cuenta bancaria.' },
    },
    {
      element: '[data-tour="expenses-add"]',
      popover: { title: 'Crear gasto', description: 'Modal para agregar manualmente o desde una factura compartida.' },
    },
    {
      popover: {
        title: '¿Tienes preguntas?',
        description: WHATSAPP_CTA,
        side: 'over',
        align: 'center',
      },
    },
  ],
  properties: [
    {
      popover: {
        title: 'Propiedades',
        description: 'Tu portafolio organizado por grupos (edificios/ciudades) y etiquetado por características.',
        side: 'over',
        align: 'center',
      },
    },
    {
      element: '[data-tour="properties-grid"]',
      popover: { title: 'Vista de grilla', description: 'Cada tarjeta muestra tarifa base, RNT, grupo y etiquetas.' },
    },
    {
      element: '[data-tour="properties-groups"]',
      popover: { title: 'Grupos', description: 'Agrupa por edificio, ciudad o socio. Los KPIs se filtran por grupo.' },
    },
    {
      popover: {
        title: 'Continúa el tour',
        description: `${WHATSAPP_CTA}`,
        side: 'over',
        align: 'center',
      },
    },
  ],
  accounts: [
    {
      popover: {
        title: 'Cuentas bancarias',
        description: 'Cada movimiento (payout, gasto, depósito) queda anclado a una cuenta y reconciliable contra el extracto.',
        side: 'over',
        align: 'center',
      },
    },
    {
      element: '[data-tour="accounts-list"]',
      popover: { title: 'Saldos en vivo', description: 'Calculados a partir de payouts, gastos pagados, depósitos manuales y depósitos de seguridad.' },
    },
    {
      element: '[data-tour="accounts-tx"]',
      popover: { title: 'Historial de transacciones', description: 'Cada cuenta tiene su libro: payout, gasto, multa, depósito.' },
    },
    {
      popover: {
        title: 'Listo en cuentas',
        description: WHATSAPP_CTA,
        side: 'over',
        align: 'center',
      },
    },
  ],
  vendors: [
    {
      popover: {
        title: 'Proveedores',
        description: 'Aseo, mantenimiento, lavandería — con tarifas, propiedades asignadas y centro de costos.',
        side: 'over',
        align: 'center',
      },
    },
    {
      element: '[data-tour="vendors-list"]',
      popover: { title: 'Listado', description: 'Cada proveedor liga sus gastos a las propiedades correspondientes.' },
    },
    {
      popover: { title: '¿Te interesa?', description: WHATSAPP_CTA, side: 'over', align: 'center' },
    },
  ],
  inventory: [
    {
      popover: {
        title: 'Inventario',
        description: 'Activos por propiedad (TV, sábanas, electrodomésticos), su estado, fecha de compra y vida útil.',
        side: 'over',
        align: 'center',
      },
    },
    {
      element: '[data-tour="inventory-list"]',
      popover: { title: 'Items', description: 'Marca daños, programa mantenimientos, vincula a un gasto de reparación.' },
    },
    {
      popover: { title: '¿Quieres acceso?', description: WHATSAPP_CTA, side: 'over', align: 'center' },
    },
  ],
  cleanings: [
    {
      popover: {
        title: 'Aseo',
        description: 'Cada turno de aseo se liga a una reserva y al pago de la persona encargada.',
        side: 'over',
        align: 'center',
      },
    },
    {
      popover: { title: '¿Te interesa?', description: WHATSAPP_CTA, side: 'over', align: 'center' },
    },
  ],
  generic: [
    {
      popover: {
        title: 'Modo demo',
        description: 'Estás explorando STR Analytics con datos de muestra. Navega libremente — cualquier acción de escritura te llevará al contacto por WhatsApp.',
        side: 'over',
        align: 'center',
      },
    },
    {
      popover: { title: '¿Te interesa?', description: WHATSAPP_CTA, side: 'over', align: 'center' },
    },
  ],
};

const pageFromPath = (path: string): keyof typeof STEPS => {
  if (path.startsWith('/dashboard')) return 'dashboard';
  if (path.startsWith('/bookings')) return 'bookings';
  if (path.startsWith('/expenses')) return 'expenses';
  if (path.startsWith('/properties')) return 'properties';
  if (path.startsWith('/accounts')) return 'accounts';
  if (path.startsWith('/vendors')) return 'vendors';
  if (path.startsWith('/inventory')) return 'inventory';
  if (path.startsWith('/cleaning') || path.startsWith('/aseo')) return 'cleanings';
  return 'generic';
};

const tourDoneKey = (page: string) => `str_demo_tour_done__${page}`;

const isPageTourDone = (page: string): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(tourDoneKey(page)) === '1';
  } catch {
    return false;
  }
};

const markPageTourDone = (page: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(tourDoneKey(page), '1');
  } catch {
    /* ignore */
  }
};

export interface StartTourOptions {
  /** Si true, ignora el flag "ya completado". */
  force?: boolean;
  /** Override del page detectado por pathname. */
  page?: keyof typeof STEPS;
}

export const startDemoTour = (opts: StartTourOptions = {}): void => {
  if (typeof window === 'undefined') return;
  if (!isDemoMode()) return;

  const page = opts.page ?? pageFromPath(window.location.pathname);
  if (!opts.force && isPageTourDone(page)) return;

  if (activeDriver) {
    try { activeDriver.destroy(); } catch { /* ignore */ }
    activeDriver = null;
  }

  // Filtra steps cuyo target no existe en el DOM actual.
  const steps = (STEPS[page] ?? STEPS.generic).filter(s => {
    if (!s.element) return true;
    if (typeof s.element !== 'string') return true;
    return !!document.querySelector(s.element);
  });

  if (steps.length === 0) return;

  activeDriver = driver({
    showProgress: true,
    allowClose: true,
    overlayColor: 'rgba(15, 23, 42, 0.75)',
    progressText: '{{current}} / {{total}}',
    nextBtnText: 'Siguiente',
    prevBtnText: 'Atrás',
    doneBtnText: 'Listo',
    onDestroyed: () => {
      markPageTourDone(page);
      activeDriver = null;
    },
    steps,
  });

  activeDriver.drive();
};

/** Llamar al montar cualquier página. Auto-arranca solo si modo demo + tour de la página no completado. */
export const startDemoTourIfNeeded = (): void => {
  if (typeof window === 'undefined') return;
  if (!isDemoMode()) return;
  const page = pageFromPath(window.location.pathname);
  if (isPageTourDone(page)) return;
  // Pequeño delay para que el DOM esté listo y los targets existan.
  setTimeout(() => startDemoTour(), 600);
};
