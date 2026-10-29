import { useEffect, useMemo, useState } from "react";
import { LuCalendarDays, LuDoorOpen, LuUsers } from "react-icons/lu";
import { get } from "../api/client";
import { Alert, Card, Empty, Field, Select, SectionTitle, Segmented, Spinner, useLoad } from "../components/ui";
import { cx, DAYS, subjectColor } from "../lib/format";

const todayNumber = () => new Date().getDay() || 7;

export function Timetable({ entries, by }) {
  const days = DAYS.filter((d) => d.value <= 5 || entries.some((e) => e.day === d.value));
  const slots = [...new Set(entries.map((e) => `${e.start_time}–${e.end_time}`))].sort();
  const today = todayNumber();
  const [mobileDay, setMobileDay] = useState(days.some((d) => d.value === today) ? today : days[0].value);
  const cell = (day, slot) => entries.filter((e) => e.day === day && `${e.start_time}–${e.end_time}` === slot);
  const block = (e) => (
    <div key={e.id} className="slot flex h-full flex-col gap-0.5 rounded-md px-2.5 py-2" style={{ "--slot": subjectColor(e.subject) }}>
      <span className="text-[13px] font-bold leading-snug text-ink">{e.subject}</span>
      <span className="font-mono text-[11px] text-muted">{by === "group" ? `${e.classroom_name}` : `Grupo ${e.group}`}</span>
      {e.teacher && <span className="truncate text-[11.5px] text-muted">{e.teacher}</span>}
    </div>
  );
  return (
    <>
      {/* Escritorio: rejilla semanal */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] border-separate border-spacing-1.5">
          <thead>
            <tr>
              <th className="w-[92px]" />
              {days.map((d) => (
                <th key={d.value} className={cx("rounded-md py-1.5 text-[12.5px] font-bold", d.value === today ? "bg-signal text-on-signal" : "text-muted")}>
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <tr key={slot}>
                <th scope="row" className="whitespace-pre-line pr-1 pt-2 text-right align-top font-mono text-[11.5px] font-semibold leading-tight text-muted tabular">
                  {slot.replace("–", "\n")}
                </th>
                {days.map((d) => {
                  const items = cell(d.value, slot);
                  return (
                    <td key={d.value} className="h-[84px] align-top">
                      {items.length ? items.map(block) : <div className="h-full rounded-md border border-dashed border-line" />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Móvil: un día a la vez */}
      <div className="flex flex-col gap-3 md:hidden">
        <Segmented label="Día" value={mobileDay} onChange={setMobileDay} options={days.map((d) => ({ value: d.value, label: d.short }))} />
        {entries.filter((e) => e.day === mobileDay).length === 0 ? (
          <p className="py-6 text-center text-muted">Sin clases registradas este día.</p>
        ) : (
          entries
            .filter((e) => e.day === mobileDay)
            .map((e) => (
              <div key={e.id} className="flex gap-3">
                <span className="w-[54px] shrink-0 pt-2 font-mono text-[12px] font-semibold text-muted tabular">
                  {e.start_time}
                  <br />
                  {e.end_time}
                </span>
                <div className="min-w-0 flex-1">{block(e)}</div>
              </div>
            ))
        )}
      </div>
    </>
  );
}

export default function ScheduleView({ focus }) {
  const options = useLoad(() => get("/api/public/schedules/options"), []);
  const [by, setBy] = useState("group");
  const [value, setValue] = useState("");
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!options.data) return;
    if (focus?.group) {
      setBy("group");
      setValue(focus.group);
    } else if (focus?.classroom) {
      setBy("classroom");
      setValue(focus.classroom);
    } else if (!value) setValue(options.data.groups[0] || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.data, focus]);

  useEffect(() => {
    if (!value) return;
    setEntries(null);
    setError(null);
    const q = by === "group" ? `group=${encodeURIComponent(value)}` : `classroom=${encodeURIComponent(value)}`;
    get(`/api/public/schedules?${q}`)
      .then((d) => setEntries(d.entries))
      .catch((e) => setError(e.message));
  }, [by, value]);

  const choices = useMemo(() => {
    if (!options.data) return [];
    return by === "group" ? options.data.groups.map((g) => ({ value: g, label: g })) : options.data.classrooms.map((c) => ({ value: c.code, label: c.name }));
  }, [options.data, by]);

  const summary = useMemo(() => {
    if (!entries?.length) return null;
    const rooms = [...new Set(entries.map((e) => e.classroom_name))];
    const groups = [...new Set(entries.map((e) => e.group))];
    return by === "group" ? `Aula${rooms.length > 1 ? "s" : ""}: ${rooms.join(", ")}` : `Grupos: ${groups.join(", ")}`;
  }, [entries, by]);

  if (options.loading) return <Spinner />;
  if (options.error) return <Alert>{options.error.message}</Alert>;
  const period = options.data.active_period;

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle eyebrow={period ? `Periodo ${period.name}` : "Sin periodo activo"} title="Horarios de clase">
        Datos estructurados que registra Coordinación Académica. No se interpreta ningún PDF: ves exactamente lo que está en la base de datos.
      </SectionTitle>
      <Card className="flex flex-wrap items-end gap-4 p-4">
        <Field label="Consultar por">
          <Segmented
            label="Consultar por"
            value={by}
            onChange={(v) => {
              setBy(v);
              setValue(v === "group" ? options.data.groups[0] || "" : options.data.classrooms[0]?.code || "");
            }}
            options={[
              { value: "group", label: "Grupo" },
              { value: "classroom", label: "Aula" },
            ]}
          />
        </Field>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={by === "group" ? "Grupos" : "Aulas"}>
          {choices.length > 8 ? (
            <Field label={by === "group" ? "Grupo" : "Aula"}>
              {(id) => (
                <Select id={id} value={value} onChange={(e) => setValue(e.target.value)} className="w-48">
                  {choices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            choices.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setValue(c.value)}
                aria-pressed={value === c.value}
                className={cx(
                  "h-10 rounded-lg border px-4 font-mono text-[14px] font-bold transition-colors",
                  value === c.value ? "border-pine bg-pine text-on-pine" : "border-line bg-surface text-ink hover:border-pine",
                )}
              >
                {c.label}
              </button>
            ))
          )}
        </div>
        {summary && (
          <p className="ml-auto flex items-center gap-2 rounded-lg bg-pine-soft px-3 py-2 text-[13.5px] font-semibold text-pine">
            {by === "group" ? <LuDoorOpen aria-hidden /> : <LuUsers aria-hidden />} {summary}
          </p>
        )}
      </Card>
      <Card className="p-3 sm:p-4">
        {error ? (
          <Alert>{error}</Alert>
        ) : entries === null ? (
          <Spinner />
        ) : entries.length === 0 ? (
          <Empty icon={LuCalendarDays} title="Sin clases registradas">
            No hay horarios oficiales para esta selección en el periodo activo.
          </Empty>
        ) : (
          <Timetable entries={entries} by={by} />
        )}
      </Card>
    </div>
  );
}
