"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api/endpoints";
import { toast } from "sonner";
import CloseIcon from "@mui/icons-material/Close";
import MenuBookIcon from "@mui/icons-material/MenuBookOutlined";

interface PublicationFaqDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  publicationTitle: string | null;
  seedQuestion: string;
}

/**
 * Bloque E item 3 — "Crear FAQ desde Q&A" dialog. Operator clicks
 * from a row on the ML Q&A panel: dialog opens with the buyer's
 * question pre-filled, keyword suggestions fetched from the backend,
 * and a textarea for the canned answer. Saving wires a PublicationFaq
 * so the next identical question on this item skips Claude entirely.
 */
export function PublicationFaqDialog({
  open,
  onOpenChange,
  itemId,
  publicationTitle,
  seedQuestion,
}: PublicationFaqDialogProps) {
  const [keywordsInput, setKeywordsInput] = useState("");
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAnswer("");
    setKeywordsInput("");
    // Best-effort keyword suggestion. If the call fails we just open
    // empty — the operator types from scratch.
    void (async () => {
      try {
        const suggested = await api.publicationFaqs.suggestKeywords(seedQuestion);
        setKeywordsInput(suggested.join(" "));
      } catch {
        /* non-fatal */
      }
    })();
  }, [open, seedQuestion]);

  const onSave = async () => {
    const keywords = keywordsInput.split(/[\s,;]+/).filter((k) => k.length >= 2);
    if (keywords.length === 0) {
      toast.error("Necesitás al menos una palabra clave");
      return;
    }
    if (!answer.trim()) {
      toast.error("Falta la respuesta predefinida");
      return;
    }
    setSaving(true);
    try {
      await api.publicationFaqs.create({
        itemId,
        keywords,
        answer: answer.trim(),
        active: true,
      });
      toast.success("FAQ guardada — la próxima pregunta similar se responde sin Claude");
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "No se pudo guardar la FAQ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150 sm:max-w-[600px]"
        data-testid="publication-faq-dialog"
      >
        <DialogHeader className="flex flex-row items-center gap-3 space-y-0">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100">
            <MenuBookIcon sx={{ fontSize: 20 }} className="text-amber-700" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-xl font-bold tracking-tight text-slate-900">
              Crear FAQ de publicación
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              {publicationTitle ? `${publicationTitle} · #${itemId}` : `#${itemId}`}
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Cerrar"
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </button>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Pregunta del comprador
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-800">{seedQuestion}</p>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700">
              Palabras clave (separadas por espacios)
            </label>
            <input
              type="text"
              value={keywordsInput}
              onChange={(e) => setKeywordsInput(e.target.value)}
              data-testid="publication-faq-keywords"
              placeholder="piscina cloro"
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              La FAQ dispara cuando TODAS las palabras clave aparecen en la pregunta del comprador.
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700">
              Respuesta predefinida
            </label>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              data-testid="publication-faq-answer"
              rows={5}
              placeholder="Escribí la respuesta que el agente va a enviar automáticamente."
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving}
              data-testid="publication-faq-save"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.18)] hover:bg-amber-700 disabled:opacity-60"
            >
              {saving ? "Guardando…" : "Guardar FAQ"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
