import { Toaster } from 'react-hot-toast';

/**
 * Componente raíz para renderizar los toasts.
 * Se monta una sola vez en el layout para estar disponible en toda la app.
 */
export default function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      gutter={8}
      toastOptions={{
        duration: 4000,
      }}
    />
  );
}
