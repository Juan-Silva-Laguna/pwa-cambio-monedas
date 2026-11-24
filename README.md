# Cambio PWA (Ionic + React)

Aplicación PWA offline-first inspirada en el diseño compartido: pantalla de conversión y pantalla de selección de monedas.

## Desarrollo

1) Copia [.env.example](/Users/juanignaciosilvalaguna/Desktop/exchange/.env.example) a `.env.local` y define tu API key de CurrencyFreaks.

2) Instala y corre:

```bash
npm install
npm run dev
```

## Build de producción

```bash
npm run build
npm run preview
```

La configuración PWA está en [vite.config.ts](/Users/juanignaciosilvalaguna/Desktop/exchange/vite.config.ts) con `vite-plugin-pwa` y registro automático del service worker desde [main.tsx](/Users/juanignaciosilvalaguna/Desktop/exchange/src/main.tsx).

## Offline + sincronización

- La app inicia sin monedas activas: tú las agregas desde configuración.
- Con internet puedes buscar en el catálogo completo de la API y agregar por selección.
- Sin internet puedes agregar manualmente (código de 3 letras, nombre y equivalencia USD).
- Las monedas y sus tasas quedan guardadas en localStorage.
- El botón **Calibrar tasas** valida/actualiza todas las monedas activas contra la API.
- Si una moneda no existe en la API, queda marcada con icono de advertencia.
- En configuración puedes editar nombre y equivalencia USD de cada moneda activa.
- En conversor, al tocar una tarjeta activa, esa moneda pasa a ser la base y la base anterior entra a la lista.
- En conversor puedes arrastrar y reordenar las monedas en el orden que prefieras.
- Los cálculos usan precisión decimal de alta exactitud (Decimal.js), evitando errores de coma flotante.
- El service worker aplica `stale-while-revalidate` para `https://api.currencyfreaks.com/v2.0/rates/latest`:
  - responde rápido con caché si existe,
  - en paralelo revalida en red,
  - al volver a abrir/consultar, ya entrega la versión más fresca.
