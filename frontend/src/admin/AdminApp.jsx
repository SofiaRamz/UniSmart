import { useEffect } from "react";
import {
  LuActivity,
  LuArrowLeft,
  LuBuilding2,
  LuCalendarDays,
  LuFileText,
  LuLogOut,
  LuMapPin,
  LuScrollText,
  LuUsers,
  LuWrench,
} from "react-icons/lu";
import { post } from "../api/client";
import { Brand } from "../components/Brand";
import { Badge } from "../components/ui";
import { cx } from "../lib/format";
import DocumentsPanel from "./DocumentsPanel";
import LocationsPanel from "./LocationsPanel";
import ReportsPanel from "./ReportsPanel";
import SchedulesPanel from "./SchedulesPanel";
import { AuditPanel, DepartmentsPanel, MetricsPanel, UsersPanel } from "./SuperPanels";

const MODULE_NAV = [
  { id: "panel-documentos", module: "documents", label: "Documentos", icon: LuFileText, Component: DocumentsPanel },
  { id: "panel-horarios", module: "schedules", label: "Horarios", icon: LuCalendarDays, Component: SchedulesPanel },
  { id: "panel-reportes", module: "reports", label: "Reportes", icon: LuWrench, Component: ReportsPanel },
  { id: "panel-ubicaciones", module: "locations", label: "Ubicaciones", icon: LuMapPin, Component: LocationsPanel },
];
const SUPER_NAV = [
  { id: "panel-metricas", label: "Métricas", icon: LuActivity, Component: MetricsPanel },
  { id: "panel-usuarios", label: "Usuarios", icon: LuUsers, Component: UsersPanel },
  { id: "panel-departamentos", label: "Departamentos", icon: LuBuilding2, Component: DepartmentsPanel },
  { id: "panel-auditoria", label: "Auditoría", icon: LuScrollText, Component: AuditPanel },
];

export default function AdminApp({ me, route, go, onLogout, mode }) {
  const modules = new Set(me.departments.flatMap((d) => d.modules));
  const moduleItems = MODULE_NAV.filter((n) => me.is_superadmin || modules.has(n.module));
  const superItems = me.is_superadmin ? SUPER_NAV : [];
  const items = [...superItems, ...moduleItems];
  const current = items.find((i) => i.id === route) || items[0];

  useEffect(() => {
    if (current && route !== current.id) window.history.replaceState(null, "", `#${current.id}`);
  }, [current, route]);

  async function logout() {
    try {
      await post("/api/auth/logout");
    } finally {
      onLogout();
    }
  }

  const NavLink = ({ item }) => (
    <a
      href={`#${item.id}`}
      onClick={() => go(item.id)}
      aria-current={current?.id === item.id ? "page" : undefined}
      className={cx(
        "flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-[14px] font-semibold transition-colors",
        current?.id === item.id ? "bg-pine text-on-pine" : "text-muted hover:bg-sunken hover:text-ink",
      )}
    >
      <item.icon aria-hidden /> {item.label}
    </a>
  );

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:h-[100dvh] lg:w-[260px] lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="gutter flex items-center justify-between gap-3 py-4 lg:block lg:px-5">
          <Brand subtitle="Panel administrativo" />
          <button type="button" onClick={logout} className="flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-danger lg:hidden">
            <LuLogOut aria-hidden /> Salir
          </button>
        </div>
        <nav className="gutter flex gap-1 overflow-x-auto pb-3 lg:flex-col lg:px-3" aria-label="Panel">
          {superItems.length > 0 && <p className="eyebrow hidden px-3 pb-1 pt-2 lg:block">Sistema</p>}
          {superItems.map((i) => (
            <NavLink key={i.id} item={i} />
          ))}
          {moduleItems.length > 0 && <p className="eyebrow hidden px-3 pb-1 pt-4 lg:block">Operación</p>}
          {moduleItems.map((i) => (
            <NavLink key={i.id} item={i} />
          ))}
        </nav>
        <div className="hidden px-5 pt-6 lg:block">
          <div className="rounded-xl border border-line p-3">
            <p className="truncate text-[13.5px] font-semibold">{me.full_name}</p>
            <p className="truncate font-mono text-[11px] text-muted">{me.email}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {me.is_superadmin && <Badge tone="signal">Superadministrador</Badge>}
              {me.departments.map((d) => (
                <Badge key={d.id} tone="pine">
                  {d.name}
                </Badge>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-1">
            <a href="#asistente" onClick={() => go("asistente")} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold text-muted hover:bg-sunken hover:text-ink">
              <LuArrowLeft aria-hidden /> Portal estudiantil
            </a>
            <button type="button" onClick={logout} className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-muted hover:bg-danger-soft hover:text-danger">
              <LuLogOut aria-hidden /> Cerrar sesión
            </button>
          </div>
          {mode === "demo" && <p className="mt-4 px-1 text-[11.5px] text-muted">Modo demostración: los cambios viven en esta pestaña y se pierden al recargar.</p>}
        </div>
      </aside>
      <main className="gutter min-w-0 flex-1 pb-16 pt-6 lg:px-8">
        <div className="mx-auto max-w-[1180px]">
          {current ? (
            <current.Component me={me} live={mode === "live"} />
          ) : (
            <p className="text-muted">Tu cuenta no tiene módulos asignados. Pide al superadministrador que revise tu departamento.</p>
          )}
        </div>
      </main>
    </div>
  );
}
