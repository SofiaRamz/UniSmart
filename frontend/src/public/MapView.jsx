import { useEffect, useMemo, useState } from "react";
import { LuMapPin, LuSearch } from "react-icons/lu";
import { get } from "../api/client";
import { Alert, Card, Input, SectionTitle, Spinner, useLoad } from "../components/ui";
import { cx, LOCATION_KINDS } from "../lib/format";
import { normalizeText } from "../lib/text";
import CampusMap from "../map/CampusMap";

export default function MapView({ focusId, live }) {
  const { data, error, loading } = useLoad(() => get("/api/public/locations"), []);
  const [kind, setKind] = useState("todos");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(focusId ?? null);

  useEffect(() => {
    if (focusId != null) setSelected(focusId);
  }, [focusId]);

  const locations = data?.locations || [];
  const kinds = useMemo(() => [...new Set(locations.map((l) => l.kind))], [locations]);
  const visible = useMemo(() => {
    const q = normalizeText(query);
    return locations.filter((l) => (kind === "todos" || l.kind === kind) && (!q || normalizeText(`${l.name} ${l.description}`).includes(q)));
  }, [locations, kind, query]);
  const current = locations.find((l) => l.id === selected);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle eyebrow="Ubicaciones verificadas" title="Mapa del campus">
        Edificios, aulas, oficinas y servicios.{" "}
        {live ? "Plano vectorial del campus sobre OpenStreetMap." : "Plano vectorial con coordenadas de prueba; con el backend local se agrega la cartografía de OpenStreetMap."}
      </SectionTitle>
      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert>{error.message}</Alert>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <CampusMap locations={visible} selectedId={selected} onSelect={setSelected} showTiles={live} className="h-[360px] sm:h-[480px] lg:h-[600px]" />
          <Card className="flex max-h-[600px] min-h-0 flex-col">
            <div className="flex flex-col gap-3 border-b border-line p-3">
              <div className="relative">
                <LuSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
                <label htmlFor="map-search" className="sr-only">
                  Buscar lugar
                </label>
                <Input id="map-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar: biblioteca, aula 16…" className="pl-9" />
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por tipo">
                {["todos", ...kinds].map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                    className={cx(
                      "rounded-full border px-2.5 py-1 text-[12px] font-semibold",
                      kind === k ? "border-pine bg-pine text-on-pine" : "border-line text-muted hover:text-ink",
                    )}
                  >
                    {k === "todos" ? "Todos" : LOCATION_KINDS[k]?.label || k}
                  </button>
                ))}
              </div>
            </div>
            {current && (
              <div className="border-b border-line bg-signal-soft/60 p-3">
                <p className="eyebrow">{LOCATION_KINDS[current.kind]?.label}</p>
                <p className="font-display text-[17px] font-bold">{current.name}</p>
                <p className="mt-1 text-[13px] text-muted">{current.description}</p>
                <p className="mt-2 font-mono text-[11px] text-muted tabular">
                  {current.latitude.toFixed(5)}, {current.longitude.toFixed(5)}
                </p>
              </div>
            )}
            <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {visible.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(l.id)}
                    className={cx(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px]",
                      selected === l.id ? "bg-pine-soft text-pine" : "hover:bg-sunken",
                    )}
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-sunken font-mono text-[11px] font-bold text-muted">
                      {LOCATION_KINDS[l.kind]?.glyph}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{l.name}</span>
                    <LuMapPin className="shrink-0 text-muted" aria-hidden />
                  </button>
                </li>
              ))}
              {visible.length === 0 && <li className="p-4 text-center text-[13px] text-muted">Ningún lugar coincide con la búsqueda.</li>}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
