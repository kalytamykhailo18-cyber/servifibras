"use client";

/**
 * Marcos 2026-06-12: he asked whether the product-list import lives in
 * Configuración. The actual button is on /products (Catálogo) where
 * the catalog itself lives, but mirroring the action here means he
 * finds it where his mental model expects. Same backend endpoint as
 * the Catálogo button — `api.products.importCsv` accepts both .csv
 * and the CRM's .xlsx export.
 */

import { useRef, useState } from "react";
import { api } from "@/lib/api/endpoints";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { toast } from "sonner";

export function CatalogoImportCard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [lastResult, setLastResult] = useState<null | { created: number; updated: number; skipped: number }>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const result = await api.products.importCsv(file);
      setLastResult({ created: result.created, updated: result.updated, skipped: result.skipped });
      toast.success(`Importado: ${result.created} nuevos · ${result.updated} actualizados`, {
        description: result.skipped > 0 ? `${result.skipped} filas saltadas` : undefined,
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? "Error al importar planilla");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      data-testid="settings-catalog-import-card"
      className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(245_158_11/0.45)]">
          <UploadFileIcon sx={{ fontSize: 22 }} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-900">Importar catálogo desde Excel o CSV</h3>
          <p className="mt-1 text-sm text-slate-500">
            Subí la planilla del CRM (sheet "precios") y los productos del Catálogo se actualizan automáticamente. Se respetan los códigos internos para evitar duplicar filas; las nuevas se crean y las existentes se actualizan con precio + stock + categoría.
          </p>
          {lastResult && (
            <p className="mt-2 text-xs text-slate-600" data-testid="settings-catalog-import-result">
              Última importación: {lastResult.created} nuevos · {lastResult.updated} actualizados · {lastResult.skipped} saltados.
            </p>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={onPick}
          className="hidden"
          data-testid="settings-catalog-import-input"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          data-testid="settings-catalog-import-button"
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-500 px-4 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(245_158_11/0.45)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-6px_rgb(245_158_11/0.6)] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
        >
          <UploadFileIcon sx={{ fontSize: 16 }} />
          {importing ? "Importando…" : "Subir planilla"}
        </button>
      </div>
    </div>
  );
}
