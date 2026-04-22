# Manual de Configuración y Despliegue

## 1. Configuración de Supabase
Para que la aplicación funcione, debes crear un proyecto en [Supabase](https://supabase.com/) y seguir estos pasos:

1. **Base de Datos:** Ve al editor de SQL en tu dashboard de Supabase y pega el contenido del archivo `supabase/schema.sql`. Esto creará todas las tablas y políticas de seguridad (RLS).
2. **Autenticación:** Habilita el método de Email/Password en la sección de Auth.
3. **Credenciales:** Copia la `Project URL` y la `anon public API key`.

## 2. Configuración Local
1. **Instalar dependencias:** `npm install`
2. **Variables de Entorno:** Crea un archivo `.env` en la raíz con lo siguiente:
   ```env
   PUBLIC_SUPABASE_URL=tu_url_de_supabase
   PUBLIC_SUPABASE_ANON_KEY=tu_clave_anon_de_supabase
   ```
3. **Correr en local:** `npm run dev`
4. **Acceder:** Abre `http://localhost:4321` en tu navegador.

## 3. Guía de Pruebas (Testing)
1. **Registro:** Crea una cuenta desde la página de `/register`.
2. **Propiedad:** El sistema te pedirá crear tu primera propiedad.
3. **Importación:** Ve al Dashboard y usa el componente de "Importar CSV". Usa el archivo de Airbnb que mencionaste.
   - El sistema detectará los nombres de los anuncios.
   - Si es la primera vez, te pedirá asociar ese "Anuncio" a la "Propiedad" que creaste.
4. **Gastos:** Registra un gasto manual (ej: Limpieza) para ver cómo afecta la "Utilidad Neta".

## 4. Despliegue (Hosting)
### Opción Recomendada: Vercel
Es la opción más sencilla para Astro:
1. Sube tu código a un repositorio de GitHub.
2. Conecta GitHub con Vercel.
3. Agrega las variables de entorno (`PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY`) en la configuración del proyecto en Vercel.
4. ¡Listo! Vercel desplegará automáticamente cada cambio.

### Opción: Hostinger (VPS)
Si prefieres Hostinger:
1. Necesitas un VPS con Node.js instalado.
2. Ejecuta `npm run build` en tu local o en el servidor.
3. Usa un gestor de procesos como `pm2` para mantener la app corriendo: `pm2 start dist/server/entry.mjs`.
4. Configura Nginx como proxy inverso para apuntar a la app.
