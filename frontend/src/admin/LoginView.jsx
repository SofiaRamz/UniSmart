import { useState } from "react";
import { LuArrowLeft, LuKeyRound, LuLock } from "react-icons/lu";
import { post } from "../api/client";
import { Brand } from "../components/Brand";
import { Alert, Button, Card, Field, Input } from "../components/ui";

const DEMO_ACCOUNTS = [
  ["superadmin@unismart.demo", "Superadministración"],
  ["control.escolar@unismart.demo", "Control Escolar"],
  ["servicios.escolares@unismart.demo", "Servicios Escolares"],
  ["coordinacion.academica@unismart.demo", "Coordinación Académica"],
  ["mantenimiento@unismart.demo", "Mantenimiento"],
  ["servicios.campus@unismart.demo", "Servicios del Campus"],
];
const DEMO_PASSWORD = "Demo2026unismart";

export default function LoginView({ onLogin, go, mode }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await post("/api/auth/login", { email, password }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gutter mx-auto flex min-h-full max-w-[1040px] flex-col gap-6 py-8 md:justify-center">
      <div className="flex items-center justify-between gap-3">
        <Brand subtitle="Portal administrativo" />
        <a href="#asistente" onClick={() => go("asistente")} className="flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink">
          <LuArrowLeft aria-hidden /> Portal estudiantil
        </a>
      </div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="flex flex-col justify-center gap-4 rounded-2xl bg-pine p-7 text-on-pine">
          <LuLock className="text-3xl text-signal" aria-hidden />
          <h1 className="max-w-[16ch] text-[30px] font-bold leading-tight text-on-pine">Cada área opera solo lo que le corresponde.</h1>
          <ul className="flex flex-col gap-2 text-[14px] opacity-90">
            <li>· Control Escolar y Servicios Escolares publican documentos.</li>
            <li>· Coordinación Académica mantiene horarios y aulas.</li>
            <li>· Mantenimiento y Servicios del Campus atienden reportes.</li>
            <li>· El permiso se valida en el servidor en cada petición.</li>
          </ul>
        </div>
        <Card className="p-6">
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div>
              <h2 className="text-xl font-bold">Iniciar sesión</h2>
              <p className="text-[13.5px] text-muted">Acceso exclusivo para personal autorizado.</p>
            </div>
            <Field label="Correo institucional">
              {(id) => <Input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
            <Field label="Contraseña">
              {(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            <Alert>{error}</Alert>
            <Button type="submit" loading={busy} icon={LuKeyRound}>
              Entrar
            </Button>
          </form>
          {mode === "demo" && (
            <div className="mt-6 border-t border-line pt-4">
              <p className="eyebrow mb-2">Cuentas de demostración · contraseña {DEMO_PASSWORD}</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {DEMO_ACCOUNTS.map(([mail, label]) => (
                  <button
                    key={mail}
                    type="button"
                    onClick={() => {
                      setEmail(mail);
                      setPassword(DEMO_PASSWORD);
                    }}
                    className="rounded-lg border border-line px-3 py-2 text-left text-[12.5px] hover:border-pine"
                  >
                    <span className="block font-semibold text-ink">{label}</span>
                    <span className="block truncate font-mono text-[10.5px] text-muted">{mail}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
