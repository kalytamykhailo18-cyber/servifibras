"use client";

// Marcos's remarketing-campaign panel.
// One page, two stacked sections:
//   1) Composer — pick filters (customerType / funnelStage), preview the
//      segment count, write the message with {{nombre}}, then create + send.
//   2) History — table of past campaigns and their delivery counters.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CustomerType, FunnelStage,
  CUSTOMER_TYPE_LABELS, FUNNEL_STAGE_LABELS,
  UserRole,
} from "@/types";
import { api } from "@/lib/api/endpoints";
import { useRoleGuard } from "@/lib/hooks/use-role-guard";
import { useClientPagination } from "@/lib/hooks/use-client-pagination";
import { Pagination } from "@/components/ui/pagination";
import CampaignIcon from "@mui/icons-material/Campaign";
import SendIcon from "@mui/icons-material/Send";
import RefreshIcon from "@mui/icons-material/Refresh";
import GroupsIcon from "@mui/icons-material/Groups";
import HistoryToggleOffIcon from "@mui/icons-material/HistoryToggleOff";
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

const CAMPAIGN_ROLES = [UserRole.ADMIN];

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  SENDING: "Enviando",
  COMPLETED: "Completada",
  FAILED: "Falló",
};
const STATUS_PILL: Record<string, string> = {
  DRAFT:     "border-slate-200 bg-slate-50 text-slate-700",
  SENDING:   "border-blue-200 bg-blue-50 text-blue-700",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  FAILED:    "border-rose-200 bg-rose-50 text-rose-700",
};

export default function CampaignsPage() {
  const { isAllowed } = useRoleGuard(CAMPAIGN_ROLES);

  const [customerTypes, setCustomerTypes] = useState<CustomerType[]>([]);
  const [funnelStages, setFunnelStages] = useState<FunnelStage[]>([]);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("Hola {{nombre}}, tenemos novedades para vos.");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewSample, setPreviewSample] = useState<Array<{ name: string | null }>>([]);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.campaigns.list>>>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [reactivationConfirmOpen, setReactivationConfirmOpen] = useState(false);
  const pg = useClientPagination(history, { storageKey: "campaigns", defaultPageSize: 25 });

  useEffect(() => {
    if (!isAllowed) return;
    refreshHistory();
  }, [isAllowed]);

  const refreshHistory = async () => {
    try {
      setHistoryLoading(true);
      const list = await api.campaigns.list();
      setHistory(list);
    } catch {
      // empty list on error — page still usable
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleCustomerType = (t: CustomerType) => {
    setCustomerTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
    setPreviewCount(null);
  };
  const toggleFunnelStage = (s: FunnelStage) => {
    setFunnelStages((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
    setPreviewCount(null);
  };

  const onPreview = async () => {
    if (customerTypes.length === 0 && funnelStages.length === 0) {
      toast.error("Elegí al menos un filtro");
      return;
    }
    setIsPreviewing(true);
    try {
      const r = await api.campaigns.preview({ customerTypes, funnelStages });
      setPreviewCount(r.count);
      setPreviewSample(r.sample);
    } catch (err: any) {
      toast.error(err?.message ?? "Error al previsualizar");
    } finally {
      setIsPreviewing(false);
    }
  };

  const onCreateAndSend = async () => {
    if (!name.trim()) {
      toast.error("Poné un nombre a la campaña");
      return;
    }
    if (!template.trim()) {
      toast.error("Escribí el mensaje");
      return;
    }
    if (customerTypes.length === 0 && funnelStages.length === 0) {
      toast.error("Elegí al menos un filtro");
      return;
    }
    setIsSending(true);
    try {
      const created = await api.campaigns.create({
        name,
        messageTemplate: template,
        filters: { customerTypes: customerTypes as string[], funnelStages: funnelStages as string[] },
      });
      toast.success(`Campaña creada (${created.pending} destinatarios)`);
      const result = await api.campaigns.send(created.campaignId);
      if (result.failed === 0) {
        toast.success(`Enviado a ${result.sent} destinatarios`);
      } else {
        toast.message("Envío parcial", {
          description: `OK: ${result.sent} · Fallaron: ${result.failed}`,
        });
      }
      // Reset composer + refresh list
      setName("");
      setPreviewCount(null);
      setPreviewSample([]);
      await refreshHistory();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "Error al enviar");
    } finally {
      setIsSending(false);
    }
  };

  const onRunReactivation = () => setReactivationConfirmOpen(true);
  const confirmRunReactivation = async () => {
    setReactivationConfirmOpen(false);
    try {
      const r = await api.campaigns.runReactivation();
      if (r.flagged === 0) {
        toast.message("Sin reactivaciones pendientes", {
          description: "No hay compradores dormidos por encima del umbral.",
        });
      } else {
        toast.success(`${r.flagged} contactos reactivados`, {
          description: r.campaignId
            ? `Campaña enviada — OK: ${r.campaignSent} · Fallaron: ${r.campaignFailed}`
            : "Sin campaña automática (CONTACT_REACTIVATION_AUTO_CAMPAIGN=false)",
        });
      }
      await refreshHistory();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "Error al correr reactivación");
    }
  };

  if (!isAllowed) return null;

  return (
    <div className="space-y-6">
      {/* PAGE HEADER */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-pink-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(217_70_239/0.5)] sm:h-11 sm:w-11">
            <CampaignIcon sx={{ fontSize: 20 }} className="sm:[font-size:22px]" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-3xl text-slate-900">Campañas</h1>
            <p className="hidden text-sm text-muted-foreground sm:block">
              Mensaje masivo a un segmento de contactos.
            </p>
          </div>
        </div>
      </div>

      {/* COMPOSER */}
      <section className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] space-y-5">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Nombre de la campaña
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ej. Reactivación mayoristas mayo"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Tipo de cliente
          </label>
          <div className="flex flex-wrap gap-2">
            {Object.values(CustomerType).map((t) => {
              const active = customerTypes.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleCustomerType(t)}
                  className={
                    "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors " +
                    (active
                      ? "border-fuchsia-500 bg-fuchsia-50 text-fuchsia-700"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50")
                  }
                >
                  {CUSTOMER_TYPE_LABELS[t]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Etapa del funnel
          </label>
          <div className="flex flex-wrap gap-2">
            {Object.values(FunnelStage).map((s) => {
              const active = funnelStages.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleFunnelStage(s)}
                  className={
                    "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors " +
                    (active
                      ? "border-fuchsia-500 bg-fuchsia-50 text-fuchsia-700"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50")
                  }
                >
                  {FUNNEL_STAGE_LABELS[s]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Mensaje
            <span className="ml-2 font-normal text-slate-400 normal-case">— usá <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">{`{{nombre}}`}</code> para insertar el primer nombre del contacto</span>
          </label>
          <textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            rows={4}
            className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            onClick={onPreview}
            disabled={isPreviewing || isSending}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:border-fuchsia-300 hover:bg-fuchsia-50 hover:text-fuchsia-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshIcon sx={{ fontSize: 16 }} className="text-blue-600" />
            {isPreviewing ? "Calculando…" : "Previsualizar segmento"}
          </button>

          {previewCount != null && (
            <span className="inline-flex items-center gap-2 rounded-full border border-fuchsia-200 bg-fuchsia-50 px-3 py-1.5 text-xs font-medium text-fuchsia-700">
              <GroupsIcon sx={{ fontSize: 14 }} />
              {previewCount} destinatario{previewCount === 1 ? "" : "s"}
            </span>
          )}

          <div className="ml-auto">
            <button
              type="button"
              onClick={onCreateAndSend}
              disabled={isSending || (previewCount ?? 0) === 0}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-fuchsia-600 to-pink-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(217_70_239/0.5)] hover:from-fuchsia-700 hover:to-pink-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSending ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <SendIcon sx={{ fontSize: 16 }} />
              )}
              Crear y enviar
            </button>
          </div>
        </div>

        {previewSample.length > 0 && (
          <div className="rounded-xl border border-slate-200/70 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-700">Algunos destinatarios: </span>
            {previewSample.slice(0, 8).map((s) => s.name ?? "Sin nombre").join(" · ")}
            {previewCount && previewCount > previewSample.length && ` y ${previewCount - previewSample.length} más`}
          </div>
        )}
      </section>

      {/* REACTIVACIÓN — manual trigger for the dormant-customer pipeline.
          The cron also runs nightly; this button is for "fire it now". */}
      <section className="rounded-2xl border border-violet-200/70 bg-violet-50/40 p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-violet-900">Reactivación de clientes dormidos</h2>
            <p className="text-[12px] text-violet-700/80">
              Marca como REACTIVAR a los COMPRADOR/FRECUENTE sin pedidos recientes y manda una campaña por defecto. Corre solo cada noche.
            </p>
          </div>
          <button
            type="button"
            onClick={onRunReactivation}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-violet-300 bg-white px-3 text-xs font-medium text-violet-700 hover:border-violet-400 hover:bg-violet-100"
          >
            <RefreshIcon sx={{ fontSize: 14 }} className="text-violet-600" />
            Correr ahora
          </button>
        </div>
      </section>

      {/* HISTORY */}
      <section className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Historial</h2>
          <button
            type="button"
            onClick={refreshHistory}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
          >
            <RefreshIcon sx={{ fontSize: 14 }} />
            Refrescar
          </button>
        </div>
        {historyLoading ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no enviaste ninguna campaña.</p>
        ) : (
          <>
            <Pagination
              position="top"
              page={pg.page}
              totalPages={pg.totalPages}
              totalItems={pg.totalItems}
              pageSize={pg.pageSize}
              onPageChange={pg.setPage}
              onPageSizeChange={pg.setPageSize}
            />
            <ul className="divide-y divide-slate-100 mt-2">
              {pg.slice.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-900">{c.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {new Date(c.createdAt).toLocaleString("es-AR")} · {c.targetCount} destinatarios
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-slate-600">
                    OK {c.sentCount} · Falló {c.failedCount}
                  </span>
                  <span
                    className={
                      "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium " +
                      (STATUS_PILL[c.status] ?? "border-slate-200 bg-slate-50 text-slate-700")
                    }
                  >
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <Pagination
                position="bottom"
                page={pg.page}
                totalPages={pg.totalPages}
                totalItems={pg.totalItems}
                pageSize={pg.pageSize}
                onPageChange={pg.setPage}
                onPageSizeChange={pg.setPageSize}
              />
            </div>
          </>
        )}
      </section>

      <AlertDialog open={reactivationConfirmOpen} onOpenChange={setReactivationConfirmOpen}>
        <AlertDialogContent className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150">
          <AlertDialogHeader className="space-y-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(139_92_246/0.45)]">
              <HistoryToggleOffIcon sx={{ fontSize: 22 }} />
            </span>
            <AlertDialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              ¿Correr la reactivación ahora?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-slate-600">
              Va a marcar como <span className="font-semibold text-slate-900">REACTIVAR</span> a los
              compradores dormidos por encima del umbral configurado y, si la campaña automática
              está activa, mandar el mensaje de reactivación. La acción es inmediata y no se puede
              deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRunReactivation}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-violet-600 to-purple-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(139_92_246/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(139_92_246/0.65)] active:translate-y-0 active:scale-[0.97]"
            >
              Correr ahora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
