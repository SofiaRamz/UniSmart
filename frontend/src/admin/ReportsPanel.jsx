import { useEffect, useState } from "react";
import { LuMapPin, LuSearch, LuWrench } from "react-icons/lu";
import { get, patch } from "../api/client";
import { Alert, Badge, Button, Card, Drawer, Empty, Field, Input, SectionTitle, Select, Spinner, Textarea, useToast } from "../components/ui";
import { StatusTimeline } from "../public/ReportView";
import { cx, fmtDateTime, STATUS_LABELS, STATUS_TONE } from "../lib/format";

const PRIORITY_TONE = { alta: "danger", media: "warn", baja: "neutral" };

function ReportDetail({ report, onSaved }) {
  const toast = useToast();
  const [status, setStatus] = useState(report.allowed_transitions[0] || report.status);
  const [priority, setPriority] = useState(report.priority);
  const [internal, setInternal] = useState("");
  const [publicNote, setPublicNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await patch(`/api/admin/reports/${report.id}/status`, {
        status,
        internal_note: internal,
        public_note: publicNote,
        priority: priority !== report.priority ? priority : null,
      });
      toast(`${updated.tracking_code}: ${updated.status_label}`);
      setInternal("");
      setPublicNote("");
      onSaved(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[report.status]}>{report.status_label}</Badge>
        <Badge tone={PRIORITY_TONE[report.priority]}>Prioridad {report.priority}</Badge>
        <Badge>{report.category.name}</Badge>
      </div>
      <div className="flex flex-col gap-2 rounded-xl border border-line p-4">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
          <LuMapPin aria-hidden /> {report.location_name ? `${report.location_name} · ` : ""}
          {report.location_text}
        </p>
        <p className="text-[14.5px] leading-relaxed">{report.description}</p>
        <p className="text-[12.5px] text-muted">
          Contacto (privado): {report.contact_email || "no proporcionado"} · Recibido {fmtDateTime(report.created_at)}
        </p>
      </div>
      <form onSubmit={save} className="flex flex-col gap-3 rounded-xl bg-sunken p-4">
        <p className="eyebrow">Actualizar estado</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nuevo estado">
            {(id) => (
              <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value={report.status}>Mantener «{report.status_label}»</option>
                {report.allowed_transitions.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Prioridad">
            {(id) => (
              <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="baja">Baja</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Nota para el estudiante (visible con el folio)">
          {(id) => <Input id={id} maxLength={500} value={publicNote} onChange={(e) => setPublicNote(e.target.value)} placeholder="Ej. El técnico acudirá el jueves" />}
        </Field>
        <Field label="Nota interna">
          {(id) => <Textarea id={id} rows={2} maxLength={2000} value={internal} onChange={(e) => setInternal(e.target.value)} placeholder="Solo la ve tu departamento" />}
        </Field>
        <Alert>{error}</Alert>
        <Button type="submit" loading={busy} className="self-start">
          Guardar cambio
        </Button>
      </form>
      <div>
        <p className="eyebrow mb-3">Historial</p>
        <StatusTimeline history={report.history.map((h) => ({ ...h, status: h.to_status }))} />
      </div>
    </div>
  );
}

export default function ReportsPanel() {
  const [filters, setFilters] = useState({ status: "", category_id: "", q: "" });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = () => {
    const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    get(`/api/admin/reports?${q}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError(err.message));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [filters.status, filters.category_id]);

  const open = data ? Object.entries(data.counts).filter(([s]) => !["resuelto", "descartado"].includes(s)).reduce((n, [, c]) => n + c, 0) : 0;

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle eyebrow={data ? `${open} reportes abiertos` : "Reportes"} title="Reportes de mantenimiento">
        Solo ves los reportes de las categorías que atiende tu departamento. Cada cambio queda en el historial y en la auditoría.
      </SectionTitle>
      {error && <Alert>{error}</Alert>}
      {!data ? (
        <Spinner />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setFilters((f) => ({ ...f, status: "" }))}
              className={cx("rounded-lg border px-3 py-2 text-left", !filters.status ? "border-pine bg-pine-soft" : "border-line bg-surface")}
            >
              <span className="block font-mono text-[18px] font-bold tabular">{Object.values(data.counts).reduce((a, b) => a + b, 0)}</span>
              <span className="text-[12px] text-muted">Todos</span>
            </button>
            {Object.entries(data.counts).map(([s, n]) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilters((f) => ({ ...f, status: f.status === s ? "" : s }))}
                className={cx("rounded-lg border px-3 py-2 text-left", filters.status === s ? "border-pine bg-pine-soft" : "border-line bg-surface")}
              >
                <span className="block font-mono text-[18px] font-bold tabular">{n}</span>
                <span className="text-[12px] text-muted">{STATUS_LABELS[s]}</span>
              </button>
            ))}
          </div>
          <Card className="overflow-hidden">
            <form
              className="flex flex-wrap items-end gap-3 border-b border-line p-4"
              onSubmit={(e) => {
                e.preventDefault();
                load();
              }}
            >
              <Field label="Buscar" className="min-w-[200px] flex-1">
                {(id) => (
                  <div className="relative">
                    <LuSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
                    <Input id={id} value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} placeholder="Folio, lugar o descripción" className="pl-9" />
                  </div>
                )}
              </Field>
              <Field label="Categoría">
                {(id) => (
                  <Select id={id} value={filters.category_id} onChange={(e) => setFilters((f) => ({ ...f, category_id: e.target.value }))} className="w-60">
                    <option value="">Todas</option>
                    {data.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button type="submit" variant="secondary">
                Buscar
              </Button>
            </form>
            {data.reports.length === 0 ? (
              <div className="p-4">
                <Empty icon={LuWrench} title="Sin reportes">
                  No hay reportes con estos filtros.
                </Empty>
              </div>
            ) : (
              <ul>
                {data.reports.map((r) => (
                  <li key={r.id} className="border-t border-line first:border-t-0">
                    <button type="button" onClick={() => setSelected(r)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 text-left hover:bg-sunken">
                      <span className="w-[130px] shrink-0 font-mono text-[13px] font-bold">{r.tracking_code}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold">{r.description}</span>
                        <span className="block truncate text-[12.5px] text-muted">
                          {r.category.name} · {r.location_name || r.location_text}
                        </span>
                      </span>
                      <Badge tone={PRIORITY_TONE[r.priority]}>{r.priority}</Badge>
                      <Badge tone={STATUS_TONE[r.status]}>{r.status_label}</Badge>
                      <span className="w-[110px] text-right font-mono text-[11.5px] text-muted">{fmtDateTime(r.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected ? `Reporte ${selected.tracking_code}` : ""}>
        {selected && (
          <ReportDetail
            key={`${selected.id}-${selected.status}-${selected.history.length}`}
            report={selected}
            onSaved={(updated) => {
              setSelected(updated);
              load();
            }}
          />
        )}
      </Drawer>
    </div>
  );
}
