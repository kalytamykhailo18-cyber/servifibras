"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, type MayoristaConfigResponse, type MayoristaProbeResult } from "@/lib/api/endpoints";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import SaveIcon from "@mui/icons-material/Save";
import BoltIcon from "@mui/icons-material/Bolt";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HighlightOffIcon from "@mui/icons-material/HighlightOff";

export function LeadDetectionForm() {
  const [config, setConfig] = useState<MayoristaConfigResponse | null>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [threshold, setThreshold] = useState<number>(50);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [probeText, setProbeText] = useState("");
  const [probeResult, setProbeResult] = useState<MayoristaProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const probeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const cfg = await api.leadDetection.getMayorista();
      setConfig(cfg);
      setKeywords(cfg.keywords);
      setThreshold(cfg.volumeThresholdLitres);
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo cargar la configuración");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Debounced auto-probe so the operator sees the result update as they type.
  useEffect(() => {
    if (!probeText.trim()) {
      setProbeResult(null);
      return;
    }
    if (probeTimer.current) clearTimeout(probeTimer.current);
    probeTimer.current = setTimeout(async () => {
      setProbing(true);
      try {
        const r = await api.leadDetection.probeMayorista(probeText);
        setProbeResult(r);
      } catch (err: any) {
        toast.error(err?.message ?? "Error en la prueba");
      } finally {
        setProbing(false);
      }
    }, 500);
    return () => {
      if (probeTimer.current) clearTimeout(probeTimer.current);
    };
  }, [probeText]);

  function addKeyword() {
    const k = draft.trim().toLowerCase();
    if (!k) return;
    if (keywords.includes(k)) {
      toast.message("Esa palabra ya está en la lista");
      return;
    }
    setKeywords([...keywords, k]);
    setDraft("");
  }

  function removeKeyword(k: string) {
    setKeywords(keywords.filter((x) => x !== k));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.leadDetection.saveMayorista({
        keywords,
        volumeThresholdLitres: threshold,
      });
      toast.success("Configuración guardada");
      await refresh();
      // Re-run any pending probe so the operator sees the new state.
      if (probeText.trim()) {
        const r = await api.leadDetection.probeMayorista(probeText);
        setProbeResult(r);
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleResetDefaults() {
    if (!config) return;
    setKeywords(config.defaults.keywords);
    setThreshold(config.defaults.volumeThresholdLitres);
  }

  const dirty = useMemo(() => {
    if (!config) return false;
    if (config.volumeThresholdLitres !== threshold) return true;
    if (config.keywords.length !== keywords.length) return true;
    return config.keywords.some((k, i) => k !== keywords[i]);
  }, [config, keywords, threshold]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-6 text-sm text-slate-500">
        Cargando configuración…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Detección de mayoristas
            </h3>
            <p className="mt-0.5 text-sm text-slate-500">
              Palabras clave y umbral de volumen que disparan el ruteo automático del lead a Ventas. Los cambios entran en efecto en el momento — no requiere reinicio del backend.
            </p>
            {config?.source === "env-default" && (
              <p className="mt-2 text-xs text-amber-700">
                Usando los valores por defecto. Al guardar quedan persistidos en la base de datos.
              </p>
            )}
          </div>
          <button
            type="button"
            data-testid="lead-detection-reset"
            onClick={handleResetDefaults}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-xs font-medium text-slate-700 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"
          >
            <RestartAltIcon sx={{ fontSize: 16 }} className="text-amber-600" />
            Restaurar defaults
          </button>
        </div>

        {/* Threshold */}
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Umbral de volumen (litros equivalentes)</span>
            <input
              type="number"
              min="1"
              data-testid="lead-detection-threshold"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value) || 0)}
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-500/15"
            />
            <span className="mt-1 block text-[11px] text-slate-500">
              Una consulta con cantidad ≥ este valor (en L, kg, t convertidos a L) dispara el ruteo a Ventas.
            </span>
          </label>
        </div>

        {/* Keywords */}
        <div className="mb-2">
          <span className="text-xs font-medium text-slate-600">Palabras clave</span>
          <div data-testid="lead-detection-keywords" className="mt-2 flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50/40 p-3 min-h-12">
            {keywords.length === 0 ? (
              <span className="text-xs text-slate-500">Sin palabras configuradas — al guardar se aplicarán los defaults.</span>
            ) : (
              keywords.map((k) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 pl-3 pr-1 py-1 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-200"
                >
                  {k}
                  <button
                    type="button"
                    data-testid={`lead-detection-keyword-remove-${k}`}
                    onClick={() => removeKeyword(k)}
                    aria-label={`Quitar ${k}`}
                    className="grid h-5 w-5 place-items-center rounded-full text-violet-500 hover:bg-violet-100 hover:text-violet-800"
                  >
                    <CloseIcon sx={{ fontSize: 14 }} />
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              placeholder='Agregar palabra clave (ej. "compra grande")'
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addKeyword();
                }
              }}
              data-testid="lead-detection-keyword-input"
              className="h-10 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-500/15"
            />
            <button
              type="button"
              data-testid="lead-detection-keyword-add"
              onClick={addKeyword}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-violet-300 bg-violet-50 px-4 text-sm font-medium text-violet-700 hover:bg-violet-100"
            >
              <AddIcon sx={{ fontSize: 16 }} />
              Agregar
            </button>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="lead-detection-save"
            disabled={!dirty || saving}
            onClick={handleSave}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-60"
          >
            <SaveIcon sx={{ fontSize: 16 }} className="text-emerald-600 disabled:text-slate-400" />
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      {/* Live tester */}
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <h3 className="text-base font-semibold text-slate-900">Probar texto contra la configuración actual</h3>
        <p className="mt-0.5 text-sm text-slate-500">
          Escribí un mensaje de cliente como ejemplo. Se evalúa contra la configuración guardada (no la edición sin guardar) y muestra si dispararía el ruteo a Ventas y por qué.
        </p>
        <textarea
          rows={3}
          value={probeText}
          onChange={(e) => setProbeText(e.target.value)}
          placeholder='Ej: "Hola, necesito 200 litros para mi industria, soy distribuidor"'
          data-testid="lead-detection-probe-input"
          className="mt-3 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-400/15"
        />
        {probing && (
          <p className="mt-2 text-xs text-slate-500">
            <BoltIcon sx={{ fontSize: 14 }} className="mr-1 animate-pulse text-amber-500 align-middle" />
            Evaluando…
          </p>
        )}
        {!probing && probeResult && (
          <div
            data-testid="lead-detection-probe-result"
            className={`mt-3 rounded-xl border px-4 py-3 text-sm ${
              probeResult.isMayorista
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-slate-200 bg-slate-50 text-slate-700"
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              {probeResult.isMayorista ? (
                <>
                  <CheckCircleIcon sx={{ fontSize: 18 }} className="text-emerald-600" />
                  Sería detectado como mayorista — confianza {(probeResult.confidence * 100).toFixed(0)}%
                </>
              ) : (
                <>
                  <HighlightOffIcon sx={{ fontSize: 18 }} className="text-slate-500" />
                  No dispararía ruteo a Ventas
                </>
              )}
            </div>
            {probeResult.signals.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {probeResult.signals.map((s) => (
                  <span
                    key={s}
                    className="inline-flex rounded-md bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700 ring-1 ring-inset ring-slate-200"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
