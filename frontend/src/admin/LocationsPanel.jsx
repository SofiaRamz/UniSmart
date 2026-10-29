import { useState } from "react";
import { LuCrosshair, LuPencil, LuPlus, LuTrash2 } from "react-icons/lu";
import { del, get, post, put } from "../api/client";
import { Alert, Badge, Button, Card, ConfirmButton, Field, Input, SectionTitle, Select, Spinner, Textarea, useLoad, useToast } from "../components/ui";
import { cx, LOCATION_KINDS } from "../lib/format";
import CampusMap from "../map/CampusMap";

const EMPTY = { name: "", kind: "edificio", description: "", latitude: "", longitude: "", is_active: true };

export default function LocationsPanel({ live }) {
  const toast = useToast();
  const list = useLoad(() => get("/api/admin/locations"), []);
  const [form, setForm] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: form.name,
      kind: form.kind,
      description: form.description,
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      is_active: form.is_active,
    };
    try {
      const saved = form.id ? await put(`/api/admin/locations/${form.id}`, body) : await post("/api/admin/locations", body);
      toast(`Ubicación «${saved.name}» guardada`);
      setForm(null);
      setSelected(saved.id);
      list.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (list.loading) return <Spinner />;
  if (list.error) return <Alert>{list.error.message}</Alert>;
  const locations = list.data.locations;

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        eyebrow="Servicios del Campus"
        title="Ubicaciones del mapa"
        action={
          <Button icon={LuPlus} onClick={() => setForm({ ...EMPTY })}>
            Nueva ubicación
          </Button>
        }
      >
        Los pines son datos: se guardan en PostgreSQL y la vista del mapa solo los dibuja. Haz clic en el mapa para tomar coordenadas.
      </SectionTitle>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-2">
          <CampusMap
            locations={locations.filter((l) => l.is_active)}
            selectedId={form ? null : selected}
            onSelect={setSelected}
            pickMode={!!form}
            pickedPoint={form && form.latitude !== "" ? { latitude: Number(form.latitude), longitude: Number(form.longitude) } : null}
            onPick={form ? (p) => setForm((f) => ({ ...f, ...p })) : undefined}
            showTiles={live}
            className="h-[420px] lg:h-[560px]"
          />
          {form && (
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-pine">
              <LuCrosshair aria-hidden /> Modo captura: haz clic en el mapa para colocar el punto.
            </p>
          )}
        </div>
        <Card className="flex max-h-[600px] min-h-0 flex-col">
          {form ? (
            <form onSubmit={save} className="flex flex-col gap-3 overflow-y-auto p-4">
              <h2 className="text-lg font-bold">{form.id ? "Editar ubicación" : "Nueva ubicación"}</h2>
              <Field label="Nombre">{(id) => <Input id={id} required value={form.name} onChange={set("name")} />}</Field>
              <Field label="Tipo">
                {(id) => (
                  <Select id={id} value={form.kind} onChange={set("kind")}>
                    {Object.entries(LOCATION_KINDS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Descripción">{(id) => <Textarea id={id} rows={3} value={form.description} onChange={set("description")} maxLength={1000} />}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Latitud">{(id) => <Input id={id} required inputMode="decimal" value={form.latitude} onChange={set("latitude")} className="font-mono" />}</Field>
                <Field label="Longitud">{(id) => <Input id={id} required inputMode="decimal" value={form.longitude} onChange={set("longitude")} className="font-mono" />}</Field>
              </div>
              <label className="flex items-center gap-2 text-[13.5px]">
                <input type="checkbox" checked={form.is_active} onChange={set("is_active")} className="h-4 w-4 accent-[var(--pine)]" /> Visible en el mapa público
              </label>
              <Alert>{error}</Alert>
              <div className="flex gap-2">
                <Button type="submit" loading={busy} disabled={form.latitude === "" || form.longitude === ""}>
                  Guardar
                </Button>
                <Button variant="ghost" onClick={() => setForm(null)}>
                  Cancelar
                </Button>
              </div>
            </form>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {locations.map((l) => (
                <li key={l.id} className={cx("flex items-center gap-2 rounded-lg px-2.5 py-2", selected === l.id && "bg-pine-soft")}>
                  <button type="button" onClick={() => setSelected(l.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-sunken font-mono text-[11px] font-bold text-muted">{LOCATION_KINDS[l.kind]?.glyph}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-semibold">{l.name}</span>
                      <span className="block text-[11.5px] text-muted">
                        {LOCATION_KINDS[l.kind]?.label}
                        {!l.is_active && " · oculta"}
                      </span>
                    </span>
                  </button>
                  {l.editable ? (
                    <span className="flex shrink-0 gap-0.5">
                      <button type="button" aria-label={`Editar ${l.name}`} onClick={() => setForm({ ...l, latitude: String(l.latitude), longitude: String(l.longitude) })} className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink">
                        <LuPencil />
                      </button>
                      <ConfirmButton
                        variant="ghost"
                        icon={LuTrash2}
                        confirmLabel="Borrar"
                        onConfirm={async () => {
                          await del(`/api/admin/locations/${l.id}`);
                          toast("Ubicación eliminada");
                          list.reload();
                        }}
                      >
                        <span className="sr-only">Eliminar {l.name}</span>
                      </ConfirmButton>
                    </span>
                  ) : (
                    <Badge>Otra área</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
