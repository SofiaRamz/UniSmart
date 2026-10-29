export const DAYS = [
  { value: 1, label: "Lunes", short: "Lun" },
  { value: 2, label: "Martes", short: "Mar" },
  { value: 3, label: "Miércoles", short: "Mié" },
  { value: 4, label: "Jueves", short: "Jue" },
  { value: 5, label: "Viernes", short: "Vie" },
  { value: 6, label: "Sábado", short: "Sáb" },
];

export const STATUS_LABELS = {
  recibido: "Recibido",
  en_revision: "En revisión",
  asignado: "Asignado",
  en_proceso: "En proceso",
  resuelto: "Resuelto",
  descartado: "Descartado",
};

export const STATUS_TONE = {
  recibido: "info",
  en_revision: "warn",
  asignado: "warn",
  en_proceso: "signal",
  resuelto: "ok",
  descartado: "neutral",
};

export const DOC_STATUS = {
  processing: { label: "Procesando", tone: "warn" },
  indexed: { label: "Indexado", tone: "ok" },
  failed: { label: "Con error", tone: "danger" },
};

export const MODULE_LABELS = {
  documents: "Documentos",
  schedules: "Horarios",
  reports: "Reportes",
  locations: "Ubicaciones",
};

export const LOCATION_KINDS = {
  edificio: { label: "Edificio", glyph: "E" },
  aula: { label: "Aula", glyph: "A" },
  oficina: { label: "Oficina", glyph: "O" },
  servicio: { label: "Servicio", glyph: "S" },
  acceso: { label: "Acceso", glyph: "↧" },
  area_verde: { label: "Área verde", glyph: "V" },
  deportivo: { label: "Deportivo", glyph: "D" },
  estacionamiento: { label: "Estacionamiento", glyph: "P" },
};

export const ROUTE_LABELS = {
  schedule: { label: "Horario oficial", tone: "pine" },
  location: { label: "Mapa del campus", tone: "info" },
  documents: { label: "Documento oficial", tone: "ok" },
  clarify: { label: "Necesito un dato", tone: "warn" },
  no_info: { label: "Sin información oficial", tone: "neutral" },
  llm_unavailable: { label: "Modelo no disponible", tone: "danger" },
};

const dateFmt = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function fmtDate(iso) {
  return iso ? dateFmt.format(new Date(iso)) : "—";
}

export function fmtDateTime(iso) {
  return iso ? dateTimeFmt.format(new Date(iso)) : "—";
}

export function fmtBytes(n) {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

// Color estable por materia para las bandas del horario
const SLOT_COLORS = ["#1d5a48", "#23629f", "#a7680a", "#7a3e8e", "#b3261e", "#2f7d6d", "#5a6b1d", "#8a4b2a"];
export function subjectColor(name = "") {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SLOT_COLORS[h % SLOT_COLORS.length];
}
