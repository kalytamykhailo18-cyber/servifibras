"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type IntegrationProvider, type IntegrationProviderName, type IntegrationTestResult } from "@/lib/api/endpoints";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import RefreshIcon from "@mui/icons-material/Refresh";
import SyncIcon from "@mui/icons-material/Sync";
import BoltIcon from "@mui/icons-material/Bolt";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HighlightOffIcon from "@mui/icons-material/HighlightOff";
import StorefrontIcon from "@mui/icons-material/Storefront";
import ShoppingBagIcon from "@mui/icons-material/ShoppingBag";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import FacebookIcon from "@mui/icons-material/Facebook";
import InstagramIcon from "@mui/icons-material/Instagram";
import HubIcon from "@mui/icons-material/Hub";

interface ProviderMeta {
  name: string;
  sub: string;
  Icon: React.ComponentType<{ sx?: any; className?: string }>;
  gradient: string;
  externalIdLabel?: string;
}

const PROVIDER_META: Record<IntegrationProviderName, ProviderMeta> = {
  mercadolibre: {
    name: "Mercado Libre",
    sub: "Preguntas, mensajería post-venta y reclamos",
    Icon: StorefrontIcon,
    gradient: "from-amber-500 to-orange-400",
    externalIdLabel: "User ID",
  },
  tiendanube: {
    name: "TiendaNube",
    sub: "Catálogo, precios y pedidos de la tienda online",
    Icon: ShoppingBagIcon,
    gradient: "from-violet-600 to-fuchsia-500",
    externalIdLabel: "Store ID",
  },
  claude: {
    name: "Claude (Anthropic)",
    sub: "Motor de IA para respuestas, redacción y clasificación",
    Icon: SmartToyIcon,
    gradient: "from-indigo-600 to-blue-500",
    externalIdLabel: "Modelo",
  },
  dolarBlue: {
    name: "Dólar Blue (Bluelytics)",
    sub: "Cotización en tiempo real para presupuestos en USD",
    Icon: AttachMoneyIcon,
    gradient: "from-emerald-600 to-green-500",
  },
  whatsapp: {
    name: "WhatsApp Business",
    sub: "Canal principal de atención — Meta Cloud API",
    Icon: WhatsAppIcon,
    gradient: "from-emerald-500 to-teal-500",
    externalIdLabel: "Phone Number ID",
  },
  meta: {
    name: "Facebook + Instagram (Meta)",
    sub: "Mensajes directos por Messenger y por Instagram, autorizados con un solo click",
    Icon: HubIcon,
    gradient: "from-blue-600 via-fuchsia-500 to-pink-500",
    externalIdLabel: "Page ID",
  },
  facebook: {
    name: "Facebook Messenger",
    sub: "Mensajes directos a la página de Facebook",
    Icon: FacebookIcon,
    gradient: "from-blue-600 to-sky-500",
    externalIdLabel: "Page ID",
  },
  instagram: {
    name: "Instagram DM",
    sub: "Mensajes directos a la cuenta de Instagram",
    Icon: InstagramIcon,
    gradient: "from-pink-500 via-rose-500 to-fuchsia-500",
    externalIdLabel: "Account ID",
  },
};

function formatExpiry(iso: string | null, refreshable: boolean): string {
  if (!iso) return "—";
  const expiresAt = new Date(iso);
  const now = Date.now();
  const ms = expiresAt.getTime() - now;
  if (refreshable && ms > 0) {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    if (hours < 24) return `vence en ${hours} h (renueva sola)`;
    const days = Math.floor(hours / 24);
    return `vence en ${days} d (renueva sola)`;
  }
  if (ms > 365 * 24 * 60 * 60 * 1000) return "permanente";
  if (ms < 0) return "vencida";
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  return `vence en ${days} d`;
}

function StatusPill({
  status,
  testid,
}: {
  status: IntegrationProvider["status"];
  testid: string;
}) {
  const cfg = {
    connected: { dot: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200", label: "Conectada" },
    unconfigured: { dot: "bg-slate-400", bg: "bg-slate-50", text: "text-slate-600", ring: "ring-slate-200", label: "No conectada" },
    error: { dot: "bg-rose-500", bg: "bg-rose-50", text: "text-rose-700", ring: "ring-rose-200", label: "Error" },
  }[status];
  return (
    <span
      data-testid={testid}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cfg.bg} ${cfg.text} ${cfg.ring}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

export function IntegrationsForm() {
  const [items, setItems] = useState<IntegrationProvider[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState<IntegrationProvider | null>(null);
  const [tests, setTests] = useState<Record<string, IntegrationTestResult & { ranAt: number }>>({});

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      const data = await api.integrations.list();
      setItems(data);
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo cargar el estado de integraciones");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSync(p: IntegrationProvider) {
    if (p.provider !== "tiendanube") return;
    setBusy(`sync:${p.provider}`);
    try {
      const r = await api.integrations.syncTiendaNube();
      toast.success(
        `Sincronización: ${r?.created ?? 0} nuevos, ${r?.updated ?? 0} actualizados, ${r?.skipped ?? 0} saltados`,
      );
      await refresh(true);
    } catch (err: any) {
      toast.error(err?.message ?? "Error al sincronizar TiendaNube");
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect(p: IntegrationProvider) {
    setBusy(`disconnect:${p.provider}`);
    try {
      await api.integrations.disconnect(p.provider);
      toast.success(`${PROVIDER_META[p.provider].name} desconectada`);
      await refresh(true);
    } catch (err: any) {
      toast.error(err?.message ?? "Error al desconectar");
    } finally {
      setBusy(null);
      setConfirmingDisconnect(null);
    }
  }

  function handleReconnect(p: IntegrationProvider) {
    if (!p.installUrl) {
      toast.error("URL de instalación no disponible");
      return;
    }
    window.open(p.installUrl, "_blank", "noopener,noreferrer");
  }

  async function handleTest(p: IntegrationProvider) {
    setBusy(`test:${p.provider}`);
    try {
      const r = await api.integrations.test(p.provider);
      setTests((prev) => ({ ...prev, [p.provider]: { ...r, ranAt: Date.now() } }));
      if (r.success) {
        toast.success(`${PROVIDER_META[p.provider].name}: ${r.detail ?? "ok"} (${r.latencyMs}ms)`);
      } else {
        toast.error(`${PROVIDER_META[p.provider].name}: ${r.reason ?? "fallo desconocido"}`);
      }
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo ejecutar la prueba");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-6 text-sm text-slate-500">
        Cargando estado de integraciones…
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {items?.map((p) => {
          const meta = PROVIDER_META[p.provider];
          if (!meta) return null;
          const Icon = meta.Icon;
          const isOAuth = p.kind === "oauth";

          return (
            <div
              key={p.provider}
              data-testid={`integration-card-${p.provider}`}
              className="rounded-2xl border border-slate-200 bg-white/70 p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
            >
              <div className="flex items-start gap-4">
                <span
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${meta.gradient} text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25)]`}
                >
                  <Icon sx={{ fontSize: 22 }} />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">{meta.name}</h3>
                    <StatusPill status={p.status} testid={`integration-status-${p.provider}`} />
                    <span
                      className={`text-[10px] font-medium uppercase tracking-wider ${
                        isOAuth ? "text-amber-700" : "text-slate-500"
                      }`}
                    >
                      {isOAuth ? "OAuth" : "Configuración .env"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">{meta.sub}</p>

                  {p.status === "connected" ? (
                    <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                      {p.externalId && meta.externalIdLabel && (
                        <div className="flex items-center gap-2">
                          <dt className="text-slate-500">{meta.externalIdLabel}:</dt>
                          <dd className="font-mono text-slate-700">{p.externalId}</dd>
                        </div>
                      )}
                      {isOAuth && p.expiresAt && (
                        <div className="flex items-center gap-2">
                          <dt className="text-slate-500">Token:</dt>
                          <dd className="text-slate-700">{formatExpiry(p.expiresAt, p.refreshable)}</dd>
                        </div>
                      )}
                      {p.productCount != null && (
                        <div className="flex items-center gap-2">
                          <dt className="text-slate-500">Productos sincronizados:</dt>
                          <dd className="font-medium text-slate-700">{p.productCount}</dd>
                        </div>
                      )}
                      {p.provider === "meta" && p.metadata?.pageName && (
                        <div className="flex items-center gap-2">
                          <dt className="text-slate-500">Página:</dt>
                          <dd className="text-slate-700">{p.metadata.pageName}</dd>
                        </div>
                      )}
                      {p.provider === "meta" && p.metadata?.instagramUsername && (
                        <div className="flex items-center gap-2">
                          <dt className="text-slate-500">Instagram:</dt>
                          <dd className="font-mono text-slate-700">@{p.metadata.instagramUsername}</dd>
                        </div>
                      )}
                      {!isOAuth && p.metadata?.endpoint && (
                        <div className="flex items-center gap-2">
                          <dt className="text-slate-500">Endpoint:</dt>
                          <dd className="font-mono text-slate-700 truncate">{p.metadata.endpoint}</dd>
                        </div>
                      )}
                      {!isOAuth && p.metadata?.cacheMinutes && (
                        <div className="flex items-center gap-2">
                          <dt className="text-slate-500">Caché:</dt>
                          <dd className="text-slate-700">{p.metadata.cacheMinutes} min</dd>
                        </div>
                      )}
                      {!isOAuth && p.metadata?.fallbackModel && (
                        <div className="flex items-center gap-2">
                          <dt className="text-slate-500">Fallback:</dt>
                          <dd className="font-mono text-slate-700">{p.metadata.fallbackModel}</dd>
                        </div>
                      )}
                    </dl>
                  ) : (
                    <p className="mt-3 text-xs text-slate-500">
                      {isOAuth
                        ? p.installUrl
                          ? "No hay credenciales guardadas. Hacé click en \"Conectar\" para iniciar el flujo de instalación."
                          : "Faltan variables del proveedor en backend/.env (App ID + redirect URI). Configurarlas habilita el botón Conectar."
                        : "Faltan variables en backend/.env del proveedor. La integración está inactiva hasta que se configure."}
                    </p>
                  )}

                  {p.provider === "meta" && (
                    <div
                      data-testid="meta-dev-mode-notice"
                      className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900 ring-1 ring-inset ring-amber-200"
                    >
                      <span className="font-semibold">Modo desarrollo de Meta:</span>{" "}
                      Hasta que la verificación de la app esté aprobada, los DMs públicos
                      de Instagram solo llegan al agente desde cuentas cargadas como
                      admin/tester en la Meta app. Para probar el flujo end-to-end mientras
                      tanto, usá el canal <span className="font-mono">Instagram</span> del sandbox.
                    </div>
                  )}

                  {p.errorReason && (
                    <p className="mt-2 text-xs text-rose-700">{p.errorReason}</p>
                  )}

                  {tests[p.provider] && (
                    <div
                      data-testid={`integration-test-result-${p.provider}`}
                      className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                        tests[p.provider].success
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-rose-200 bg-rose-50 text-rose-800"
                      }`}
                    >
                      {tests[p.provider].success ? (
                        <CheckCircleIcon sx={{ fontSize: 16 }} className="mt-0.5 text-emerald-600" />
                      ) : (
                        <HighlightOffIcon sx={{ fontSize: 16 }} className="mt-0.5 text-rose-600" />
                      )}
                      <span className="flex-1">
                        <span className="font-semibold">
                          {tests[p.provider].success ? "Conexión OK" : "Conexión falló"}
                        </span>
                        <span className="ml-1 text-slate-500">
                          ({tests[p.provider].latencyMs}ms · {new Date(tests[p.provider].ranAt).toLocaleTimeString("es-AR")})
                        </span>
                        {(tests[p.provider].detail || tests[p.provider].reason) && (
                          <span className="block">{tests[p.provider].detail ?? tests[p.provider].reason}</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {p.status === "connected" && (
                  <button
                    type="button"
                    data-testid={`integration-test-${p.provider}`}
                    disabled={busy === `test:${p.provider}`}
                    onClick={() => handleTest(p)}
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <BoltIcon
                      sx={{ fontSize: 16 }}
                      className={busy === `test:${p.provider}` ? "animate-pulse text-amber-600" : "text-amber-600"}
                    />
                    {busy === `test:${p.provider}` ? "Probando…" : "Probar conexión"}
                  </button>
                )}

                {p.status === "connected" && p.provider === "tiendanube" && (
                  <button
                    type="button"
                    data-testid={`integration-sync-${p.provider}`}
                    disabled={busy === `sync:${p.provider}`}
                    onClick={() => handleSync(p)}
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-violet-300 bg-violet-50 px-4 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <SyncIcon
                      sx={{ fontSize: 16 }}
                      className={busy === `sync:${p.provider}` ? "animate-spin text-violet-600" : "text-violet-600"}
                    />
                    Sincronizar ahora
                  </button>
                )}

                {isOAuth && p.installUrl && (
                  <button
                    type="button"
                    data-testid={`integration-reconnect-${p.provider}`}
                    onClick={() => handleReconnect(p)}
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
                  >
                    {p.status === "connected" ? (
                      <>
                        <RefreshIcon sx={{ fontSize: 16 }} className="text-emerald-600" />
                        Reconectar
                      </>
                    ) : (
                      <>
                        <LinkIcon sx={{ fontSize: 16 }} className="text-emerald-600" />
                        Conectar
                      </>
                    )}
                  </button>
                )}

                {isOAuth && p.status === "connected" && (
                  <button
                    type="button"
                    data-testid={`integration-disconnect-${p.provider}`}
                    disabled={busy === `disconnect:${p.provider}`}
                    onClick={() => setConfirmingDisconnect(p)}
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-rose-200 bg-white px-4 text-sm font-medium text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <LinkOffIcon sx={{ fontSize: 16 }} className="text-rose-600" />
                    Desconectar
                  </button>
                )}

                {!isOAuth && p.status !== "connected" && (
                  <span className="text-xs text-slate-500">
                    Configurar las variables del proveedor en <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px]">backend/.env</code>.
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog
        open={!!confirmingDisconnect}
        onOpenChange={(open) => {
          if (!open) setConfirmingDisconnect(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Desconectar {confirmingDisconnect ? PROVIDER_META[confirmingDisconnect.provider].name : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminan las credenciales guardadas. La integración deja de funcionar hasta que la
              vuelvas a instalar desde la cuenta del comercio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmingDisconnect && handleDisconnect(confirmingDisconnect)}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
