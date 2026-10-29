import { useEffect, useMemo, useRef, useState } from "react";
import { LuEye, LuFileText, LuRefreshCw, LuTrash2, LuUpload } from "react-icons/lu";
import { del, get, post } from "../api/client";
import { Alert, Badge, Button, Card, ConfirmButton, Drawer, Empty, Field, Input, SectionTitle, Select, Spinner, useLoad, useToast } from "../components/ui";
import { cx, DOC_STATUS, fmtBytes, fmtDate } from "../lib/format";

function useDocumentDepartments(me) {
  const own = useMemo(() => me.departments.filter((d) => d.modules.includes("documents")), [me]);
  const [list, setList] = useState(own);
  useEffect(() => {
    if (!me.is_superadmin) return;
    get("/api/superadmin/departments")
      .then((d) => setList(d.departments.filter((x) => x.is_active && x.modules.includes("documents"))))
      .catch(() => setList(own));
  }, [me, own]);
  return list;
}

export default function DocumentsPanel({ me }) {
  const toast = useToast();
  const departments = useDocumentDepartments(me);
  const docs = useLoad(() => get("/api/admin/documents"), []);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [depId, setDepId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  const processing = docs.data?.documents.some((d) => d.status === "processing");
  useEffect(() => {
    if (!processing) return undefined;
    const t = setInterval(() => get("/api/admin/documents").then((d) => docs.setData(d)), 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processing]);

  const pick = (f) => {
    if (!f) return;
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " "));
  };

  async function upload(e) {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Selecciona un archivo PDF");
    const data = new FormData();
    data.append("file", file);
    data.append("title", title);
    if (depId) data.append("department_id", depId);
    setUploading(true);
    try {
      const doc = await post("/api/admin/documents", data, { form: true });
      toast(`«${doc.title}» se está procesando`);
      setFile(null);
      setTitle("");
      if (inputRef.current) inputRef.current.value = "";
      docs.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function openDetail(id) {
    setDetail({ loading: true });
    try {
      setDetail(await get(`/api/admin/documents/${id}`));
    } catch (err) {
      setDetail({ error: err.message });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle eyebrow={departments.map((d) => d.name).join(" · ") || "Documentos"} title="Documentos oficiales">
        Lo que publiques aquí es la única fuente del chatbot para trámites y reglamentos. Cada PDF se valida, se extrae con PyMuPDF y se indexa con citas por página.
      </SectionTitle>

      <Card className="p-5">
        <form onSubmit={upload} className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <label
            htmlFor="doc-file"
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              pick(e.dataTransfer.files?.[0]);
            }}
            className={cx(
              "flex min-h-[150px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 text-center transition-colors",
              drag ? "border-pine bg-pine-soft" : "border-line hover:border-pine",
            )}
          >
            <LuUpload className="text-2xl text-pine" aria-hidden />
            {file ? (
              <span className="text-[14px] font-semibold">
                {file.name} <span className="font-mono text-[12px] font-normal text-muted">{fmtBytes(file.size)}</span>
              </span>
            ) : (
              <span className="text-[14px]">
                <strong>Arrastra un PDF</strong> o haz clic para elegirlo
              </span>
            )}
            <span className="text-[12px] text-muted">Máximo 20 MB · se verifica que sea un PDF real</span>
            <input id="doc-file" ref={inputRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          <div className="flex flex-col gap-3">
            <Field label="Título visible en las citas">
              {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Reglamento General de Estudiantes" maxLength={200} />}
            </Field>
            {departments.length > 1 && (
              <Field label="Departamento">
                {(id) => (
                  <Select id={id} value={depId} onChange={(e) => setDepId(e.target.value)}>
                    <option value="">Selecciona…</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Alert>{error}</Alert>
            <Button type="submit" icon={LuUpload} loading={uploading} disabled={!file || title.trim().length < 3} className="self-start">
              Subir y procesar
            </Button>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        {docs.loading ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : docs.error ? (
          <Alert className="m-4">{docs.error.message}</Alert>
        ) : docs.data.documents.length === 0 ? (
          <div className="p-4">
            <Empty icon={LuFileText} title="Sin documentos">
              Sube el primer reglamento o guía de trámites de tu área.
            </Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13.5px]">
              <thead className="bg-sunken text-left text-[12px] text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Documento</th>
                  <th className="px-3 py-2.5 font-semibold">Departamento</th>
                  <th className="px-3 py-2.5 font-semibold">Estado</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Págs.</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Fragmentos</th>
                  <th className="px-3 py-2.5 font-semibold">Subido</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {docs.data.documents.map((d) => (
                  <tr key={d.id} className="border-t border-line align-middle">
                    <td className="max-w-[320px] px-4 py-3">
                      <p className="truncate font-semibold">{d.title}</p>
                      <p className="truncate font-mono text-[11px] text-muted">
                        {d.original_filename} · {fmtBytes(d.size_bytes)}
                      </p>
                      {d.error_message && <p className="mt-1 text-[12px] text-danger">{d.error_message}</p>}
                    </td>
                    <td className="px-3 py-3 text-muted">{d.department?.name}</td>
                    <td className="px-3 py-3">
                      <Badge tone={DOC_STATUS[d.status].tone}>{DOC_STATUS[d.status].label}</Badge>
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular">{d.page_count}</td>
                    <td className="px-3 py-3 text-right font-mono tabular">{d.chunk_count}</td>
                    <td className="px-3 py-3 text-muted">
                      {fmtDate(d.created_at)}
                      <span className="block text-[11.5px]">{d.uploaded_by}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" icon={LuEye} onClick={() => openDetail(d.id)}>
                          Ver
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={LuRefreshCw}
                          disabled={d.status === "processing"}
                          onClick={async () => {
                            await post(`/api/admin/documents/${d.id}/reindex`);
                            toast("Reprocesando documento");
                            docs.reload();
                          }}
                        >
                          Reprocesar
                        </Button>
                        <ConfirmButton
                          icon={LuTrash2}
                          confirmLabel="Eliminar"
                          variant="ghost"
                          onConfirm={async () => {
                            await del(`/api/admin/documents/${d.id}`);
                            toast("Documento eliminado del índice");
                            docs.reload();
                          }}
                        >
                          Eliminar
                        </ConfirmButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Drawer open={!!detail} onClose={() => setDetail(null)} title={detail?.title || "Documento"} wide>
        {detail?.loading ? (
          <Spinner />
        ) : detail?.error ? (
          <Alert>{detail.error}</Alert>
        ) : detail ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone={DOC_STATUS[detail.status].tone}>{DOC_STATUS[detail.status].label}</Badge>
              <Badge>{detail.page_count} páginas</Badge>
              <Badge>{detail.chunk_count} fragmentos</Badge>
              <Badge tone={detail.is_public ? "ok" : "neutral"}>{detail.is_public ? "Visible para el chatbot" : "Oculto"}</Badge>
            </div>
            <p className="eyebrow">Primeros fragmentos indexados</p>
            {detail.chunks_preview.map((c) => (
              <div key={c.index} className="rounded-lg border border-line p-3">
                <p className="mb-1 font-mono text-[11px] text-muted">
                  #{c.index} · página {c.page}
                </p>
                <p className="text-[13.5px] leading-relaxed">{c.content}</p>
              </div>
            ))}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
