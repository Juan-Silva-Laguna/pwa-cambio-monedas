# Cambio PWA (Ionic + React)

Aplicación de conversión de monedas **offline-first** basada en PWA.

## Qué se implementó

- UI móvil de conversor + configuración de monedas.
- Gestión de monedas activas en local (sin depender de backend propio).
- Búsqueda de monedas desde catálogo oficial de CurrencyFreaks.
- Alta manual offline (código, nombre y equivalencia USD).
- Calibración online de tasas con API.
- Cambio de moneda base tocando una tarjeta del conversor.
- Reordenamiento de monedas por arrastre (touch) con `IonReorderGroup`.
- Persistencia local de:
  - catálogo,
  - monedas activas,
  - moneda base,
  - tasas y última fecha de sincronización.
- Precisión alta de cálculo con `decimal.js` (evita errores de coma flotante).
- Formato visual de resultados aproximado a **1-2 decimales**.

## Stack y archivos clave

- Framework UI: Ionic React
- Bundler: Vite
- PWA: `vite-plugin-pwa` + Workbox
- Precisión numérica: `decimal.js`

Archivos principales:

- [App.tsx](/Users/juanignaciosilvalaguna/Desktop/exchange/src/App.tsx)
- [App.css](/Users/juanignaciosilvalaguna/Desktop/exchange/src/App.css)
- [main.tsx](/Users/juanignaciosilvalaguna/Desktop/exchange/src/main.tsx)
- [vite.config.ts](/Users/juanignaciosilvalaguna/Desktop/exchange/vite.config.ts)

## Configuración local

1. Copia [`.env.example`](/Users/juanignaciosilvalaguna/Desktop/exchange/.env.example) a `.env.local`.
2. Define tu API key:

```env
VITE_CURRENCYFREAKS_API_KEY=tu_api_key
```

3. Instala dependencias:

```bash
npm install
```

4. Ejecuta en desarrollo:

```bash
npm run dev
```

## Scripts

```bash
npm run dev
npm run lint
npm run build
npm run preview
```

## Flujo funcional (online/offline)

### 1) App limpia al iniciar
- La app puede iniciar sin monedas activas.
- El usuario define qué monedas quiere usar.

### 2) Agregar moneda con internet
- Se busca en catálogo.
- Se agrega por selección.
- Se intenta obtener tasa real desde `/rates/latest`.
- Se guarda localmente.

### 3) Agregar moneda sin internet
- Se agrega manualmente con:
  - código de 3 letras,
  - nombre,
  - equivalencia `1 moneda = ? USD`.
- Se guarda localmente para uso offline.

### 4) Calibrar tasas
- Botón **Calibrar tasas**:
  - consulta API para monedas activas + base,
  - actualiza tasas locales,
  - marca con advertencia monedas no reconocidas por API.

### 5) Conversor
- Al tocar una moneda activa, esa moneda pasa a ser la base.
- La base anterior entra a la lista activa.
- Se puede reordenar el listado por arrastre.

## PWA y funcionamiento offline real

La app registra Service Worker y usa caché runtime con estrategia **stale-while-revalidate** para tasas.

Importante:
- En `npm run dev` por IP local (`http://192.168...`) la prueba offline puede fallar.
- La prueba real de PWA instalada debe hacerse en URL **HTTPS** de producción.

### Pasos recomendados para validar offline en celular

1. Publicar la app en HTTPS (Vercel/Netlify u otro).
2. Abrir la URL en el celular con internet.
3. Navegar una vez por la app.
4. Agregar a pantalla de inicio.
5. Abrir desde el ícono instalado.
6. Desactivar internet y validar uso offline.

## Notas de seguridad

- La key `VITE_*` vive en frontend y puede ser visible.
- Para producción estricta, lo ideal es usar un backend/proxy para proteger la API key.

## Estado actual

Funcional para el objetivo solicitado:
- operación offline con datos locales,
- sincronización/calibración online,
- edición y orden de monedas,
- cambio de base dinámico,
- cálculos de alta precisión.
