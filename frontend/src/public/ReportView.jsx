import { useState } from "react";
import { LuCircleCheck, LuCopy, LuSearch, LuWrench } from "react-icons/lu";
import { get, getMode, post } from "../api/client";
import { Alert, Badge, Button, Card, Field, Input, SectionTitle, Select, Spinner, Textarea, useLoad } from "../components/ui";
import { fmtDateTime, STATUS_TONE } from "../lib/format";

const EMPTY = { category_id: "", location_id: "", location_text: "", description: "", contact_email: "", website: "" };

export function StatusTimeline({ history }) {
  return (
    <ol className="relative flex flex-col gap-4 border-l-2 border-line pl-5">
      {history.map((h, i) => (
        <li key={`${h.created_at}-${i}`} className="relative">
          <span
            className={`absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-surface ${i === history.length - 1 ? "bg-signal" : "bg-pine"}`}
            aria-hidden
          />
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[h.status || h.to_status]}>{h.status_label}</Badge>
            <span className="font-mono text-[11.5px] text-muted">{fmtDateTime(h.created_at)}</span>
            {h.changed_by && <span className="text-[12px] text-muted">· {h.changed_by}</span>}
          </div>
          {h.public_note && <p className="mt-1 text-[13.5px]">{h.public_note}</p>}
          {h.internal_note && <p className="mt-1 rounded-md bg-sunken px-2 py-1 text-[12.5px] text-muted">Nota interna: {h.internal_note}</p>}
        </li>
      ))}
    </ol>
  );
}

function Ticket({ result, onTrack }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.tracking_code);
      setCopied(true);
    } catch {
      setCopied(false);
      const el = document.getElementById("ticket-code");
      const range = document.createRange();
      range.selectNodeContents(el);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-ok">
        <LuCircleCheck className="text-xl" aria-hidden />
        <p className="font-semibold">Reporte recibido. {result.department} lo atenderá.</p>
      </div>
      <div className="relative overflow-hidden rounded-xl bg-signal px-5 py-5 text-on-signal">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] opacity-80">Folio de seguimiento</p>
        <p id="ticket-code" className="mt-1 select-all font-mono text-[28px] font-bold tracking-wider sm:text-[34px]">
          {result.tracking_code}
        </p>
        <p className="mt-1 text-[13px] opacity-85">Guárdalo: es la única forma de consultar el avance sin iniciar sesión.</p>
        <span className="absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-surface" aria-hidden />
        <span className="absolute -left-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-surface" aria-hidden />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={LuCopy} onClick={copy}>
          {copied ? "Copiado" : "Copiar folio"}
        </Button>
        <Button variant="ghost" icon={LuSearch} onClick={onTrack}>
          Ver estado
        </Button>
      </div>
    </div>
  );
}

export default function ReportView() {
  const meta = useLoad(async () => {
    const [cats, locs] = await Promise.all([get("/api/public/report-categories"), get("/api/public/locations")]);
    return { categories: cats.categories, locations: locs.locations };
  }, []);
  const [form, setForm] = useState(EMPTY);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);
  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState({ loading: false, data: null, error: null });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const category = meta.data?.categories.find((c) => String(c.id) === form.category_id);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      const payload = {
        category_id: Number(form.category_id),
        location_id: form.location_id ? Number(form.location_id) : null,
        location_text: form.location_text,
        description: form.description,
        contact_email: form.contact_email || null,
        website: form.website || null,
      };
      setCreated(await post("/api/public/reports", payload));
      setForm(EMPTY);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function track(value = code) {
    if (!value.trim()) return;
    setLookup({ loading: true, data: null, error: null });
    try {
      setLookup({ loading: false, data: await get(`/api/public/reports/${encodeURIComponent(value.trim())}`), error: null });
    } catch (err) {
      setLookup({ loading: false, data: null, error: err.message });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle eyebrow="Mantenimiento y servicios" title="Reporta un problema en el campus">
        Luminarias, fugas, mobiliario, limpieza o seguridad. Recibes un folio y el área responsable actualiza el estado.
      </SectionTitle>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card className="p-5">
          {meta.loading ? (
            <Spinner />
          ) : meta.error ? (
            <Alert>{meta.error.message}</Alert>
          ) : created ? (
            <div className="flex flex-col gap-5">
              <Ticket
                result={created}
                onTrack={() => {
                  setCode(created.tracking_code);
                  track(created.tracking_code);
                }}
              />
              <Button variant="secondary" onClick={() => setCreated(null)} className="self-start">
                Enviar otro reporte
              </Button>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <LuWrench className="text-pine" aria-hidden /> Nuevo reporte
              </h2>
              <Field label="Tipo de problema" hint={category ? `Lo atiende: ${category.department}` : "Elige la opción más cercana"}>
                {(id) => (
                  <Select id={id} required value={form.category_id} onChange={set("category_id")}>
                    <option value="">Selecciona…</option>
                    {meta.data.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Lugar (opcional)">
                  {(id) => (
                    <Select id={id} value={form.location_id} onChange={set("location_id")}>
                      <option value="">Otro / no está en la lista</option>
                      {meta.data.locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="¿Dónde exactamente?">
                  {(id) => <Input id={id} required minLength={3} maxLength={255} value={form.location_text} onChange={set("location_text")} placeholder="Ej. pasillo de planta alta" />}
                </Field>
              </div>
              <Field label="Descripción" hint={`${form.description.length}/2000 · mínimo 10 caracteres`}>
                {(id) => (
                  <Textarea id={id} required rows={4} minLength={10} maxLength={2000} value={form.description} onChange={set("description")} placeholder="¿Qué pasa y desde cuándo?" />
                )}
              </Field>
              <Field label="Correo para avisos (opcional)" hint="Solo lo ve el área que atiende el reporte; nunca aparece en la consulta pública.">
                {(id) => <Input id={id} type="email" maxLength={254} value={form.contact_email} onChange={set("contact_email")} placeholder="tu@correo.mx" />}
              </Field>
              <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
                <label htmlFor="report-website">No llenar</label>
                <input id="report-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
              </div>
              <Alert>{error}</Alert>
              <Button type="submit" loading={sending} disabled={!form.category_id || form.description.trim().length < 10 || form.location_text.trim().length < 3} className="self-start">
                Enviar reporte
              </Button>
            </form>
          )}
        </Card>
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <LuSearch className="text-pine" aria-hidden /> Consultar folio
          </h2>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              track();
            }}
          >
            <label htmlFor="track-code" className="sr-only">
              Folio
            </label>
            <Input id="track-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="UNI-7KQ4-XZ9P" className="font-mono uppercase" />
            <Button type="submit" variant="secondary" loading={lookup.loading}>
              Consultar
            </Button>
          </form>
          {getMode() === "demo" && (
            <p className="text-[12.5px] text-muted">
              Folio de ejemplo:{" "}
              <button
                type="button"
                className="font-mono font-semibold text-pine underline"
                onClick={() => {
                  setCode("UNI-7KQ4-XZ9P");
                  track("UNI-7KQ4-XZ9P");
                }}
              >
                UNI-7KQ4-XZ9P
              </button>
            </p>
          )}
          <Alert>{lookup.error}</Alert>
          {lookup.data && (
            <div className="flex flex-col gap-4 rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-[13px] font-bold">{lookup.data.tracking_code}</p>
                  <p className="text-[14px] font-semibold">{lookup.data.category}</p>
                  <p className="text-[13px] text-muted">{lookup.data.location}</p>
                </div>
                <Badge tone={STATUS_TONE[lookup.data.status]}>{lookup.data.status_label}</Badge>
              </div>
              <StatusTimeline history={lookup.data.history} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
