// Modo demo: activación vía localStorage. No depende de Supabase.
// Cualquier servicio que vea isDemoMode() === true debe retornar fixtures y NUNCA tocar la BD.

const ACTIVE_KEY = 'str_demo_active';
const TOUR_DONE_KEY = 'str_demo_tour_done';

export const isDemoMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(ACTIVE_KEY) === '1';
  } catch {
    return false;
  }
};

export const enterDemoMode = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ACTIVE_KEY, '1');
  } catch {
    /* ignore */
  }
};

export const exitDemoMode = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(ACTIVE_KEY);
    window.localStorage.removeItem(TOUR_DONE_KEY);
  } catch {
    /* ignore */
  }
};

export const isTourDone = (): boolean => {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(TOUR_DONE_KEY) === '1';
  } catch {
    return true;
  }
};

export const markTourDone = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TOUR_DONE_KEY, '1');
  } catch {
    /* ignore */
  }
};

export const resetTour = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(TOUR_DONE_KEY);
  } catch {
    /* ignore */
  }
};
