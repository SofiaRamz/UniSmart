// Modo de la aplicación:
//  - "auto": consulta /api/health; si el backend de UniSmart responde, usa la API real; si no, modo demostración.
//  - "demo": siempre usa el backend simulado en el navegador (vista previa en Artifacts).
//  - "live": siempre usa la API real.
/* global __UNISMART_MODE__, __UNISMART_API__ */
export const APP_MODE = typeof __UNISMART_MODE__ !== "undefined" ? __UNISMART_MODE__ : "auto";
// Origen del backend. Vacío = mismo origen (FastAPI sirve el frontend) o proxy de Vite.
export const API_BASE = typeof __UNISMART_API__ !== "undefined" ? __UNISMART_API__ : "";
