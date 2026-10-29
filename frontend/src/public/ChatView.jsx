import { Fragment, useEffect, useRef, useState } from "react";
import { LuArrowRight, LuBookOpen, LuCalendarDays, LuCornerDownLeft, LuFileText, LuMapPin, LuRefreshCw, LuSend } from "react-icons/lu";
import { get, post } from "../api/client";
import { Badge, Card } from "../components/ui";
import { cx, ROUTE_LABELS } from "../lib/format";

const SUGGESTIONS = [
  { text: "¿En qué salón toma clases el 3AS?", kind: "Horario" },
  { text: "¿Cuántas faltas puedo tener para presentar examen?", kind: "Reglamento" },
  { text: "¿Dónde está la biblioteca?", kind: "Mapa" },
  { text: "¿Qué necesito para inscribirme?", kind: "Trámite" },
  { text: "Horario del 1AS el lunes", kind: "Horario" },
  { text: "¿Cuál es el precio del estacionamiento?", kind: "Sin datos" },
];

function renderInline(text, onCite) {
  return text.split(/(\[\d{1,2}\])/g).map((part, i) => {
    const m = /^\[(\d{1,2})\]$/.exec(part);
    if (!m) return <Fragment key={i}>{part}</Fragment>;
    return (
      <button
        key={i}
        type="button"
        onClick={() => onCite(Number(m[1]))}
        className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded bg-pine-soft px-1 align-text-top font-mono text-[10.5px] font-bold text-pine hover:bg-pine hover:text-on-pine"
        aria-label={`Ver fuente ${m[1]}`}
      >
        {m[1]}
      </button>
    );
  });
}

function AnswerText({ text, onCite }) {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const blocks = [];
  let list = [];
  lines.forEach((line, i) => {
    if (line.startsWith("• ")) list.push(line.slice(2));
    else {
      if (list.length) blocks.push({ type: "list", items: list, key: `l${i}` });
      list = [];
      blocks.push({ type: "p", text: line, key: `p${i}` });
    }
  });
  if (list.length) blocks.push({ type: "list", items: list, key: "lend" });
  return (
    <div className="flex flex-col gap-2 text-[14.5px] leading-relaxed text-ink">
      {blocks.map((b) =>
        b.type === "list" ? (
          <ul key={b.key} className="flex flex-col gap-1 border-l-2 border-line pl-3 font-mono text-[12.5px] leading-snug text-ink">
            {b.items.slice(0, 8).map((it) => (
              <li key={it} className="tabular">{it}</li>
            ))}
            {b.items.length > 8 && <li className="text-muted">+ {b.items.length - 8} clases más en la tabla</li>}
          </ul>
        ) : (
          <p key={b.key} className={b.text.startsWith("Fuente:") ? "text-[12.5px] text-muted" : undefined}>
            {renderInline(b.text, onCite)}
          </p>
        ),
      )}
    </div>
  );
}

function AssistantMessage({ msg, onShowLocation, onShowSchedule, onAsk }) {
  const [openSource, setOpenSource] = useState(null);
  const route = ROUTE_LABELS[msg.route] || ROUTE_LABELS.no_info;
  const groups = msg.schedule ? [...new Set(msg.schedule.map((e) => e.group))] : [];
  return (
    <div className="flex max-w-[680px] flex-col gap-3 rounded-2xl rounded-tl-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={route.tone}>{route.label}</Badge>
        {msg.ms != null && <span className="font-mono text-[10.5px] text-muted">{(msg.ms / 1000).toFixed(1)} s</span>}
      </div>
      <AnswerText text={msg.answer} onCite={(n) => setOpenSource(n)} />
      {(msg.location || (msg.schedule && msg.schedule.length > 0)) && (
        <div className="flex flex-wrap gap-2">
          {msg.schedule?.length > 0 && (
            <button
              type="button"
              onClick={() => onShowSchedule(groups.length === 1 ? { group: groups[0] } : { classroom: msg.schedule[0].classroom })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-pine-soft px-3 py-1.5 text-[13px] font-semibold text-pine hover:bg-pine hover:text-on-pine"
            >
              <LuCalendarDays aria-hidden /> Ver horario completo
            </button>
          )}
          {msg.location && (
            <button
              type="button"
              onClick={() => onShowLocation(msg.location.id)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-info-soft px-3 py-1.5 text-[13px] font-semibold text-info hover:brightness-95"
            >
              <LuMapPin aria-hidden /> Ver «{msg.location.name}» en el mapa
            </button>
          )}
        </div>
      )}
      {msg.sources?.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          <p className="eyebrow">Fuentes oficiales</p>
          {msg.sources.map((s) => (
            <button
              key={s.n}
              type="button"
              onClick={() => setOpenSource(openSource === s.n ? null : s.n)}
              className={cx(
                "flex flex-col gap-1 rounded-lg border px-3 py-2 text-left transition-colors",
                openSource === s.n ? "border-pine bg-pine-soft/50" : "border-line hover:border-pine",
              )}
            >
              <span className="flex min-w-0 items-center gap-2 text-[13px]">
                <span className="grid h-5 min-w-5 place-items-center rounded bg-pine font-mono text-[10.5px] font-bold text-on-pine">{s.n}</span>
                <LuFileText className="shrink-0 text-muted" aria-hidden />
                <span className="truncate font-semibold">{s.title}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted">pág. {s.page}</span>
              </span>
              {openSource === s.n && <span className="text-[12.5px] leading-snug text-muted">«{s.snippet}» · {s.department}</span>}
            </button>
          ))}
        </div>
      )}
      {msg.suggestions?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {msg.suggestions.map((s) => (
            <button key={s} type="button" onClick={() => onAsk(s)} className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink hover:border-pine hover:text-pine">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChatView({ mode, onShowLocation, onShowSchedule }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState([]);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    get("/api/public/documents")
      .then((d) => setDocs(d.documents))
      .catch(() => setDocs([]));
  }, []);

  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function ask(text) {
    const question = (text ?? draft).trim();
    if (question.length < 2 || busy) return;
    setDraft("");
    setMessages((m) => [...m, { role: "user", text: question, id: Date.now() }]);
    setBusy(true);
    const started = performance.now();
    try {
      const res = await post("/api/public/chat", { message: question });
      setMessages((m) => [...m, { role: "assistant", id: Date.now() + 1, ms: performance.now() - started, ...res }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "error", id: Date.now() + 1, text: err.message }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const empty = messages.length === 0;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="flex min-h-[calc(100dvh-230px)] flex-col overflow-hidden md:min-h-[600px]">
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {empty ? (
            <div className="flex flex-col gap-6 py-4">
              <div>
                <p className="eyebrow mb-2">Asistente oficial · sin registro</p>
                <h1 className="max-w-[18ch] text-[30px] font-bold leading-[1.08] sm:text-[38px]">¿Qué necesitas saber del campus hoy?</h1>
                <p className="mt-3 max-w-[56ch] text-muted">
                  Respondo solo con documentos oficiales cargados y con los horarios registrados por Coordinación Académica. Si no hay
                  evidencia, te lo digo.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.text}
                    type="button"
                    onClick={() => ask(s.text)}
                    className="group flex items-center justify-between gap-3 rounded-xl border border-line bg-bg px-3.5 py-3 text-left hover:border-pine"
                  >
                    <span className="min-w-0">
                      <span className="eyebrow block">{s.kind}</span>
                      <span className="text-[14px] font-semibold text-ink">{s.text}</span>
                    </span>
                    <LuArrowRight className="shrink-0 text-muted group-hover:text-pine" aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4" aria-live="polite">
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="ml-auto max-w-[80%] rounded-2xl rounded-tr-md bg-pine px-4 py-2.5 text-[14.5px] text-on-pine">
                    {m.text}
                  </div>
                ) : m.role === "error" ? (
                  <div key={m.id} className="max-w-[680px] rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger">
                    {m.text}
                  </div>
                ) : (
                  <AssistantMessage key={m.id} msg={m} onShowLocation={onShowLocation} onShowSchedule={onShowSchedule} onAsk={ask} />
                ),
              )}
              {busy && (
                <div className="typing flex w-fit items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-[13px] text-muted">
                  <span /> <span /> <span />
                  <span className="sr-only">Buscando en fuentes oficiales…</span>
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>
        <form
          className="border-t border-line bg-surface p-3 sm:p-4"
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
        >
          <div className="flex items-end gap-2 rounded-xl border border-line bg-bg p-2 focus-within:border-pine">
            <label htmlFor="chat-input" className="sr-only">
              Escribe tu pregunta
            </label>
            <textarea
              id="chat-input"
              ref={inputRef}
              value={draft}
              maxLength={600}
              rows={1}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask();
                }
              }}
              placeholder="Pregunta por horarios, trámites, reglamentos o ubicaciones…"
              className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[14.5px] text-ink placeholder:text-muted/70 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || draft.trim().length < 2}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-pine text-on-pine disabled:opacity-40"
              aria-label="Enviar pregunta"
            >
              <LuSend aria-hidden />
            </button>
          </div>
          <div className="mt-1.5 flex items-center justify-between px-1 text-[11.5px] text-muted">
            <span className="hidden items-center gap-1 sm:flex">
              <LuCornerDownLeft aria-hidden /> Enter para enviar · Shift+Enter para nueva línea
            </span>
            <span className="flex items-center gap-3">
              {!empty && (
                <button type="button" onClick={() => setMessages([])} className="flex items-center gap-1 hover:text-ink">
                  <LuRefreshCw aria-hidden /> Nueva conversación
                </button>
              )}
              <span className="tabular">{draft.length}/600</span>
            </span>
          </div>
        </form>
      </Card>

      <aside className="flex flex-col gap-4">
        <Card className="p-4">
          <p className="eyebrow mb-3">Cómo respondo</p>
          <ol className="flex flex-col gap-3 text-[13.5px]">
            <li className="flex gap-2.5">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-pine-soft text-pine">
                <LuCalendarDays aria-hidden />
              </span>
              <span>
                <strong>Horarios y aulas:</strong> consulta exacta a la base de datos. El modelo nunca lee tablas.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ok-soft text-ok">
                <LuBookOpen aria-hidden />
              </span>
              <span>
                <strong>Trámites y reglamentos:</strong> fragmentos de documentos oficiales con número de página.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-info-soft text-info">
                <LuMapPin aria-hidden />
              </span>
              <span>
                <strong>Ubicaciones:</strong> puntos verificados del mapa del campus.
              </span>
            </li>
          </ol>
        </Card>
        <Card className="p-4">
          <p className="eyebrow mb-3">Documentos oficiales cargados</p>
          {docs.length === 0 ? (
            <p className="text-[13px] text-muted">Aún no hay documentos indexados.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {docs.map((d) => (
                <li key={d.id} className="flex gap-2 text-[13px]">
                  <LuFileText className="mt-0.5 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0">
                    <span className="block font-semibold leading-snug">{d.title}</span>
                    <span className="text-muted">
                      {d.department} · {d.page_count} págs.
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {mode === "live" && <p className="mt-3 text-[12px] text-muted">Modelo local: Qwen3-4B Instruct vía LM Studio.</p>}
        </Card>
      </aside>
    </div>
  );
}
