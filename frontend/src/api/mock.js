// Backend simulado para el modo demostración (vista previa en Artifacts, sin servidor).
// Respeta el mismo contrato JSON y las mismas reglas que FastAPI: RBAC por departamento,
// horarios exactos desde datos estructurados y respuestas solo con documentos oficiales.
import { ApiError } from "./client";
import demoData from "./demoData.json";

const NO_INFO = "No tengo información oficial sobre esto en los documentos cargados.";
const DAY_NAMES = { 1: "Lunes", 2: "Martes", 3: "Miércoles", 4: "Jueves", 5: "Viernes", 6: "Sábado", 7: "Domingo" };
const STATUS_LABELS = {
  recibido: "Recibido",
  en_revision: "En revisión",
  asignado: "Asignado",
  en_proceso: "En proceso",
  resuelto: "Resuelto",
  descartado: "Descartado",
};
const TRANSITIONS = {
  recibido: ["en_revision", "asignado", "descartado"],
  en_revision: ["asignado", "en_proceso", "descartado"],
  asignado: ["en_proceso", "descartado"],
  en_proceso: ["asignado", "resuelto"],
  resuelto: ["en_proceso"],
  descartado: ["en_revision"],
};
const STATUS_ORDER = Object.keys(STATUS_LABELS);
export const DEMO_PASSWORD = "Demo2026unismart";

// ---------------------------------------------------------------- utilidades
const now = () => new Date().toISOString();
const daysAgo = (d, h = 10) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  t.setHours(h, 15, 0, 0);
  return t.toISOString();
};
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (status, message, detail) => {
  throw new ApiError(status, message, detail ?? message);
};
const norm = (s = "") =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const STOP = new Set(
  "a al algo como con cual cuales cuando cuanto cuanta cuantas cuantos de del donde el ella en entre es esa ese esta este esto hay la las le lo los mas me mi mis muy necesito no nos o para pero por porque puedo puede que quien se ser si sin sobre son su sus tengo tiene un una unos unas y ya yo hola favor saber quiero debo dime".split(
    " ",
  ),
);
const tokens = (s) => norm(s).match(/[a-z0-9]+/g) || [];
const terms = (s) => tokens(s).filter((t) => !STOP.has(t) && t.length >= 3);
const stem = (t) => (t.length > 6 ? t.slice(0, 6) : t);
const SYNONYMS = {
  faltas: ["asistencia", "inasistencias"],
  falta: ["asistencia"],
  reprobar: ["aprobatoria", "extraordinario"],
  repruebo: ["aprobatoria", "extraordinario"],
  inscribirme: ["inscripcion", "inscribirse"],
  inscribo: ["inscripcion"],
  vacaciones: ["inhabiles"],
  festivos: ["inhabiles"],
  credencial: ["credencial", "reposicion"],
  beca: ["becas"],
  promedio: ["promedio", "calificacion"],
  baja: ["baja", "temporal"],
  examenes: ["examenes", "ordinarios"],
  clases: ["clases"],
};
const nextCode = () => {
  const A = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
  const part = () => Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join("");
  return `UNI-${part()}-${part()}`;
};

// ---------------------------------------------------------------- estado inicial
const DEPARTMENTS = [
  { id: 1, code: "CONTROL_ESCOLAR", name: "Control Escolar", description: "Inscripciones, reinscripciones, bajas y kárdex.", is_active: true, modules: ["documents"] },
  { id: 2, code: "SERVICIOS_ESCOLARES", name: "Servicios Escolares", description: "Constancias, credenciales, becas y trámites.", is_active: true, modules: ["documents"] },
  { id: 3, code: "COORDINACION_ACADEMICA", name: "Coordinación Académica", description: "Horarios, aulas, calendario y planes de estudio.", is_active: true, modules: ["documents", "schedules"] },
  { id: 4, code: "MANTENIMIENTO", name: "Mantenimiento", description: "Fallas eléctricas, plomería, mobiliario e infraestructura.", is_active: true, modules: ["reports"] },
  { id: 5, code: "SERVICIOS_CAMPUS", name: "Servicios del Campus", description: "Limpieza, seguridad, áreas verdes y mapa del campus.", is_active: true, modules: ["documents", "locations", "reports"] },
];

const USERS = [
  { id: 1, email: "superadmin@unismart.demo", full_name: "Ana Superadmin", superadmin: true, departments: [] },
  { id: 2, email: "control.escolar@unismart.demo", full_name: "Rocío Treviño", superadmin: false, departments: [1] },
  { id: 3, email: "servicios.escolares@unismart.demo", full_name: "Julián Ortega", superadmin: false, departments: [2] },
  { id: 4, email: "coordinacion.academica@unismart.demo", full_name: "Mtra. Irene Salas", superadmin: false, departments: [3] },
  { id: 5, email: "mantenimiento@unismart.demo", full_name: "Tomás Herrera", superadmin: false, departments: [4] },
  { id: 6, email: "servicios.campus@unismart.demo", full_name: "Lucía Paredes", superadmin: false, departments: [5] },
].map((u) => ({ ...u, is_active: true, locked: false, password: DEMO_PASSWORD, created_at: daysAgo(40), last_login_at: null }));

export const DEMO_ACCOUNTS = USERS.map((u) => ({
  email: u.email,
  label: u.superadmin ? "Superadministración" : DEPARTMENTS.find((d) => d.id === u.departments[0]).name,
}));

const CATEGORIES = [
  { id: 1, code: "electrico", name: "Eléctrico e iluminación", department_id: 4 },
  { id: 2, code: "plomeria", name: "Plomería y fugas", department_id: 4 },
  { id: 3, code: "mobiliario", name: "Mobiliario dañado", department_id: 4 },
  { id: 4, code: "infraestructura", name: "Infraestructura (puertas, ventanas, techos)", department_id: 4 },
  { id: 5, code: "climatizacion", name: "Aire acondicionado y ventilación", department_id: 4 },
  { id: 6, code: "limpieza", name: "Limpieza y sanitarios", department_id: 5 },
  { id: 7, code: "seguridad", name: "Seguridad y accesos", department_id: 5 },
  { id: 8, code: "areas_verdes", name: "Áreas verdes y exteriores", department_id: 5 },
];

const LOCATIONS = demoData.locations.map((l, i) => ({ id: i + 1, ...l, department_id: 5, is_active: true }));
const PERIODS = [{ id: 1, code: "2026-AGO-DIC", name: "Agosto–Diciembre 2026", is_active: true }];
const CLASSROOMS = {};
let ENTRIES = [];

function classroomFor(code, building = "") {
  if (!CLASSROOMS[code]) {
    const name = /^\d+$/.test(code) ? `Aula ${code}` : code;
    const loc = LOCATIONS.find((l) => l.name.toLowerCase() === name.toLowerCase());
    CLASSROOMS[code] = { code, name, building, location_id: loc ? loc.id : null };
  }
  return CLASSROOMS[code];
}

let entrySeq = 1;
function addEntry(row) {
  const [period, group, subject, teacher, classroom, building, day, start, end] = row;
  const p = PERIODS.find((x) => x.code === period) || PERIODS[0];
  classroomFor(classroom, building);
  const dayNum = typeof day === "number" ? day : Object.entries(DAY_NAMES).find(([, n]) => norm(n) === norm(day))?.[0];
  ENTRIES.push({ id: entrySeq++, period_id: p.id, group, subject, teacher: teacher || null, classroom, day: Number(dayNum), start_time: start, end_time: end });
}
demoData.schedule.forEach(addEntry);

const DOCUMENTS = [
  {
    id: 1, department_id: 1, title: "Reglamento General de Estudiantes (ejemplo)", original_filename: "reglamento_general.pdf",
    size_bytes: 482113, page_count: 12, created_at: daysAgo(20), uploaded_by: "Rocío Treviño",
    chunks: [
      [3, "Artículo 8. Para inscribirse por primera vez, el aspirante aceptado debe entregar en Control Escolar acta de nacimiento, CURP, certificado de bachillerato y comprobante de pago de la cuota de inscripción."],
      [4, "Artículo 12. Para tener derecho a examen ordinario el alumno debe cumplir con al menos el 80% de asistencia a las clases del curso. Las inasistencias justificadas por escrito no se contabilizan."],
      [5, "Artículo 15. La calificación mínima aprobatoria es 70 en escala de 0 a 100. Las calificaciones se publican en el portal de Control Escolar al cierre de cada parcial."],
      [6, "Artículo 18. El alumno que no apruebe una asignatura en examen ordinario podrá presentar examen extraordinario hasta en dos asignaturas por periodo, previo pago del derecho correspondiente."],
      [8, "Artículo 24. La baja temporal se solicita en Control Escolar dentro de las primeras cuatro semanas del periodo. Puede autorizarse por un máximo de dos periodos consecutivos."],
    ],
  },
  {
    id: 2, department_id: 2, title: "Guía de Trámites de Servicios Escolares (ejemplo)", original_filename: "guia_tramites.pdf",
    size_bytes: 215880, page_count: 6, created_at: daysAgo(12), uploaded_by: "Julián Ortega",
    chunks: [
      [2, "Constancia de estudios. Se solicita en ventanilla o en línea y se entrega en un plazo de tres días hábiles. Para recogerla se presenta la credencial vigente."],
      [3, "Reposición de credencial. Se requiere una fotografía reciente tamaño infantil y el comprobante de pago. El trámite tarda cinco días hábiles."],
      [5, "Becas institucionales. La convocatoria se publica al inicio de cada periodo. Se requiere promedio mínimo de 85 y no adeudar asignaturas."],
      [6, "Horario de atención. Servicios Escolares atiende de lunes a viernes de 9:00 a 15:00 horas en el Edificio C, planta alta."],
    ],
  },
  {
    id: 3, department_id: 3, title: "Calendario Escolar Agosto–Diciembre 2026 (ejemplo)", original_filename: "calendario_2026b.pdf",
    size_bytes: 98440, page_count: 2, created_at: daysAgo(30), uploaded_by: "Mtra. Irene Salas",
    chunks: [
      [1, "Inicio de clases: 10 de agosto de 2026. Fin de clases: 4 de diciembre de 2026. Periodo de exámenes ordinarios: del 7 al 11 de diciembre de 2026."],
      [1, "Periodo de altas y bajas de asignaturas: del 10 al 21 de agosto de 2026, en Control Escolar."],
      [2, "Días inhábiles: 16 de septiembre, 2 de noviembre y 16 de noviembre de 2026. No habrá clases ni atención en ventanillas."],
    ],
  },
].map((d) => ({ ...d, status: "indexed", is_public: true, error_message: null, indexed_at: d.created_at, chunk_count: d.chunks.length }));

function history(status, days, note = "") {
  const list = [{ from_status: null, to_status: "recibido", public_note: "Reporte recibido", internal_note: "", changed_by: null, created_at: daysAgo(days, 9) }];
  const path = { en_revision: ["en_revision"], asignado: ["en_revision", "asignado"], en_proceso: ["asignado", "en_proceso"], resuelto: ["asignado", "en_proceso", "resuelto"] }[status] || [];
  path.forEach((s, i) => list.push({ from_status: list[list.length - 1].to_status, to_status: s, public_note: i === path.length - 1 ? note : "", internal_note: "", changed_by: "Tomás Herrera", created_at: daysAgo(days - i - 1, 12) }));
  return list;
}
const REPORTS = [
  { id: 1, tracking_code: "UNI-7KQ4-XZ9P", category_id: 1, location_id: 5, location_text: "Aula 18, segunda fila de lámparas", description: "Dos lámparas parpadean y una está fundida; se dificulta leer el pizarrón.", contact_email: "a.morales@alumnos.demo", status: "en_proceso", priority: "media", created_at: daysAgo(4), history: history("en_proceso", 4, "El técnico cambiará las lámparas esta semana") },
  { id: 2, tracking_code: "UNI-M3TB-8HWD", category_id: 2, location_id: 10, location_text: "Baños de la biblioteca, planta baja", description: "Fuga constante en el lavabo de la izquierda.", contact_email: null, status: "recibido", priority: "alta", created_at: daysAgo(1), history: history("recibido", 1) },
  { id: 3, tracking_code: "UNI-9PRF-2CJN", category_id: 6, location_id: 11, location_text: "Cafetería, zona de mesas", description: "Botes de basura llenos desde la mañana.", contact_email: null, status: "resuelto", priority: "baja", created_at: daysAgo(6), history: history("resuelto", 6, "Se reforzó la ruta de limpieza del mediodía") },
  { id: 4, tracking_code: "UNI-HV6Q-4TSA", category_id: 3, location_id: 3, location_text: "Aula 16", description: "Tres pupitres con la paleta suelta.", contact_email: "jperez@alumnos.demo", status: "asignado", priority: "media", created_at: daysAgo(3), history: history("asignado", 3, "Asignado a carpintería") },
  { id: 5, tracking_code: "UNI-B2WN-K7EM", category_id: 7, location_id: 15, location_text: "Acceso principal", description: "La pluma vehicular no baja por completo.", contact_email: null, status: "en_revision", priority: "alta", created_at: daysAgo(2), history: history("en_revision", 2) },
].map((r) => ({ ...r, updated_at: r.history[r.history.length - 1].created_at, resolved_at: r.status === "resuelto" ? r.history[r.history.length - 1].created_at : null }));

const AUDIT = [];
const CHAT_LOG = [];
for (let d = 6; d >= 0; d -= 1) {
  const n = [14, 22, 18, 27, 31, 12, 9][6 - d];
  for (let i = 0; i < n; i += 1) {
    const r = ["schedule", "schedule", "documents", "documents", "location", "no_info", "clarify"][i % 7];
    CHAT_LOG.push({ route: r, answered: !["no_info", "clarify"].includes(r), latency_ms: r === "documents" ? 2400 + ((i * 137) % 1500) : 40 + (i % 30), created_at: daysAgo(d, 8 + (i % 9)) });
  }
}

let session = null; // { userId }
let seq = { doc: 4, report: 6, user: 7, dep: 6, loc: LOCATIONS.length + 1, audit: 1, period: 2 };

// ---------------------------------------------------------------- serializadores (idénticos al backend)
const depRef = (id) => {
  const d = DEPARTMENTS.find((x) => x.id === id);
  return d ? { id: d.id, code: d.code, name: d.name } : null;
};
const serLocation = (l) => ({ id: l.id, name: l.name, kind: l.kind, description: l.description, latitude: l.latitude, longitude: l.longitude, department: depRef(l.department_id), is_active: l.is_active });
const serEntry = (e) => {
  const p = PERIODS.find((x) => x.id === e.period_id);
  const c = CLASSROOMS[e.classroom];
  return { id: e.id, period: { id: p.id, code: p.code, name: p.name }, group: e.group, subject: e.subject, teacher: e.teacher, classroom: e.classroom, classroom_name: c.name, building: c.building, location_id: c.location_id, day: e.day, day_name: DAY_NAMES[e.day], start_time: e.start_time, end_time: e.end_time };
};
const serCategory = (c) => ({ id: c.id, code: c.code, name: c.name, department: depRef(c.department_id).name });
const reportDept = (r) => CATEGORIES.find((c) => c.id === r.category_id).department_id;
const serReportPublic = (r) => ({
  tracking_code: r.tracking_code,
  category: CATEGORIES.find((c) => c.id === r.category_id).name,
  location: LOCATIONS.find((l) => l.id === r.location_id)?.name || r.location_text,
  status: r.status,
  status_label: STATUS_LABELS[r.status],
  created_at: r.created_at,
  updated_at: r.updated_at,
  history: r.history.map((h) => ({ status: h.to_status, status_label: STATUS_LABELS[h.to_status], public_note: h.public_note, created_at: h.created_at })),
});
const serReportAdmin = (r) => {
  const cat = CATEGORIES.find((c) => c.id === r.category_id);
  return {
    id: r.id, tracking_code: r.tracking_code, category: { id: cat.id, name: cat.name }, department: depRef(cat.department_id),
    location_id: r.location_id, location_name: LOCATIONS.find((l) => l.id === r.location_id)?.name || null, location_text: r.location_text,
    description: r.description, contact_email: r.contact_email, status: r.status, status_label: STATUS_LABELS[r.status], priority: r.priority,
    created_at: r.created_at, updated_at: r.updated_at, resolved_at: r.resolved_at, allowed_transitions: STATUS_ORDER.filter((s) => TRANSITIONS[r.status].includes(s)),
    history: r.history.map((h) => ({ ...h, status_label: STATUS_LABELS[h.to_status] })),
  };
};
const serDoc = (d) => ({ id: d.id, title: d.title, original_filename: d.original_filename, department: depRef(d.department_id), status: d.status, error_message: d.error_message, page_count: d.page_count, chunk_count: d.chunk_count, size_bytes: d.size_bytes, is_public: d.is_public, uploaded_by: d.uploaded_by, created_at: d.created_at, indexed_at: d.indexed_at });
const serUser = (u) => ({ id: u.id, email: u.email, full_name: u.full_name, is_active: u.is_active, is_superadmin: u.superadmin, departments: u.departments.map(depRef).filter(Boolean), last_login_at: u.last_login_at, created_at: u.created_at, locked: u.locked });
const serMe = (u) => ({ id: u.id, email: u.email, full_name: u.full_name, is_superadmin: u.superadmin, departments: u.departments.map((id) => DEPARTMENTS.find((d) => d.id === id)).filter((d) => d && d.is_active).map((d) => ({ id: d.id, code: d.code, name: d.name, modules: [...d.modules].sort() })), csrf_token: "demo-csrf" });

// ---------------------------------------------------------------- autorización (misma lógica que deps.py)
function currentUser() {
  const u = session && USERS.find((x) => x.id === session.userId);
  if (!u || !u.is_active) fail(401, "Inicia sesión para continuar");
  return u;
}
function deptIds(u, module) {
  return u.departments.filter((id) => {
    const d = DEPARTMENTS.find((x) => x.id === id);
    return d && d.is_active && d.modules.includes(module);
  });
}
function requireModule(module) {
  const u = currentUser();
  if (!u.superadmin && deptIds(u, module).length === 0) fail(403, "Tu departamento no tiene acceso a este módulo");
  return u;
}
const can = (u, module, depId) => u.superadmin || deptIds(u, module).includes(depId);
function requireSuper() {
  const u = currentUser();
  if (!u.superadmin) fail(403, "Solo el superadministrador puede hacer esto");
  return u;
}
function audit(u, action, entity_type, entity_id, details = {}) {
  AUDIT.unshift({ id: seq.audit++, created_at: now(), user: u ? u.email : null, action, entity_type, entity_id: entity_id == null ? null : String(entity_id), details, ip_address: "127.0.0.1" });
}

// ---------------------------------------------------------------- horarios
function activePeriod() {
  return PERIODS.find((p) => p.is_active) || PERIODS[PERIODS.length - 1];
}
function searchEntries({ period_id, groups, classrooms, day, teacher, subject } = {}) {
  const pid = period_id ? Number(period_id) : activePeriod()?.id;
  return ENTRIES.filter(
    (e) =>
      e.period_id === pid &&
      (!groups || groups.includes(e.group)) &&
      (!classrooms || classrooms.includes(e.classroom)) &&
      (!day || e.day === Number(day)) &&
      (!teacher || e.teacher === teacher) &&
      (!subject || e.subject === subject),
  ).sort((a, b) => a.group.localeCompare(b.group) || a.day - b.day || a.start_time.localeCompare(b.start_time));
}
const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
function conflictsFor(entry, excludeId) {
  const out = [];
  ENTRIES.filter((e) => e.id !== excludeId && e.period_id === entry.period_id && e.day === entry.day && overlaps(e.start_time, e.end_time, entry.start_time, entry.end_time)).forEach((o) => {
    const when = `${DAY_NAMES[o.day]} ${o.start_time}-${o.end_time}`;
    if (o.group === entry.group) out.push(`El grupo ${o.group} ya tiene ${o.subject} (${when})`);
    if (o.classroom === entry.classroom) out.push(`El aula ${o.classroom} está ocupada por ${o.group} (${when})`);
    if (entry.teacher && o.teacher === entry.teacher) out.push(`${o.teacher} ya imparte clase a ${o.group} (${when})`);
  });
  return out;
}
const pad = (t) => {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?\s*$/i.exec(t || "");
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const mer = (m[3] || "").toLowerCase().replace(/[.\s]/g, "");
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
};
const DAY_LOOKUP = Object.fromEntries(Object.entries(DAY_NAMES).flatMap(([n, name]) => [[norm(name), Number(n)], [norm(name).slice(0, 3), Number(n)], [n, Number(n)]]));

function parseCsv(text) {
  const first = text.split(/\r?\n/)[0] || "";
  const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = "";
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === delim && !quoted) {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    rows.push(cells.map((c) => c.trim()));
  }
  return rows;
}

function validateCsv(text) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const errors = [];
  const valid = [];
  if (!rows.length) return { valid, errors: [{ line: 1, field: "encabezado", message: "El archivo está vacío" }] };
  const header = rows[0].map((h) => norm(h).replace(/\s+/g, "_"));
  const required = ["periodo", "grupo", "materia", "aula", "dia", "hora_inicio", "hora_fin"];
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length) return { valid, errors: [{ line: 1, field: "encabezado", message: `Faltan columnas: ${missing.join(", ")}` }] };
  rows.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (c) => (header.indexOf(c) >= 0 ? cells[header.indexOf(c)] || "" : "");
    const rowErrors = required.filter((c) => !get(c)).map((c) => ({ line, field: c, message: "Campo obligatorio vacío" }));
    const day = DAY_LOOKUP[norm(get("dia"))];
    const start = pad(get("hora_inicio"));
    const end = pad(get("hora_fin"));
    if (get("dia") && !day) rowErrors.push({ line, field: "dia", message: `Día no reconocido: ${get("dia")}` });
    if (get("hora_inicio") && !start) rowErrors.push({ line, field: "hora_inicio", message: `Hora inválida: ${get("hora_inicio")}` });
    if (get("hora_fin") && !end) rowErrors.push({ line, field: "hora_fin", message: `Hora inválida: ${get("hora_fin")}` });
    if (start && end && end <= start) rowErrors.push({ line, field: "hora_fin", message: "La hora de fin debe ser posterior a la de inicio" });
    if (rowErrors.length) return errors.push(...rowErrors);
    valid.push({ line, period: get("periodo").toUpperCase(), group: get("grupo").toUpperCase().replace(/\s/g, ""), subject: get("materia"), teacher: get("docente"), classroom: get("aula").toUpperCase().replace(/^(AULA|SAL[OÓ]N)\s*/, "").replace(/\s/g, ""), building: get("edificio"), day, start_time: start, end_time: end });
  });
  valid.forEach((a, i) =>
    valid.slice(i + 1).forEach((b) => {
      if (a.period !== b.period || a.day !== b.day || !overlaps(a.start_time, a.end_time, b.start_time, b.end_time)) return;
      const when = `${DAY_NAMES[a.day]} ${a.start_time}-${a.end_time}`;
      if (a.group === b.group) errors.push({ line: b.line, field: "grupo", message: `Empalme del grupo ${a.group} con la línea ${a.line} (${when})` });
      if (a.classroom === b.classroom) errors.push({ line: b.line, field: "aula", message: `Empalme del aula ${a.classroom} con la línea ${a.line} (${when})` });
      if (a.teacher && a.teacher === b.teacher) errors.push({ line: b.line, field: "docente", message: `Empalme de ${a.teacher} con la línea ${a.line} (${when})` });
    }),
  );
  return { valid, errors };
}

// ---------------------------------------------------------------- chat (misma estrategia que services/chat.py)
const GROUP_RE = /\b(\d{1,2})\s?(?:°|º)?\s?([a-z]{1,3})\b/g;
const ROOM_RE = /\b(?:aula|aulas|salon|salones|sala|laboratorio|lab)\s*(?:no\.?|num\.?|numero|#)?\s*([a-z]?\d{1,3}[a-z]?)\b/g;
const NOT_GROUP = new Set("a al am pm de del el en la las lo los y o u e con por que mas hr hrs h hs min va es se le me mi su tu un er ra ro do da to ta vo va no na mo ma bis".split(" "));
const STRONG = new Set("clase clases materia materias grupo grupos salon salones aula aulas docente docentes profesor profesora profesores maestro maestra maestros".split(" "));
const SCHED = new Set([...STRONG, ..."horario horarios hora horas toca tocan entra entran tengo".split(" ")]);
const WHERE = new Set("donde ubicacion ubica ubicado ubicada encuentra queda llegar mapa".split(" "));
const DAY_WORDS = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7 };
const GENERIC_LOC = new Set("edificio area zona centro oficina oficinas sala modulo planta aula aulas".split(" "));

function parseQuestion(text) {
  const n = norm(text);
  const all = tokens(text);
  const set = new Set(all);
  const knownGroups = new Set(ENTRIES.map((e) => e.group));
  const knownRooms = new Set(Object.keys(CLASSROOMS));
  const out = { groups: [], unknownGroups: [], rooms: [], unknownRooms: [], day: null, teachers: [], subjects: [], locations: [] };
  const roomSpans = [];
  for (const m of n.matchAll(ROOM_RE)) {
    roomSpans.push([m.index, m.index + m[0].length]);
    const code = m[1].toUpperCase();
    (knownRooms.has(code) ? out.rooms : out.unknownRooms).push(code);
  }
  for (const m of n.matchAll(GROUP_RE)) {
    if (roomSpans.some(([s, e]) => m.index >= s && m.index < e)) continue;
    const code = `${Number(m[1])}${m[2].toUpperCase()}`;
    if (knownGroups.has(code)) out.groups.push(code);
    else if (!NOT_GROUP.has(m[2]) && !DAY_WORDS[m[2]]) out.unknownGroups.push(code);
  }
  for (const t of all) if (DAY_WORDS[t]) out.day = DAY_WORDS[t];
  const today = new Date().getDay() || 7;
  if (!out.day && set.has("hoy")) out.day = today;
  out.sched = all.some((t) => SCHED.has(t));
  out.strong = all.some((t) => STRONG.has(t));
  out.where = all.some((t) => WHERE.has(t));
  const match = (names, people) => {
    const exact = names.filter((x) => n.includes(norm(x)));
    if (exact.length) return exact;
    let best = 0;
    let winners = [];
    names.forEach((x) => {
      let sig = terms(x).filter((t) => t.length >= 4 && !GENERIC_LOC.has(t));
      if (people) sig = sig.filter((t) => !["mtro", "mtra", "lic", "ing"].includes(t)).slice(-2);
      const hits = sig.filter((t) => set.has(t)).length;
      if (hits > best) {
        best = hits;
        winners = [x];
      } else if (hits && hits === best) winners.push(x);
    });
    return winners.length <= 3 ? winners : [];
  };
  out.subjects = match([...new Set(ENTRIES.map((e) => e.subject))], false);
  out.teachers = match([...new Set(ENTRIES.map((e) => e.teacher).filter(Boolean))], true);
  if (out.where) out.locations = match(LOCATIONS.filter((l) => l.is_active).map((l) => l.name), false);
  const entity = out.groups.length || out.rooms.length || ((out.subjects.length || out.teachers.length) && out.sched);
  if (out.unknownGroups.length && !out.groups.length && out.sched) out.route = "schedule";
  else if (out.where && out.locations.length && !out.groups.length) out.route = "location";
  else if (entity) out.route = "schedule";
  else if (out.unknownRooms.length && (out.sched || out.where)) out.route = "schedule";
  else if (out.strong && !out.where) out.route = "clarify";
  else out.route = "documents";
  return out;
}

function chatSchedule(q) {
  const groups = [...new Set(ENTRIES.map((e) => e.group))].sort();
  if (q.unknownGroups.length && !q.groups.length)
    return { answer: `No tengo información oficial sobre el grupo ${q.unknownGroups.join(", ")} en los horarios cargados. Grupos registrados: ${groups.join(", ")}.`, route: "schedule", answered: false, suggestions: groups.slice(0, 3).map((g) => `¿En qué salón toma clases el ${g}?`) };
  if (q.unknownRooms.length && !q.rooms.length && !q.groups.length)
    return { answer: `No tengo información oficial sobre el aula ${q.unknownRooms.join(", ")} en los horarios cargados.`, route: "schedule", answered: false };
  const period = activePeriod();
  const entries = searchEntries({ groups: q.groups.length ? q.groups : null, classrooms: q.rooms.length ? q.rooms : null, day: q.day }).filter(
    (e) => (!q.teachers.length || q.teachers.includes(e.teacher)) && (!q.subjects.length || q.subjects.includes(e.subject)),
  );
  const rooms = [...new Set(entries.map((e) => e.classroom))];
  const roomCodes = rooms.length ? rooms : q.rooms;
  let location = null;
  if (q.where && roomCodes.length === 1) {
    const loc = LOCATIONS.find((l) => l.id === CLASSROOMS[roomCodes[0]]?.location_id);
    if (loc) location = serLocation(loc);
  }
  if (!entries.length) {
    const target = [q.groups.length && `el grupo ${q.groups.join(", ")}`, q.rooms.length && `el aula ${q.rooms.join(", ")}`].filter(Boolean).join(" ") || "esa consulta";
    const when = q.day ? ` el ${DAY_NAMES[q.day].toLowerCase()}` : "";
    if (location) return { answer: `${location.name}: ${location.description}\nNo hay clases registradas para ${target}${when} en ${period.name}.`, route: "location", answered: true, location, schedule: [] };
    return { answer: `No hay clases registradas para ${target}${when} en el periodo ${period.name}.`, route: "schedule", answered: Boolean(q.day && (q.groups.length || q.rooms.length)), schedule: [] };
  }
  const lines = [];
  q.groups.forEach((g) => {
    const rs = [...new Set(entries.filter((e) => e.group === g).map((e) => e.classroom))].map((c) => `${CLASSROOMS[c].name}${CLASSROOMS[c].building ? ` (${CLASSROOMS[c].building})` : ""}`);
    if (rs.length) lines.push(`El grupo ${g} toma clases en: ${rs.join(", ")}.`);
  });
  if (q.rooms.length && !q.groups.length)
    q.rooms.forEach((c) => {
      const gs = [...new Set(entries.filter((e) => e.classroom === c).map((e) => e.group))].sort();
      if (gs.length) lines.push(`En el aula ${c} tienen clase los grupos: ${gs.join(", ")}.`);
    });
  if (q.day) lines.push(`Clases del ${DAY_NAMES[q.day].toLowerCase()}:`);
  entries.slice(0, 40).forEach((e) => lines.push(`• ${e.group} · ${DAY_NAMES[e.day]} ${e.start_time}–${e.end_time} · ${e.subject} · ${CLASSROOMS[e.classroom].name}${e.teacher ? ` · ${e.teacher}` : ""}`));
  if (entries.length > 40) lines.push(`… y ${entries.length - 40} clases más. Consulta la sección Horarios para verlas todas.`);
  lines.push(`Fuente: horarios oficiales registrados en el sistema (${period.name}).`);
  let answer = lines.join("\n");
  if (location) answer = `Ubicación: ${location.name}. ${location.description}\n${answer}`;
  return { answer, route: "schedule", answered: true, schedule: entries.map(serEntry), location };
}

function retrieve(question) {
  const qTerms = terms(question);
  const expanded = new Set(qTerms.map(stem));
  qTerms.forEach((t) => (SYNONYMS[t] || []).forEach((s) => expanded.add(stem(s))));
  if (!expanded.size) return [];
  const scored = [];
  DOCUMENTS.filter((d) => d.status === "indexed" && d.is_public).forEach((doc) =>
    doc.chunks.forEach(([page, content], idx) => {
      const cTerms = new Set(terms(`${doc.title} ${content}`).map(stem));
      const hits = [...expanded].filter((t) => cTerms.has(t)).length;
      const coverage = hits / Math.max(1, new Set(qTerms.map(stem)).size);
      if (hits && coverage >= 0.34) scored.push({ doc, page, content, idx, coverage, hits });
    }),
  );
  return scored.sort((a, b) => b.coverage - a.coverage || b.hits - a.hits).slice(0, 3);
}

function bestSentences(question, content) {
  const q = new Set(terms(question).map(stem));
  terms(question).forEach((t) => (SYNONYMS[t] || []).forEach((s) => q.add(stem(s))));
  const sentences = content.split(/(?<=\.)\s+/).filter((s) => s.length > 12);
  const ranked = sentences.map((s) => ({ s, score: terms(s).filter((t) => q.has(stem(t))).length })).sort((a, b) => b.score - a.score);
  return ranked.filter((r) => r.score > 0).slice(0, 2).map((r) => r.s.replace(/^Artículo \d+\.\s*/, ""));
}

function chatDocuments(question) {
  const hits = retrieve(question);
  if (!hits.length) return { answer: NO_INFO, route: "no_info", answered: false };
  const parts = [];
  hits.slice(0, 2).forEach((h, i) => {
    if (i === 1 && h.coverage < hits[0].coverage * 0.9) return;
    const s = bestSentences(question, h.content);
    if (s.length) parts.push(`${s.join(" ")} [${i + 1}]`);
  });
  if (!parts.length) return { answer: NO_INFO, route: "no_info", answered: false };
  const cited = new Set(parts.map((_, i) => i + 1));
  return {
    answer: parts.join("\n\n"),
    route: "documents",
    answered: true,
    sources: hits.map((h, i) => ({ n: i + 1, document_id: h.doc.id, title: h.doc.title, department: depRef(h.doc.department_id).name, page: h.page, snippet: h.content.length > 220 ? `${h.content.slice(0, 217)}…` : h.content, cited: cited.has(i + 1) })),
  };
}

function answerQuestion(message) {
  const q = parseQuestion(message);
  let result;
  if (q.route === "schedule") result = chatSchedule(q);
  else if (q.route === "location") {
    const loc = LOCATIONS.find((l) => l.name === q.locations[0]);
    const extra = q.locations.slice(1, 3);
    result = { answer: `${loc.name}: ${loc.description}\nLo marqué en el mapa del campus.${extra.length ? `\nTambién podría interesarte: ${extra.join(", ")}.` : ""}`, route: "location", answered: true, location: serLocation(loc) };
  } else if (q.route === "clarify") {
    const groups = [...new Set(ENTRIES.map((e) => e.group))].sort();
    result = { answer: `¿De qué grupo o aula necesitas el horario? Por ejemplo: «¿En qué salón toma clases el 3AS?». Grupos registrados: ${groups.join(", ")}.`, route: "clarify", answered: false, suggestions: groups.slice(0, 3).map((g) => `Horario del ${g} el lunes`) };
  } else result = chatDocuments(message);
  return { sources: [], schedule: null, location: null, suggestions: [], ...result };
}

// ---------------------------------------------------------------- rutas
const routes = [];
const on = (method, pattern, handler) =>
  routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`), handler });

on("GET", "/api/health", () => ({ service: "unismart", status: "ok", database: true, llm: false, version: "demo" }));

on("POST", "/api/public/chat", async ({ body }) => {
  const message = (body?.message || "").trim();
  if (message.length < 2 || message.length > 600) fail(422, "message: La pregunta debe tener entre 2 y 600 caracteres");
  const started = performance.now();
  const result = answerQuestion(message);
  await wait(result.route === "documents" ? 900 : 350);
  CHAT_LOG.push({ route: result.route, answered: result.answered, latency_ms: Math.round(performance.now() - started), created_at: now() });
  return result;
});

on("GET", "/api/public/schedules/options", () => {
  const p = activePeriod();
  const es = ENTRIES.filter((e) => e.period_id === p.id);
  return {
    active_period: { id: p.id, code: p.code, name: p.name },
    periods: PERIODS.map((x) => ({ ...x })),
    groups: [...new Set(es.map((e) => e.group))].sort(),
    classrooms: [...new Set(es.map((e) => e.classroom))].sort().map((c) => CLASSROOMS[c]),
    subjects: [...new Set(es.map((e) => e.subject))].sort().map((name, i) => ({ id: i + 1, name })),
    teachers: [...new Set(es.map((e) => e.teacher).filter(Boolean))].sort().map((full_name, i) => ({ id: i + 1, full_name })),
    days: Object.entries(DAY_NAMES).map(([value, label]) => ({ value: Number(value), label })),
  };
});

on("GET", "/api/public/schedules", ({ query }) => ({
  entries: searchEntries({ period_id: query.period_id, groups: query.group ? [query.group.toUpperCase()] : null, classrooms: query.classroom ? [query.classroom.toUpperCase()] : null, day: query.day }).map(serEntry),
}));

on("GET", "/api/public/locations", ({ query }) => ({
  locations: LOCATIONS.filter((l) => l.is_active && (!query.kind || l.kind === query.kind)).sort((a, b) => a.name.localeCompare(b.name)).map(serLocation),
}));

on("GET", "/api/public/documents", () => ({
  documents: DOCUMENTS.filter((d) => d.status === "indexed" && d.is_public).map((d) => ({ id: d.id, title: d.title, department: depRef(d.department_id).name, page_count: d.page_count, indexed_at: d.indexed_at })),
}));

on("GET", "/api/public/report-categories", () => ({ categories: CATEGORIES.map(serCategory) }));

on("POST", "/api/public/reports", async ({ body }) => {
  if (body.website) fail(400, "Solicitud inválida");
  const cat = CATEGORIES.find((c) => c.id === Number(body.category_id));
  if (!cat) fail(422, "Selecciona una categoría válida");
  if ((body.location_text || "").trim().length < 3) fail(422, "location_text: Indica dónde está el problema (mínimo 3 caracteres)");
  if ((body.description || "").trim().length < 10) fail(422, "description: Describe el problema con al menos 10 caracteres");
  if (body.contact_email && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(body.contact_email)) fail(422, "contact_email: Correo electrónico inválido");
  await wait(400);
  const r = { id: seq.report++, tracking_code: nextCode(), category_id: cat.id, location_id: body.location_id || null, location_text: body.location_text.trim(), description: body.description.trim(), contact_email: body.contact_email || null, status: "recibido", priority: "media", created_at: now(), updated_at: now(), resolved_at: null, history: [{ from_status: null, to_status: "recibido", public_note: "Reporte recibido", internal_note: "", changed_by: null, created_at: now() }] };
  REPORTS.unshift(r);
  return { tracking_code: r.tracking_code, status: r.status, status_label: STATUS_LABELS[r.status], department: depRef(cat.department_id).name, created_at: r.created_at };
});

on("GET", "/api/public/reports/:code", ({ params }) => {
  let code = decodeURIComponent(params.code).trim().toUpperCase().replace(/\s/g, "");
  if (code.length === 8 && !code.includes("-")) code = `UNI-${code.slice(0, 4)}-${code.slice(4)}`;
  if (code.length === 9 && code.split("-").length === 2) code = `UNI-${code}`;
  if (!/^UNI-[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/.test(code)) fail(422, "El folio tiene el formato UNI-XXXX-XXXX");
  const r = REPORTS.find((x) => x.tracking_code === code);
  if (!r) fail(404, "No encontramos un reporte con ese folio");
  return serReportPublic(r);
});

// Autenticación
on("POST", "/api/auth/login", async ({ body }) => {
  await wait(300);
  const u = USERS.find((x) => x.email === (body.email || "").trim().toLowerCase());
  if (!u || !u.is_active || u.password !== body.password) fail(401, "Correo o contraseña incorrectos");
  if (u.locked) fail(429, "Cuenta bloqueada temporalmente. Intenta en 15 min.");
  session = { userId: u.id };
  u.last_login_at = now();
  audit(u, "auth.login", "user", u.id);
  return serMe(u);
});
on("POST", "/api/auth/logout", () => {
  if (session) audit(USERS.find((u) => u.id === session.userId), "auth.logout", "user", session.userId);
  session = null;
  return { ok: true };
});
on("GET", "/api/auth/me", () => serMe(currentUser()));
on("POST", "/api/auth/change-password", ({ body }) => {
  const u = currentUser();
  if (body.current_password !== u.password) fail(400, "La contraseña actual no es correcta");
  if ((body.new_password || "").length < 10 || !/\d/.test(body.new_password) || !/[a-z]/i.test(body.new_password)) fail(422, "Debe tener al menos 10 caracteres y combinar letras y números");
  u.password = body.new_password;
  audit(u, "auth.change_password", "user", u.id);
  return { ok: true };
});

// Documentos
on("GET", "/api/admin/documents", () => {
  const u = requireModule("documents");
  return { documents: DOCUMENTS.filter((d) => can(u, "documents", d.department_id)).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(serDoc) };
});
on("POST", "/api/admin/documents", async ({ body }) => {
  const u = requireModule("documents");
  const file = body.get("file");
  const title = (body.get("title") || "").trim();
  let depId = Number(body.get("department_id")) || null;
  const allowed = deptIds(u, "documents");
  if (!depId) depId = allowed.length === 1 ? allowed[0] : fail(422, "Indica el departamento del documento");
  if (!can(u, "documents", depId)) fail(403, "No puedes publicar documentos en otro departamento");
  if (title.length < 3) fail(422, "title: El título debe tener al menos 3 caracteres");
  if (!file || !file.name.toLowerCase().endsWith(".pdf")) fail(400, "Solo se permiten archivos PDF");
  if (file.size > 20 * 1024 * 1024) fail(400, "El archivo supera el límite de 20 MB");
  const head = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
  if (head !== "%PDF-") fail(400, "El contenido no corresponde a un PDF válido");
  const doc = { id: seq.doc++, department_id: depId, title, original_filename: file.name, size_bytes: file.size, page_count: Math.max(1, Math.round(file.size / 45000)), created_at: now(), uploaded_by: u.full_name, status: "processing", is_public: body.get("is_public") !== "false", error_message: null, indexed_at: null, chunk_count: 0, chunks: [] };
  DOCUMENTS.unshift(doc);
  audit(u, "document.upload", "document", doc.id, { title });
  setTimeout(() => {
    doc.chunks = [[1, `${title}. Vista previa de demostración: en el backend real, PyMuPDF extrae el texto de cada página, se fragmenta y se indexa con embeddings locales.`]];
    doc.chunk_count = Math.max(3, doc.page_count * 2);
    doc.status = "indexed";
    doc.indexed_at = now();
  }, 2200);
  return serDoc(doc);
});
const ownedDoc = (u, id) => {
  const d = DOCUMENTS.find((x) => x.id === Number(id));
  if (!d || !can(u, "documents", d.department_id)) fail(404, "Documento no encontrado");
  return d;
};
on("GET", "/api/admin/documents/:id", ({ params }) => {
  const u = requireModule("documents");
  const d = ownedDoc(u, params.id);
  return { ...serDoc(d), chunks_preview: d.chunks.slice(0, 8).map(([page, content], index) => ({ index, page, content })) };
});
on("PATCH", "/api/admin/documents/:id", ({ params, body }) => {
  const u = requireModule("documents");
  const d = ownedDoc(u, params.id);
  if (body.title !== undefined) d.title = body.title;
  if (body.is_public !== undefined) d.is_public = body.is_public;
  audit(u, "document.update", "document", d.id, body);
  return serDoc(d);
});
on("POST", "/api/admin/documents/:id/reindex", ({ params }) => {
  const u = requireModule("documents");
  const d = ownedDoc(u, params.id);
  d.status = "processing";
  setTimeout(() => {
    d.status = "indexed";
    d.indexed_at = now();
  }, 1500);
  audit(u, "document.reindex", "document", d.id);
  return serDoc(d);
});
on("DELETE", "/api/admin/documents/:id", ({ params }) => {
  const u = requireModule("documents");
  const d = ownedDoc(u, params.id);
  DOCUMENTS.splice(DOCUMENTS.indexOf(d), 1);
  audit(u, "document.delete", "document", d.id, { title: d.title });
  return null;
});

// Horarios
on("GET", "/api/admin/periods", () => {
  requireModule("schedules");
  return { periods: PERIODS.map((p) => ({ ...p })).reverse() };
});
on("POST", "/api/admin/periods", ({ body }) => {
  const u = requireModule("schedules");
  const code = (body.code || "").toUpperCase();
  if (!/^[A-Z0-9\-_]{3,30}$/.test(code)) fail(422, "code: Usa solo letras, números y guiones");
  if (PERIODS.some((p) => p.code === code)) fail(409, "Ya existe un periodo con ese código");
  if (body.is_active) PERIODS.forEach((p) => (p.is_active = false));
  const p = { id: seq.period++, code, name: body.name, is_active: Boolean(body.is_active) };
  PERIODS.push(p);
  audit(u, "period.create", "academic_period", p.id, { code });
  return p;
});
on("POST", "/api/admin/periods/:id/activate", ({ params }) => {
  const u = requireModule("schedules");
  const p = PERIODS.find((x) => x.id === Number(params.id)) || fail(404, "Periodo no encontrado");
  PERIODS.forEach((x) => (x.is_active = x.id === p.id));
  audit(u, "period.activate", "academic_period", p.id);
  return p;
});
on("GET", "/api/admin/schedules", ({ query }) => {
  requireModule("schedules");
  return { entries: searchEntries({ period_id: query.period_id, groups: query.group ? [query.group.toUpperCase()] : null, classrooms: query.classroom ? [query.classroom.toUpperCase()] : null, day: query.day }).map(serEntry) };
});
function entryFromBody(body) {
  const group = (body.group || "").trim().toUpperCase();
  const classroom = (body.classroom || "").trim().toUpperCase();
  const start = pad(body.start_time);
  const end = pad(body.end_time);
  if (!group || !classroom || (body.subject || "").trim().length < 2) fail(422, "Completa grupo, materia y aula");
  if (!start || !end) fail(422, "Usa horas en formato HH:MM");
  if (end <= start) fail(422, "end_time: La hora de fin debe ser posterior a la de inicio");
  if (!PERIODS.some((p) => p.id === Number(body.period_id))) fail(404, "Periodo no encontrado");
  classroomFor(classroom, body.building || "");
  return { period_id: Number(body.period_id), group, subject: body.subject.trim(), teacher: (body.teacher || "").trim() || null, classroom, day: Number(body.day), start_time: start, end_time: end };
}
on("POST", "/api/admin/schedules", ({ body }) => {
  const u = requireModule("schedules");
  const e = entryFromBody(body);
  const conflicts = conflictsFor(e);
  if (conflicts.length) fail(409, "El horario se empalma", { message: "El horario se empalma", conflicts });
  const entry = { id: entrySeq++, ...e };
  ENTRIES.push(entry);
  audit(u, "schedule.create", "schedule_entry", entry.id, { group: e.group });
  return serEntry(entry);
});
on("PUT", "/api/admin/schedules/:id", ({ params, body }) => {
  const u = requireModule("schedules");
  const entry = ENTRIES.find((x) => x.id === Number(params.id)) || fail(404, "Clase no encontrada");
  const e = entryFromBody(body);
  const conflicts = conflictsFor(e, entry.id);
  if (conflicts.length) fail(409, "El horario se empalma", { message: "El horario se empalma", conflicts });
  Object.assign(entry, e);
  audit(u, "schedule.update", "schedule_entry", entry.id);
  return serEntry(entry);
});
on("DELETE", "/api/admin/schedules/:id", ({ params }) => {
  const u = requireModule("schedules");
  const entry = ENTRIES.find((x) => x.id === Number(params.id)) || fail(404, "Clase no encontrada");
  ENTRIES = ENTRIES.filter((x) => x !== entry);
  audit(u, "schedule.delete", "schedule_entry", entry.id, { group: entry.group });
  return null;
});
on("POST", "/api/admin/schedules/import", async ({ body, query }) => {
  const u = requireModule("schedules");
  const file = body.get("file");
  if (!file) fail(422, "Selecciona un archivo CSV");
  const { valid, errors } = validateCsv(await file.text());
  const dryRun = query.dry_run !== "false";
  const result = { valid_rows: valid.length, errors, preview: valid.slice(0, 200).map((r) => ({ ...r, start_time: r.start_time, end_time: r.end_time })), created: 0, deleted: 0, dry_run: dryRun };
  if (dryRun || errors.length) return result;
  const missing = valid.find((r) => !PERIODS.some((p) => p.code === r.period));
  if (missing) fail(422, `El periodo ${missing.period} no existe. Créalo primero.`);
  const snapshot = ENTRIES.slice();
  let deleted = 0;
  if (query.mode === "replace") {
    const ids = new Set(valid.map((r) => PERIODS.find((p) => p.code === r.period).id));
    deleted = ENTRIES.filter((e) => ids.has(e.period_id)).length;
    ENTRIES = ENTRIES.filter((e) => !ids.has(e.period_id));
  }
  const conflicts = [];
  valid.forEach((r) => {
    const e = { period_id: PERIODS.find((p) => p.code === r.period).id, group: r.group, subject: r.subject, teacher: r.teacher || null, classroom: r.classroom, day: r.day, start_time: r.start_time, end_time: r.end_time };
    classroomFor(r.classroom, r.building);
    const c = conflictsFor(e);
    if (c.length) c.forEach((message) => conflicts.push({ line: r.line, field: "horario", message }));
    else ENTRIES.push({ id: entrySeq++, ...e });
  });
  if (conflicts.length) {
    ENTRIES = snapshot;
    return { ...result, errors: conflicts };
  }
  audit(u, "schedule.import", "schedule_entry", null, { created: valid.length, deleted, mode: query.mode || "append" });
  return { ...result, created: valid.length, deleted };
});

// Reportes
on("GET", "/api/admin/reports", ({ query }) => {
  const u = requireModule("reports");
  const scoped = REPORTS.filter((r) => can(u, "reports", reportDept(r)));
  const q = norm(query.q || "");
  const list = scoped.filter(
    (r) =>
      (!query.status || r.status === query.status) &&
      (!query.category_id || r.category_id === Number(query.category_id)) &&
      (!q || norm(`${r.tracking_code} ${r.location_text} ${r.description}`).includes(q)),
  );
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, scoped.filter((r) => r.status === s).length]));
  return { reports: list.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(serReportAdmin), counts, categories: CATEGORIES.filter((c) => can(u, "reports", c.department_id)).map(serCategory), status_labels: STATUS_LABELS };
});
const ownedReport = (u, id) => {
  const r = REPORTS.find((x) => x.id === Number(id));
  if (!r || !can(u, "reports", reportDept(r))) fail(404, "Reporte no encontrado");
  return r;
};
on("GET", "/api/admin/reports/:id", ({ params }) => serReportAdmin(ownedReport(requireModule("reports"), params.id)));
on("PATCH", "/api/admin/reports/:id/status", ({ params, body }) => {
  const u = requireModule("reports");
  const r = ownedReport(u, params.id);
  if (!STATUS_LABELS[body.status]) fail(422, "Estado inválido");
  if (body.status !== r.status && !TRANSITIONS[r.status].includes(body.status)) fail(409, `No se puede pasar de «${STATUS_LABELS[r.status]}» a «${STATUS_LABELS[body.status]}»`);
  if (body.status === r.status && !body.internal_note && !body.public_note && !body.priority) fail(422, "No hay cambios que guardar");
  const prev = r.status;
  r.status = body.status;
  if (body.priority) r.priority = body.priority;
  r.updated_at = now();
  r.resolved_at = body.status === "resuelto" ? now() : null;
  r.history.push({ from_status: prev, to_status: body.status, internal_note: body.internal_note || "", public_note: body.public_note || "", changed_by: u.full_name, created_at: now() });
  audit(u, "report.status", "maintenance_report", r.id, { from_status: prev, to_status: body.status });
  return serReportAdmin(r);
});

// Ubicaciones
on("GET", "/api/admin/locations", () => {
  const u = requireModule("locations");
  return { locations: LOCATIONS.slice().sort((a, b) => a.name.localeCompare(b.name)).map((l) => ({ ...serLocation(l), editable: l.department_id == null || can(u, "locations", l.department_id) })) };
});
function locFromBody(body, u) {
  const lat = Number(body.latitude);
  const lng = Number(body.longitude);
  if ((body.name || "").trim().length < 2) fail(422, "name: Escribe un nombre");
  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) fail(422, "Coordenadas fuera de rango");
  const allowed = deptIds(u, "locations");
  return { name: body.name.trim(), kind: body.kind, description: body.description || "", latitude: lat, longitude: lng, is_active: body.is_active !== false, department_id: body.department_id || (allowed.length === 1 ? allowed[0] : null) };
}
on("POST", "/api/admin/locations", ({ body }) => {
  const u = requireModule("locations");
  const loc = { id: seq.loc++, ...locFromBody(body, u) };
  LOCATIONS.push(loc);
  audit(u, "location.create", "campus_location", loc.id, { name: loc.name });
  return serLocation(loc);
});
on("PUT", "/api/admin/locations/:id", ({ params, body }) => {
  const u = requireModule("locations");
  const loc = LOCATIONS.find((l) => l.id === Number(params.id)) || fail(404, "Ubicación no encontrada");
  if (loc.department_id && !can(u, "locations", loc.department_id)) fail(403, "Esta ubicación pertenece a otro departamento");
  Object.assign(loc, locFromBody(body, u));
  audit(u, "location.update", "campus_location", loc.id, { name: loc.name });
  return serLocation(loc);
});
on("DELETE", "/api/admin/locations/:id", ({ params }) => {
  const u = requireModule("locations");
  const loc = LOCATIONS.find((l) => l.id === Number(params.id)) || fail(404, "Ubicación no encontrada");
  if (loc.department_id && !can(u, "locations", loc.department_id)) fail(403, "Esta ubicación pertenece a otro departamento");
  LOCATIONS.splice(LOCATIONS.indexOf(loc), 1);
  audit(u, "location.delete", "campus_location", loc.id, { name: loc.name });
  return null;
});

// Superadministración
on("GET", "/api/superadmin/metrics", () => {
  requireSuper();
  const since = Date.now() - 7 * 864e5;
  const byStatus = {};
  REPORTS.forEach((r) => (byStatus[r.status] = (byStatus[r.status] || 0) + 1));
  const byRoute = {};
  CHAT_LOG.forEach((c) => (byRoute[c.route] = (byRoute[c.route] || 0) + 1));
  const daily = {};
  CHAT_LOG.filter((c) => Date.parse(c.created_at) >= since).forEach((c) => {
    const d = c.created_at.slice(0, 10);
    daily[d] = (daily[d] || 0) + 1;
  });
  const byDept = {};
  REPORTS.forEach((r) => {
    const n = depRef(reportDept(r)).name;
    byDept[n] = (byDept[n] || 0) + 1;
  });
  const answered = CHAT_LOG.filter((c) => c.answered).length;
  return {
    users: { total: USERS.length, active: USERS.filter((u) => u.is_active).length },
    departments: DEPARTMENTS.length,
    documents: { total: DOCUMENTS.length, indexed: DOCUMENTS.filter((d) => d.status === "indexed").length, processing: DOCUMENTS.filter((d) => d.status === "processing").length, failed: DOCUMENTS.filter((d) => d.status === "failed").length, chunks: DOCUMENTS.reduce((s, d) => s + d.chunk_count, 0) },
    schedules: { entries: ENTRIES.length, groups: new Set(ENTRIES.map((e) => e.group)).size, classrooms: Object.keys(CLASSROOMS).length },
    reports: { total: REPORTS.length, by_status: byStatus, by_department: Object.entries(byDept).map(([department, count]) => ({ department, count })), last_7_days: REPORTS.filter((r) => Date.parse(r.created_at) >= since).length },
    chat: { total: CHAT_LOG.length, last_7_days: CHAT_LOG.filter((c) => Date.parse(c.created_at) >= since).length, by_route: byRoute, answered_rate: CHAT_LOG.length ? Math.round((answered / CHAT_LOG.length) * 1000) / 1000 : null, avg_latency_ms: Math.round(CHAT_LOG.reduce((s, c) => s + c.latency_ms, 0) / Math.max(1, CHAT_LOG.length)), daily: Object.entries(daily).sort().map(([day, count]) => ({ day, count })) },
    llm_online: false,
  };
});
on("GET", "/api/superadmin/users", () => {
  requireSuper();
  return { users: USERS.slice().sort((a, b) => a.full_name.localeCompare(b.full_name)).map(serUser) };
});
on("POST", "/api/superadmin/users", ({ body }) => {
  const admin = requireSuper();
  const email = (body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) fail(422, "email: Correo electrónico inválido");
  if (USERS.some((u) => u.email === email)) fail(409, "Ya existe un usuario con ese correo");
  if ((body.password || "").length < 10 || !/\d/.test(body.password) || !/[a-z]/i.test(body.password)) fail(422, "Debe tener al menos 10 caracteres. Debe combinar letras y números");
  if (!body.is_superadmin && !(body.department_ids || []).length) fail(422, "Asigna al menos un departamento o el rol de superadministrador");
  const u = { id: seq.user++, email, full_name: body.full_name, superadmin: Boolean(body.is_superadmin), departments: body.department_ids || [], is_active: true, locked: false, password: body.password, created_at: now(), last_login_at: null };
  USERS.push(u);
  audit(admin, "user.create", "user", u.id, { email, departments: u.departments });
  return serUser(u);
});
on("PATCH", "/api/superadmin/users/:id", ({ params, body }) => {
  const admin = requireSuper();
  const u = USERS.find((x) => x.id === Number(params.id)) || fail(404, "Usuario no encontrado");
  if (u.id === admin.id && (body.is_active === false || body.is_superadmin === false)) fail(422, "No puedes desactivarte ni quitarte el rol de superadministrador");
  if (body.full_name !== undefined) u.full_name = body.full_name;
  if (body.is_active !== undefined) u.is_active = body.is_active;
  if (body.unlock) u.locked = false;
  if (body.is_superadmin !== undefined) u.superadmin = body.is_superadmin;
  if (body.department_ids !== undefined) u.departments = body.department_ids;
  if (!u.superadmin && !u.departments.length) fail(422, "Asigna al menos un departamento o el rol de superadministrador");
  audit(admin, "user.update", "user", u.id, body);
  return serUser(u);
});
on("POST", "/api/superadmin/users/:id/reset-password", ({ params, body }) => {
  const admin = requireSuper();
  const u = USERS.find((x) => x.id === Number(params.id)) || fail(404, "Usuario no encontrado");
  if ((body.new_password || "").length < 10 || !/\d/.test(body.new_password)) fail(422, "Debe tener al menos 10 caracteres y combinar letras y números");
  u.password = body.new_password;
  u.locked = false;
  audit(admin, "user.reset_password", "user", u.id);
  return { ok: true };
});
const serDept = (d) => ({ id: d.id, code: d.code, name: d.name, description: d.description, is_active: d.is_active, modules: [...d.modules].sort(), user_count: USERS.filter((u) => u.departments.includes(d.id)).length });
on("GET", "/api/superadmin/departments", () => {
  requireSuper();
  return { departments: DEPARTMENTS.slice().sort((a, b) => a.name.localeCompare(b.name)).map(serDept) };
});
on("POST", "/api/superadmin/departments", ({ body }) => {
  const admin = requireSuper();
  if (!/^[A-Z0-9_]{3,40}$/.test(body.code || "")) fail(422, "code: Usa MAYÚSCULAS, números y guion bajo");
  if (DEPARTMENTS.some((d) => d.code === body.code || d.name === body.name)) fail(409, "Ya existe un departamento con ese código o nombre");
  const d = { id: seq.dep++, code: body.code, name: body.name, description: body.description || "", is_active: true, modules: body.modules || [] };
  DEPARTMENTS.push(d);
  audit(admin, "department.create", "department", d.id, { code: d.code, modules: d.modules });
  return serDept(d);
});
on("PATCH", "/api/superadmin/departments/:id", ({ params, body }) => {
  const admin = requireSuper();
  const d = DEPARTMENTS.find((x) => x.id === Number(params.id)) || fail(404, "Departamento no encontrado");
  ["name", "description", "is_active", "modules"].forEach((k) => body[k] !== undefined && (d[k] = body[k]));
  audit(admin, "department.update", "department", d.id, body);
  return serDept(d);
});
on("GET", "/api/superadmin/audit", ({ query }) => {
  requireSuper();
  return { logs: AUDIT.slice(Number(query.offset || 0), Number(query.offset || 0) + Number(query.limit || 100)) };
});

// ---------------------------------------------------------------- despachador
export async function mockRequest(method, fullPath, body) {
  if (method !== "GET" || fullPath.startsWith("/api/admin")) await wait(90);
  const [path, qs] = fullPath.split("?");
  const query = Object.fromEntries(new URLSearchParams(qs || ""));
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    try {
      return clone(await r.handler({ params: m.groups || {}, query, body }));
    } catch (err) {
      if (err instanceof ApiError) throw err;
      console.error(err);
      throw new ApiError(500, "Error interno del servidor (demo)");
    }
  }
  throw new ApiError(404, "Ruta no encontrada");
}
