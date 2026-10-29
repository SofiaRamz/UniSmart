import { useEffect, useState } from "react";
import { LuCopy, LuFileSpreadsheet, LuPencil, LuPlus, LuTrash2 } from "react-icons/lu";
import { del, get, post, put } from "../api/client";
import { Alert, Badge, Button, Card, ConfirmButton, Drawer, Field, Input, SectionTitle, Segmented, Select, Spinner, useLoad, useToast } from "../components/ui";
import { DAYS } from "../lib/format";

const TEMPLATE = `periodo,grupo,materia,docente,aula,edificio,dia,hora_inicio,hora_fin
2026-AGO-DIC,1AS,Fundamentos de Programación,Mtra. Laura Méndez Ortiz,15,Edificio A,Lunes,07:00,08:40`;

const blank = (periodId) => ({ period_id: periodId, group: "", subject: "", teacher: "", classroom: "", building: "", day: 1, start_time: "07:00", end_time: "08:40" });

function EntryForm({ initial, onSaved, onCancel }) {
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        period_id: Number(form.period_id),
        group: form.group.trim(),
        subject: form.subject.trim(),
        teacher: form.teacher?.trim() || null,
        classroom: form.classroom.trim(),
        building: form.building?.trim() || null,
        day: Number(form.day),
        start_time: form.start_time,
        end_time: form.end_time,
      };
      const saved = initial.id ? await put(`/api/admin/schedules/${initial.id}`, body) : await post("/api/admin/schedules", body);
      toast(`Clase ${initial.id ? "actualizada" : "registrada"}: ${saved.group} · ${saved.day_name} ${saved.start_time}`);
      onSaved();
    } catch (err) {
      setError(err.detail?.conflicts ? { message: err.message, list: err.detail.conflicts } : { message: err.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Grupo">{(id) => <Input id={id} required value={form.group} onChange={set("group")} placeholder="3AS" className="font-mono uppercase" />}</Field>
        <Field label="Aula">{(id) => <Input id={id} required value={form.classroom} onChange={set("classroom")} placeholder="16" className="font-mono uppercase" />}</Field>
      </div>
      <Field label="Materia">{(id) => <Input id={id} required value={form.subject} onChange={set("subject")} placeholder="Estructuras de Datos" />}</Field>
      <Field label="Docente (opcional)">{(id) => <Input id={id} value={form.teacher || ""} onChange={set("teacher")} />}</Field>
      <Field label="Edificio (opcional)">{(id) => <Input id={id} value={form.building || ""} onChange={set("building")} placeholder="Edificio A" />}</Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Día">
          {(id) => (
            <Select id={id} value={form.day} onChange={set("day")}>
              {DAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Inicio">{(id) => <Input id={id} type="time" required value={form.start_time} onChange={set("start_time")} />}</Field>
        <Field label="Fin">{(id) => <Input id={id} type="time" required value={form.end_time} onChange={set("end_time")} />}</Field>
      </div>
      {error && (
        <Alert>
          <p className="font-semibold">{error.message}</p>
          {error.list && (
            <ul className="mt-1 list-disc pl-4">
              {error.list.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          Guardar clase
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function ImportCsv({ periodCode, onImported }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [mode, setMode] = useState("replace");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const send = async (dryRun) => {
    const data = new FormData();
    data.append("file", file);
    setBusy(true);
    setError(null);
    try {
      const res = await post(`/api/admin/schedules/import?dry_run=${dryRun}&mode=${mode}`, data, { form: true });
      setResult(res);
      if (!dryRun && !res.errors.length) {
        toast(`Horario importado: ${res.created} clases`);
        onImported();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="flex flex-col gap-4">
        <ol className="flex flex-col gap-3 text-[13.5px]">
          <li>
            <strong>1. Llena la plantilla</strong> en Excel con el horario oficial y guárdala como «CSV UTF-8». Se aceptan comas o punto y coma.
          </li>
          <li>
            <strong>2. Valida</strong>: se revisan días, horas y empalmes de grupo, aula y docente sin guardar nada.
          </li>
          <li>
            <strong>3. Importa</strong>: todo o nada. Si hay un solo error no se publica el horario.
          </li>
        </ol>
        <div className="rounded-lg border border-line bg-sunken p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">Encabezado de la plantilla</p>
            <button
              type="button"
              className="flex items-center gap-1 text-[12px] font-semibold text-pine"
              onClick={() => navigator.clipboard?.writeText(TEMPLATE).then(() => toast("Plantilla copiada"), () => toast("Selecciona y copia el texto", "danger"))}
            >
              <LuCopy aria-hidden /> Copiar
            </button>
          </div>
          <pre className="select-all overflow-x-auto whitespace-pre font-mono text-[11.5px] leading-relaxed">{TEMPLATE}</pre>
        </div>
        <Field label="Archivo CSV" hint={`Periodo activo: ${periodCode || "—"}`}>
          {(id) => (
            <input
              id={id}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setResult(null);
              }}
              className="text-[13px] file:mr-3 file:rounded-lg file:border-0 file:bg-pine-soft file:px-3 file:py-2 file:font-semibold file:text-pine"
            />
          )}
        </Field>
        <Field label="Al importar">
          <Segmented
            label="Modo de importación"
            value={mode}
            onChange={setMode}
            options={[
              { value: "replace", label: "Reemplazar el periodo" },
              { value: "append", label: "Agregar clases" },
            ]}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={LuFileSpreadsheet} disabled={!file} loading={busy && !result} onClick={() => send(true)}>
            Validar archivo
          </Button>
          <Button disabled={!result || result.errors.length > 0 || !result.dry_run || result.valid_rows === 0} loading={busy && !!result} onClick={() => send(false)}>
            Importar {result?.valid_rows || ""} clases
          </Button>
        </div>
        <Alert>{error}</Alert>
      </div>
      <div className="min-w-0">
        {!result ? (
          <div className="grid h-full min-h-[200px] place-items-center rounded-xl border border-dashed border-line p-6 text-center text-[13.5px] text-muted">
            El resultado de la validación aparecerá aquí.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone="ok">{result.valid_rows} filas válidas</Badge>
              <Badge tone={result.errors.length ? "danger" : "neutral"}>{result.errors.length} errores</Badge>
              {!result.dry_run && <Badge tone="pine">{result.created} creadas · {result.deleted} reemplazadas</Badge>}
            </div>
            {result.errors.length > 0 && (
              <div className="max-h-[220px] overflow-auto rounded-lg border border-danger/30">
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {result.errors.map((e, i) => (
                      <tr key={i} className="border-b border-line last:border-0">
                        <td className="px-3 py-1.5 font-mono text-danger">L{e.line}</td>
                        <td className="px-2 py-1.5 font-mono text-muted">{e.field}</td>
                        <td className="px-2 py-1.5">{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.preview.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[520px] text-[12.5px]">
                  <thead className="bg-sunken text-left text-muted">
                    <tr>
                      {["Grupo", "Materia", "Aula", "Día", "Horario"].map((h) => (
                        <th key={h} className="px-3 py-1.5 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.preview.slice(0, 12).map((r) => (
                      <tr key={r.line} className="border-t border-line">
                        <td className="px-3 py-1.5 font-mono font-bold">{r.group}</td>
                        <td className="px-3 py-1.5">{r.subject}</td>
                        <td className="px-3 py-1.5 font-mono">{r.classroom}</td>
                        <td className="px-3 py-1.5">{DAYS.find((d) => d.value === r.day)?.short || r.day}</td>
                        <td className="px-3 py-1.5 font-mono tabular">
                          {r.start_time}–{r.end_time}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SchedulesPanel() {
  const toast = useToast();
  const periods = useLoad(() => get("/api/admin/periods"), []);
  const [periodId, setPeriodId] = useState(null);
  const [tab, setTab] = useState("clases");
  const [group, setGroup] = useState("");
  const [day, setDay] = useState("");
  const [entries, setEntries] = useState(null);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (periods.data && periodId == null) {
      const active = periods.data.periods.find((p) => p.is_active) || periods.data.periods[0];
      setPeriodId(active?.id ?? null);
    }
  }, [periods.data, periodId]);

  const load = () => {
    if (!periodId) return;
    const q = new URLSearchParams({ period_id: periodId });
    if (group) q.set("group", group);
    if (day) q.set("day", day);
    get(`/api/admin/schedules?${q}`)
      .then((d) => setEntries(d.entries))
      .catch((err) => toast(err.message, "danger"));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [periodId, group, day]);

  if (periods.loading) return <Spinner />;
  if (periods.error) return <Alert>{periods.error.message}</Alert>;
  const period = periods.data.periods.find((p) => p.id === periodId);
  const groups = [...new Set((entries || []).map((e) => e.group))];

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        eyebrow="Coordinación Académica"
        title="Horarios estructurados"
        action={
          <div className="flex items-end gap-2">
            <Field label="Periodo">
              {(id) => (
                <Select id={id} value={periodId ?? ""} onChange={(e) => setPeriodId(Number(e.target.value))} className="w-56">
                  {periods.data.periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.is_active ? " (activo)" : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        }
      >
        Fuente de verdad del chatbot para grupos, aulas y horas. Los empalmes se rechazan antes de guardar.
      </SectionTitle>
      <Segmented
        label="Sección"
        value={tab}
        onChange={setTab}
        options={[
          { value: "clases", label: "Clases registradas" },
          { value: "importar", label: "Importar CSV" },
        ]}
      />
      {tab === "importar" ? (
        <Card className="p-5">
          <ImportCsv periodCode={period?.code} onImported={load} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
            <Field label="Grupo">
              {(id) => <Input id={id} value={group} onChange={(e) => setGroup(e.target.value.toUpperCase())} placeholder="Todos" className="w-32 font-mono uppercase" list="group-list" />}
            </Field>
            <datalist id="group-list">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <Field label="Día">
              {(id) => (
                <Select id={id} value={day} onChange={(e) => setDay(e.target.value)} className="w-40">
                  <option value="">Todos</option>
                  {DAYS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button icon={LuPlus} className="ml-auto" onClick={() => setEditing(blank(periodId))}>
              Agregar clase
            </Button>
          </div>
          {entries === null ? (
            <div className="p-4">
              <Spinner />
            </div>
          ) : (
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[760px] text-[13.5px]">
                <thead className="sticky top-0 bg-sunken text-left text-[12px] text-muted">
                  <tr>
                    {["Grupo", "Día", "Horario", "Materia", "Docente", "Aula", ""].map((h) => (
                      <th key={h} className="px-3 py-2.5 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-t border-line">
                      <td className="px-3 py-2 font-mono font-bold">{e.group}</td>
                      <td className="px-3 py-2">{e.day_name}</td>
                      <td className="px-3 py-2 font-mono tabular">
                        {e.start_time}–{e.end_time}
                      </td>
                      <td className="px-3 py-2 font-semibold">{e.subject}</td>
                      <td className="px-3 py-2 text-muted">{e.teacher || "—"}</td>
                      <td className="px-3 py-2 font-mono">{e.classroom}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" icon={LuPencil} onClick={() => setEditing({ ...e, period_id: e.period.id, building: e.building })}>
                            Editar
                          </Button>
                          <ConfirmButton
                            variant="ghost"
                            icon={LuTrash2}
                            confirmLabel="Eliminar"
                            onConfirm={async () => {
                              await del(`/api/admin/schedules/${e.id}`);
                              toast("Clase eliminada");
                              load();
                            }}
                          >
                            Eliminar
                          </ConfirmButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {entries.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-muted">
                        No hay clases con estos filtros.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-line px-4 py-2 text-[12px] text-muted">{entries?.length ?? 0} clases en {period?.name}</p>
        </Card>
      )}
      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Editar clase" : "Nueva clase"}>
        {editing && (
          <EntryForm
            key={editing.id || "new"}
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        )}
      </Drawer>
    </div>
  );
}
