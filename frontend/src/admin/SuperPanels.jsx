import { useMemo, useState } from "react";
import { LuBuilding2, LuCpu, LuKeyRound, LuPlus, LuUserPlus } from "react-icons/lu";
import { get, patch, post } from "../api/client";
import { Alert, Badge, Button, Card, Drawer, Field, Input, SectionTitle, Spinner, useLoad, useToast } from "../components/ui";
import { cx, fmtDate, fmtDateTime, MODULE_LABELS, ROUTE_LABELS, STATUS_LABELS } from "../lib/format";

// ---------------------------------------------------------------- Métricas
function Stat({ label, value, note }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="eyebrow">{label}</p>
      <p className="font-display text-[30px] font-bold leading-none tabular">{value}</p>
      {note && <p className="text-[12.5px] text-muted">{note}</p>}
    </Card>
  );
}

/** Barras verticales de una sola serie (magnitud por día) con tooltip al pasar el cursor. */
function DailyBars({ data }) {
  const [hover, setHover] = useState(null);
  const W = 560;
  const H = 180;
  const pad = { l: 34, r: 8, t: 12, b: 26 };
  const max = Math.max(4, ...data.map((d) => d.count));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const bw = (W - pad.l - pad.r) / Math.max(1, data.length);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
  const label = (iso) => new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric" }).format(new Date(`${iso}T12:00:00`));
  return (
    <div className="relative overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[420px]" role="img" aria-label="Consultas al chat por día">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(step * i)} y2={y(step * i)} stroke="var(--line)" strokeWidth="1" />
            <text x={pad.l - 6} y={y(step * i) + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)" fontFamily="var(--font-mono)">
              {step * i}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * bw + 1;
          const h = y(0) - y(d.count);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              <path
                d={`M${x},${y(0)} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${bw - 10} q4,0 4,4 v${Math.max(0, h - 4)} z`}
                fill="var(--pine)"
                opacity={hover === null || hover === i ? 1 : 0.55}
              />
              <text x={pad.l + i * bw + bw / 2} y={H - 8} textAnchor="middle" fontSize="10.5" fill="var(--muted)">
                {label(d.day)}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] shadow-md"
          style={{ left: `${((pad.l + hover * bw + bw / 2) / W) * 100}%`, top: 0, transform: "translateX(-50%)" }}
        >
          <strong className="tabular">{data[hover].count}</strong> consultas · {label(data[hover].day)}
        </div>
      )}
    </div>
  );
}

/** Barras horizontales con etiqueta directa del valor (una sola serie). */
function HBars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[130px_minmax(0,1fr)_44px] items-center gap-3 text-[13px]" title={`${r.label}: ${r.value}`}>
          <span className="truncate text-muted">{r.label}</span>
          <span className="h-3 rounded-r-[4px] bg-pine" style={{ width: r.value ? `${Math.max(2, (r.value / max) * 100)}%` : 0 }} />
          <span className="text-right font-mono font-semibold tabular">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function MetricsPanel() {
  const { data, loading, error } = useLoad(() => get("/api/superadmin/metrics"), []);
  if (loading) return <Spinner />;
  if (error) return <Alert>{error.message}</Alert>;
  const open = Object.entries(data.reports.by_status)
    .filter(([s]) => !["resuelto", "descartado"].includes(s))
    .reduce((n, [, c]) => n + c, 0);
  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        eyebrow="Superadministración"
        title="Métricas del sistema"
        action={
          <Badge tone={data.llm_online ? "ok" : "warn"}>
            <LuCpu aria-hidden /> LM Studio {data.llm_online ? "en línea" : "sin conexión"}
          </Badge>
        }
      >
        Uso del asistente, estado del índice documental y carga de reportes. El chat no guarda el texto de las preguntas.
      </SectionTitle>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Consultas · 7 días" value={data.chat.last_7_days} note={`${data.chat.total} en total`} />
        <Stat
          label="Respondidas con evidencia"
          value={data.chat.answered_rate == null ? "—" : `${Math.round(data.chat.answered_rate * 100)}%`}
          note={`Latencia media ${(data.chat.avg_latency_ms / 1000).toFixed(1)} s`}
        />
        <Stat label="Reportes abiertos" value={open} note={`${data.reports.last_7_days} nuevos esta semana`} />
        <Stat label="Documentos indexados" value={data.documents.indexed} note={`${data.documents.chunks} fragmentos · ${data.documents.failed} con error`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="p-4">
          <p className="mb-1 font-semibold">Consultas al chat por día</p>
          <p className="mb-3 text-[12.5px] text-muted">Últimos 7 días</p>
          {data.chat.daily.length ? <DailyBars data={data.chat.daily} /> : <p className="text-muted">Sin consultas recientes.</p>}
        </Card>
        <Card className="p-4">
          <p className="mb-3 font-semibold">¿Cómo se respondió?</p>
          <HBars
            rows={Object.entries(data.chat.by_route)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => ({ label: ROUTE_LABELS[k]?.label || k, value: v }))}
          />
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <p className="mb-3 font-semibold">Reportes por estado</p>
          <HBars rows={Object.keys(STATUS_LABELS).map((s) => ({ label: STATUS_LABELS[s], value: data.reports.by_status[s] || 0 }))} />
        </Card>
        <Card className="p-4">
          <p className="mb-3 font-semibold">Datos estructurados</p>
          <dl className="grid grid-cols-3 gap-3 text-center">
            {[
              ["Clases", data.schedules.entries],
              ["Grupos", data.schedules.groups],
              ["Aulas", data.schedules.classrooms],
              ["Usuarios activos", data.users.active],
              ["Departamentos", data.departments],
              ["Reportes", data.reports.total],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-sunken px-2 py-3">
                <dd className="font-mono text-[20px] font-bold tabular">{v}</dd>
                <dt className="text-[12px] text-muted">{k}</dt>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Usuarios
function UserForm({ user, departments, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(
    user
      ? { full_name: user.full_name, is_superadmin: user.is_superadmin, department_ids: user.departments.map((d) => d.id) }
      : { email: "", full_name: "", password: "", is_superadmin: false, department_ids: [] },
  );
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const toggleDep = (id) =>
    setForm((f) => ({ ...f, department_ids: f.department_ids.includes(id) ? f.department_ids.filter((x) => x !== id) : [...f.department_ids, id] }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (user) await patch(`/api/superadmin/users/${user.id}`, form);
      else await post("/api/superadmin/users", form);
      toast(user ? "Usuario actualizado" : "Usuario creado");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    setError(null);
    try {
      await post(`/api/superadmin/users/${user.id}/reset-password`, { new_password: newPassword });
      toast("Contraseña restablecida; se cerraron sus sesiones");
      setNewPassword("");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={save} className="flex flex-col gap-3">
        {!user && (
          <Field label="Correo">{(id) => <Input id={id} type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />}</Field>
        )}
        <Field label="Nombre completo">{(id) => <Input id={id} required value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />}</Field>
        {!user && (
          <Field label="Contraseña inicial" hint="Mínimo 10 caracteres, letras y números. Se guarda con Argon2id.">
            {(id) => <Input id={id} type="password" autoComplete="new-password" required value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />}
          </Field>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-semibold">Departamentos</legend>
          {departments.map((d) => (
            <label key={d.id} className="flex items-center gap-2 text-[13.5px]">
              <input type="checkbox" className="h-4 w-4 accent-[var(--pine)]" checked={form.department_ids.includes(d.id)} onChange={() => toggleDep(d.id)} />
              {d.name}
              <span className="text-[11.5px] text-muted">({d.modules.map((m) => MODULE_LABELS[m]).join(", ") || "sin módulos"})</span>
            </label>
          ))}
          <label className="mt-1 flex items-center gap-2 text-[13.5px] font-semibold">
            <input type="checkbox" className="h-4 w-4 accent-[var(--pine)]" checked={form.is_superadmin} onChange={(e) => setForm((f) => ({ ...f, is_superadmin: e.target.checked }))} />
            Superadministrador (acceso global)
          </label>
        </fieldset>
        <Alert>{error}</Alert>
        <Button type="submit" loading={busy} className="self-start">
          {user ? "Guardar cambios" : "Crear usuario"}
        </Button>
      </form>
      {user && (
        <div className="flex flex-col gap-2 rounded-xl bg-sunken p-4">
          <p className="eyebrow">Restablecer contraseña</p>
          <div className="flex gap-2">
            <label htmlFor="reset-pass" className="sr-only">
              Nueva contraseña
            </label>
            <Input id="reset-pass" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nueva contraseña" />
            <Button variant="secondary" icon={LuKeyRound} disabled={newPassword.length < 10} onClick={resetPassword}>
              Aplicar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function UsersPanel({ me }) {
  const toast = useToast();
  const users = useLoad(() => get("/api/superadmin/users"), []);
  const deps = useLoad(() => get("/api/superadmin/departments"), []);
  const [editing, setEditing] = useState(null);
  if (users.loading || deps.loading) return <Spinner />;
  if (users.error) return <Alert>{users.error.message}</Alert>;

  const toggleActive = async (u) => {
    try {
      await patch(`/api/superadmin/users/${u.id}`, { is_active: !u.is_active });
      toast(u.is_active ? "Usuario desactivado; sus sesiones se cerraron" : "Usuario activado");
      users.reload();
    } catch (err) {
      toast(err.message, "danger");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        eyebrow="Superadministración"
        title="Usuarios"
        action={
          <Button icon={LuUserPlus} onClick={() => setEditing("new")}>
            Nuevo usuario
          </Button>
        }
      >
        Cada cuenta opera solo los módulos de sus departamentos. Desactivar una cuenta cierra todas sus sesiones.
      </SectionTitle>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[13.5px]">
          <thead className="bg-sunken text-left text-[12px] text-muted">
            <tr>
              {["Usuario", "Departamentos", "Último acceso", "Estado", ""].map((h) => (
                <th key={h} className="px-4 py-2.5 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.data.users.map((u) => (
              <tr key={u.id} className="border-t border-line">
                <td className="px-4 py-3">
                  <p className="font-semibold">{u.full_name}</p>
                  <p className="font-mono text-[11.5px] text-muted">{u.email}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.is_superadmin && <Badge tone="signal">Superadmin</Badge>}
                    {u.departments.map((d) => (
                      <Badge key={d.id} tone="pine">
                        {d.name}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-muted">{u.last_login_at ? fmtDateTime(u.last_login_at) : "Nunca"}</td>
                <td className="px-4 py-3">
                  <Badge tone={u.is_active ? (u.locked ? "warn" : "ok") : "neutral"}>{u.is_active ? (u.locked ? "Bloqueado" : "Activo") : "Inactivo"}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                      Editar
                    </Button>
                    {u.id !== me.id && (
                      <Button size="sm" variant="ghost" onClick={() => toggleActive(u)}>
                        {u.is_active ? "Desactivar" : "Activar"}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Nuevo usuario" : `Editar ${editing?.full_name || ""}`}>
        {editing && (
          <UserForm
            key={editing === "new" ? "new" : editing.id}
            user={editing === "new" ? null : editing}
            departments={deps.data?.departments || []}
            onSaved={() => {
              setEditing(null);
              users.reload();
            }}
          />
        )}
      </Drawer>
    </div>
  );
}

// ---------------------------------------------------------------- Departamentos
export function DepartmentsPanel() {
  const toast = useToast();
  const deps = useLoad(() => get("/api/superadmin/departments"), []);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", description: "", modules: [] });
  const [error, setError] = useState(null);

  const update = async (dep, changes) => {
    try {
      await patch(`/api/superadmin/departments/${dep.id}`, changes);
      toast(`${dep.name} actualizado`);
      deps.reload();
    } catch (err) {
      toast(err.message, "danger");
    }
  };

  if (deps.loading) return <Spinner />;
  if (deps.error) return <Alert>{deps.error.message}</Alert>;
  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        eyebrow="Superadministración"
        title="Departamentos y módulos"
        action={
          <Button icon={LuPlus} onClick={() => setCreating(true)}>
            Nuevo departamento
          </Button>
        }
      >
        Los módulos definen qué puede operar cada área. Un cambio aplica de inmediato a todas las sesiones abiertas.
      </SectionTitle>
      <div className="grid gap-4 md:grid-cols-2">
        {deps.data.departments.map((d) => (
          <Card key={d.id} className={cx("flex flex-col gap-3 p-4", !d.is_active && "opacity-70")}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-display text-[18px] font-bold">
                  <LuBuilding2 className="text-pine" aria-hidden /> {d.name}
                </p>
                <p className="font-mono text-[11px] text-muted">{d.code}</p>
              </div>
              <Badge tone="neutral">{d.user_count} usuarios</Badge>
            </div>
            <p className="text-[13px] text-muted">{d.description}</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Módulos de ${d.name}`}>
              {Object.entries(MODULE_LABELS).map(([m, label]) => {
                const on = d.modules.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={on}
                    onClick={() => update(d, { modules: on ? d.modules.filter((x) => x !== m) : [...d.modules, m] })}
                    className={cx("rounded-full border px-3 py-1 text-[12.5px] font-semibold", on ? "border-pine bg-pine text-on-pine" : "border-line text-muted hover:text-ink")}
                  >
                    {on ? "✓ " : "+ "}
                    {label}
                  </button>
                );
              })}
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" className="h-4 w-4 accent-[var(--pine)]" checked={d.is_active} onChange={(e) => update(d, { is_active: e.target.checked })} />
              Departamento activo
            </label>
          </Card>
        ))}
      </div>
      <Drawer open={creating} onClose={() => setCreating(false)} title="Nuevo departamento">
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await post("/api/superadmin/departments", form);
              toast("Departamento creado");
              setCreating(false);
              setForm({ code: "", name: "", description: "", modules: [] });
              deps.reload();
            } catch (err) {
              setError(err.message);
            }
          }}
        >
          <Field label="Código" hint="MAYÚSCULAS y guion bajo, p. ej. BIBLIOTECA">
            {(id) => <Input id={id} required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} className="font-mono" />}
          </Field>
          <Field label="Nombre">{(id) => <Input id={id} required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />}</Field>
          <Field label="Descripción">{(id) => <Input id={id} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />}</Field>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-1 text-[13px] font-semibold">Módulos</legend>
            {Object.entries(MODULE_LABELS).map(([m, label]) => (
              <label key={m} className="flex items-center gap-1.5 text-[13.5px]">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--pine)]"
                  checked={form.modules.includes(m)}
                  onChange={(e) => setForm((f) => ({ ...f, modules: e.target.checked ? [...f.modules, m] : f.modules.filter((x) => x !== m) }))}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <Alert>{error}</Alert>
          <Button type="submit" className="self-start">
            Crear departamento
          </Button>
        </form>
      </Drawer>
    </div>
  );
}

// ---------------------------------------------------------------- Auditoría
export function AuditPanel() {
  const logs = useLoad(() => get("/api/superadmin/audit?limit=200"), []);
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => (logs.data?.logs || []).filter((l) => !filter || `${l.action} ${l.user}`.toLowerCase().includes(filter.toLowerCase())), [logs.data, filter]);
  if (logs.loading) return <Spinner />;
  if (logs.error) return <Alert>{logs.error.message}</Alert>;
  return (
    <div className="flex flex-col gap-6">
      <SectionTitle eyebrow="Trazabilidad" title="Registro de auditoría">
        Quién cambió qué y cuándo: inicios de sesión, documentos, horarios, reportes, ubicaciones y permisos.
      </SectionTitle>
      <Card className="overflow-hidden">
        <div className="border-b border-line p-3">
          <label htmlFor="audit-filter" className="sr-only">
            Filtrar
          </label>
          <Input id="audit-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar por acción o usuario (p. ej. report.status)" className="max-w-[360px]" />
        </div>
        <div className="max-h-[640px] overflow-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="sticky top-0 bg-sunken text-left text-[12px] text-muted">
              <tr>
                {["Fecha", "Usuario", "Acción", "Entidad", "Detalle"].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-[11.5px] text-muted">{fmtDate(l.created_at)} {fmtDateTime(l.created_at).split(",").pop()}</td>
                  <td className="px-4 py-2">{l.user || "—"}</td>
                  <td className="px-4 py-2">
                    <Badge tone="pine">{l.action}</Badge>
                  </td>
                  <td className="px-4 py-2 font-mono text-[12px]">
                    {l.entity_type}
                    {l.entity_id ? ` #${l.entity_id}` : ""}
                  </td>
                  <td className="max-w-[320px] px-4 py-2 font-mono text-[11.5px] text-muted">
                    <span className="line-clamp-2 break-all">{Object.keys(l.details || {}).length ? JSON.stringify(l.details) : "—"}</span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted">
                    Sin registros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
