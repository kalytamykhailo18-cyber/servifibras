"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
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
import { api, type LaminadosPricelistResponse } from "@/lib/api/endpoints";
import { toast } from "sonner";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import RefreshIcon from "@mui/icons-material/Refresh";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import StraightenIcon from "@mui/icons-material/Straighten";
import PercentIcon from "@mui/icons-material/Percent";
import LayersIcon from "@mui/icons-material/Layers";

function fmtUsd(v: number | null): string {
  if (v == null) return "A definir";
  return `USD ${v.toFixed(2)}`;
}

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" });
}

export function LaminadosForm() {
  const [pricelist, setPricelist] = useState<LaminadosPricelistResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchPricelist = async () => {
    try {
      setIsLoading(true);
      const pl = await api.laminados.getPricelist();
      setPricelist(pl);
    } catch (err: any) {
      toast.error(err?.message || "Error al cargar la lista de precios");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchPricelist();
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast.error("El archivo debe ser .xlsx");
      e.target.value = "";
      return;
    }
    try {
      setIsUploading(true);
      const updated = await api.laminados.uploadPricelist(file);
      setPricelist(updated);
      toast.success(
        `Lista actualizada: ${updated.products.length} productos, ${updated.discountTiers.length} tramos`,
      );
    } catch (err: any) {
      toast.error(err?.message || "No se pudo procesar el Excel");
    } finally {
      setIsUploading(false);
      e.target.value = "";
    }
  };

  const handleReset = async () => {
    try {
      setIsResetting(true);
      const updated = await api.laminados.reset();
      setPricelist(updated);
      toast.success("Lista restablecida a los valores por defecto");
      setResetOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "No se pudo restablecer");
    } finally {
      setIsResetting(false);
    }
  };

  if (isLoading || !pricelist) {
    return (
      <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="mb-5 flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* HEADER + UPLOAD CARD */}
      <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(14_165_233/0.45)]">
            <LayersIcon sx={{ fontSize: 22 }} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">Laminados PRFV</h2>
            <p className="text-xs text-slate-500">
              Subí el Excel del cotizador y se sincronizan precios, descuentos y pegamento.
              El agente arranca a cotizar con los valores nuevos al instante.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Productos cargados</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{pricelist.products.length}</div>
          </div>
          <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Tramos de descuento</div>
            <div className="mt-1 text-xl font-semibold text-slate-900">{pricelist.discountTiers.length}</div>
          </div>
          <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-3">
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">IVA / Tipo de cambio fallback</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {(pricelist.iva * 100).toFixed(0)}% · {pricelist.fallbackArsPorUsd.toLocaleString("es-AR")} ARS/USD
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span>
            <span className="font-medium text-slate-700">Última actualización:</span> {fmtDate(pricelist.updatedAt)}
          </span>
          {pricelist.updatedBy && (
            <span>
              <span className="font-medium text-slate-700">por</span> {pricelist.updatedBy}
            </span>
          )}
          {!pricelist.updatedAt && (
            <span className="text-amber-700">
              (usando valores por defecto — todavía no subiste ningún Excel)
            </span>
          )}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFileChange}
            className="hidden"
            data-testid="laminados-file-input"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            data-testid="laminados-upload-button"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(14_165_233/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(14_165_233/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
          >
            {isUploading ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Subiendo…
              </>
            ) : (
              <>
                <UploadFileIcon sx={{ fontSize: 16 }} />
                Subir Excel del cotizador
              </>
            )}
          </button>
          <button
            type="button"
            onClick={fetchPricelist}
            disabled={isLoading}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] disabled:opacity-60"
          >
            <RefreshIcon sx={{ fontSize: 16 }} className="text-blue-600" />
            Recargar
          </button>
          <button
            type="button"
            onClick={() => setResetOpen(true)}
            disabled={isResetting}
            data-testid="laminados-reset-button"
            className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 text-sm font-medium text-amber-800 transition-all duration-200 hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RestartAltIcon sx={{ fontSize: 16 }} className="text-amber-700" />
            Restablecer
          </button>
        </div>
      </div>

      {/* PRODUCTS TABLE */}
      <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-400 text-white">
            <StraightenIcon sx={{ fontSize: 18 }} />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Productos y precios</h3>
            <p className="text-[11px] text-slate-500">Lo que el agente usa para cotizar.</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="laminados-products-table">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3 font-medium">Clave</th>
                <th className="py-2 pr-3 font-medium">Ancho</th>
                <th className="py-2 pr-3 font-medium">Espesor</th>
                <th className="py-2 pr-3 font-medium">Tipo</th>
                <th className="py-2 pr-3 text-right font-medium">USD / metro lineal</th>
              </tr>
            </thead>
            <tbody>
              {pricelist.products.map((p) => (
                <tr key={p.key} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3 font-mono text-[12px] text-slate-700">{p.key}</td>
                  <td className="py-2 pr-3 text-slate-700">{p.ancho.toFixed(2)} m</td>
                  <td className="py-2 pr-3 text-slate-700">{p.espesor}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={
                        p.tipo === "Liso"
                          ? "inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700"
                          : "inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700"
                      }
                    >
                      {p.tipo}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-[12px]">
                    <span className={p.usdPorMetroLineal == null ? "text-amber-600" : "text-slate-900"}>
                      {fmtUsd(p.usdPorMetroLineal)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* DISCOUNT TIERS + PEGAMENTO */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-rose-500 to-pink-400 text-white">
              <PercentIcon sx={{ fontSize: 18 }} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Tramos de descuento</h3>
              <p className="text-[11px] text-slate-500">Por m² totales del pedido.</p>
            </div>
          </div>
          <table className="w-full text-sm" data-testid="laminados-tiers-table">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3 font-medium">Tramo</th>
                <th className="py-2 pr-3 font-medium">M² desde</th>
                <th className="py-2 pr-3 text-right font-medium">Descuento</th>
              </tr>
            </thead>
            <tbody>
              {pricelist.discountTiers.map((t) => (
                <tr key={t.tier} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3 text-slate-700">{t.tier}</td>
                  <td className="py-2 pr-3 font-mono text-[12px] text-slate-700">{t.m2Min}</td>
                  <td className="py-2 pr-3 text-right font-mono text-[12px] text-slate-900">
                    {(t.pct * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-400 text-white">
              <LayersIcon sx={{ fontSize: 18 }} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Pegamento PRFV</h3>
              <p className="text-[11px] text-slate-500">
                Rendimiento: {pricelist.pegamentoM2PerKg.toFixed(2)} m² por kg.
              </p>
            </div>
          </div>
          <table className="w-full text-sm" data-testid="laminados-pegamento-table">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3 font-medium">Presentación</th>
                <th className="py-2 pr-3 text-right font-medium">Rinde</th>
              </tr>
            </thead>
            <tbody>
              {pricelist.pegamentoPresentaciones.map((p) => (
                <tr key={p.kg} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-3 font-mono text-[12px] text-slate-700">{p.kg} kg</td>
                  <td className="py-2 pr-3 text-right font-mono text-[12px] text-slate-900">
                    {p.rindeM2.toFixed(1)} m²
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Restablecer la lista de precios?</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a descartar la lista actual y volver a los valores que vienen por defecto.
              Si no tenés a mano el Excel actualizado, copialo a un lado antes de continuar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResetting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReset}
              disabled={isResetting}
              data-testid="laminados-reset-confirm"
            >
              {isResetting ? "Restableciendo…" : "Restablecer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
