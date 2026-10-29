import { useCallback, useEffect, useState } from "react";
import { LuCalendarDays, LuLogIn, LuMap, LuMessagesSquare, LuShieldCheck, LuWrench } from "react-icons/lu";
import AdminApp from "./admin/AdminApp";
import LoginView from "./admin/LoginView";
import { detectMode, get, getMode, setCsrf } from "./api/client";
import { Brand } from "./components/Brand";
import { Spinner, ToastProvider } from "./components/ui";
import { cx } from "./lib/format";
import ChatView from "./public/ChatView";
import MapView from "./public/MapView";
import ReportView from "./public/ReportView";
import ScheduleView from "./public/ScheduleView";

const PUBLIC_TABS = [
  { id: "asistente", label: "Asistente", icon: LuMessagesSquare },
  { id: "horarios", label: "Horarios", icon: LuCalendarDays },
  { id: "mapa", label: "Mapa", icon: LuMap },
  { id: "reportes", label: "Reportes", icon: LuWrench },
];

function readHash() {
  const h = window.location.hash.replace(/^#/, "");
  return /^[a-z0-9-]+$/.test(h) ? h : "asistente";
}

export default function App() {
  const [mode, setMode] = useState(getMode);
  const [route, setRoute] = useState(readHash);
  const [me, setMe] = useState(undefined);
  const [mapFocus, setMapFocus] = useState(null);
  const [scheduleFocus, setScheduleFocus] = useState(null);

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    detectMode().then(async (m) => {
      setMode(m);
      try {
        const user = await get("/api/auth/me");
        setCsrf(user.csrf_token);
        setMe(user);
      } catch {
        setMe(null);
      }
    });
  }, []);

  const go = useCallback((id) => {
    if (window.location.hash !== `#${id}`) window.location.hash = id;
    setRoute(id);
    window.scrollTo({ top: 0 });
  }, []);

  const onLogin = (user) => {
    setCsrf(user.csrf_token);
    setMe(user);
    go("panel");
  };
  const onLogout = () => {
    setCsrf(null);
    setMe(null);
    go("acceso");
  };

  const isAdminRoute = route === "acceso" || route.startsWith("panel");
  if (!mode || (isAdminRoute && me === undefined)) {
    return (
      <div className="gutter grid min-h-[60vh] place-items-center">
        <Spinner label="Iniciando UniSmart AI…" />
      </div>
    );
  }

  return (
    <ToastProvider>
      {isAdminRoute ? (
        me ? (
          <AdminApp me={me} route={route} go={go} onLogout={onLogout} mode={mode} />
        ) : (
          <LoginView onLogin={onLogin} go={go} mode={mode} />
        )
      ) : (
        <PublicShell route={route} go={go} me={me} mode={mode}>
          {route === "horarios" ? (
            <ScheduleView focus={scheduleFocus} />
          ) : route === "mapa" ? (
            <MapView focusId={mapFocus} live={mode === "live"} />
          ) : route === "reportes" ? (
            <ReportView />
          ) : (
            <ChatView
              mode={mode}
              onShowLocation={(id) => {
                setMapFocus(id);
                go("mapa");
              }}
              onShowSchedule={(filter) => {
                setScheduleFocus({ ...filter, at: Date.now() });
                go("horarios");
              }}
            />
          )}
        </PublicShell>
      )}
    </ToastProvider>
  );
}

function PublicShell({ route, go, me, mode, children }) {
  const active = PUBLIC_TABS.some((t) => t.id === route) ? route : "asistente";
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky z-[900] border-b border-line bg-surface/95 backdrop-blur" style={{ top: "env(safe-area-inset-top, 0px)" }}>
        <div className="gutter mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-4">
          <a href="#asistente" onClick={() => go("asistente")} aria-label="UniSmart AI, inicio">
            <Brand subtitle="Asistente universitario" />
          </a>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Secciones">
            {PUBLIC_TABS.map((t) => (
              <a
                key={t.id}
                href={`#${t.id}`}
                aria-current={active === t.id ? "page" : undefined}
                className={cx(
                  "relative flex items-center gap-2 rounded-lg px-3.5 py-2 text-[14px] font-semibold transition-colors",
                  active === t.id ? "text-ink" : "text-muted hover:bg-sunken hover:text-ink",
                )}
              >
                <t.icon aria-hidden /> {t.label}
                {active === t.id && <span className="absolute inset-x-3 -bottom-[13px] h-[3px] rounded-full bg-signal" />}
              </a>
            ))}
          </nav>
          <a
            href={me ? "#panel" : "#acceso"}
            className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-ink hover:border-pine hover:text-pine"
          >
            {me ? <LuShieldCheck aria-hidden /> : <LuLogIn aria-hidden />}
            <span>{me ? "Mi panel" : "Personal"}</span>
          </a>
        </div>
      </header>
      {mode === "demo" && (
        <div className="border-b border-line bg-signal-soft">
          <p className="gutter mx-auto max-w-[1240px] py-1.5 text-[12.5px] text-ink">
            <strong className="font-mono text-[11px] uppercase tracking-wider">Modo demostración</strong> · Datos de ejemplo y
            respuestas simuladas en el navegador con las mismas reglas del backend. Con FastAPI encendido la app usa PostgreSQL y
            Qwen3-4B.
          </p>
        </div>
      )}
      <main className="gutter mx-auto w-full max-w-[1240px] flex-1 pb-28 pt-6 md:pb-12">{children}</main>
      <nav
        className="fixed inset-x-0 bottom-0 z-[900] grid grid-cols-4 border-t border-line bg-surface md:hidden"
        style={{
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
        aria-label="Secciones"
      >
        {PUBLIC_TABS.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            aria-current={active === t.id ? "page" : undefined}
            className={cx("flex flex-col items-center gap-1 py-2.5 text-[11.5px] font-semibold", active === t.id ? "text-pine" : "text-muted")}
          >
            <t.icon className="text-[19px]" aria-hidden />
            {t.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
