// Cliente HTTP único. En modo "live" habla con FastAPI (cookies HttpOnly + encabezado CSRF);
// en modo "demo" responde un backend simulado con el mismo contrato JSON.
import { API_BASE, APP_MODE } from "../config";

let mode = APP_MODE === "live" ? "live" : APP_MODE === "demo" ? "demo" : null;
let csrfToken = null;
let mockModule = null;

export class ApiError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function messageFrom(detail, status) {
  if (!detail) return `Error ${status}`;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : "";
        return `${field ? `${field}: ` : ""}${(d.msg || "").replace("Value error, ", "")}`;
      })
      .join(" · ");
  }
  if (detail.message) return detail.message;
  return `Error ${status}`;
}

export async function detectMode() {
  if (mode) return mode;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${API_BASE}/api/health`, { signal: controller.signal, credentials: "include" });
    clearTimeout(timer);
    const data = res.ok ? await res.json() : null;
    mode = data && data.service === "unismart" ? "live" : "demo";
  } catch {
    mode = "demo";
  }
  return mode;
}

export const getMode = () => mode;
export const setCsrf = (token) => {
  csrfToken = token || null;
};

export async function api(method, path, body, { form = false } = {}) {
  if (mode === "demo") {
    mockModule = mockModule || (await import("./mock.js"));
    return mockModule.mockRequest(method, path, body, { form });
  }
  const headers = { Accept: "application/json" };
  if (body && !form) headers["Content-Type"] = "application/json";
  if (csrfToken && method !== "GET") headers["X-CSRF-Token"] = csrfToken;
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: "include",
      body: body ? (form ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new ApiError(0, "No hay conexión con el servidor. Verifica que el backend esté encendido.");
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, messageFrom(data.detail, res.status), data.detail);
  return data;
}

export const get = (path) => api("GET", path);
export const post = (path, body, opts) => api("POST", path, body, opts);
export const put = (path, body) => api("PUT", path, body);
export const patch = (path, body) => api("PATCH", path, body);
export const del = (path) => api("DELETE", path);
