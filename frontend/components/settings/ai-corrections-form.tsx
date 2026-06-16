"use client";

// Configuración → IA → "Correcciones del agente".
//
// Operator-feedback loop. When Marcos sees a bad reply in real traffic,
// instead of pinging Ustym to add another prompt rule, he pastes the
// customer scenario + the ideal reply here. The backend stores it in
// ConversationExample; the next outgoing reply picks it up via
// ConversationStyleService and uses it as a few-shot pattern. No code
// changes, no restart, no AnyDesk.
//
// Design choice: we don't store the "bad" reply because few-shots train
// by positive example. Showing the model a "this is bad — don't do this"
// pattern often makes it MORE likely to imitate the bad shape (the model
// pattern-matches without internalising the negation).

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api/endpoints";
import { safeFormatDate } from "@/lib/date";
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
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import AddIcon from "@mui/icons-material/Add";

interface Correction {
  id: string;
  scenario: string;
  title: string | null;
  priority: number;
  turns: Array<{ role: "user" | "assistant"; content: string }>;
  createdAt: string;
}

export function AICorrectionsForm() {
  const [items, setItems] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [customerContext, setCustomerContext] = useState("");
  const [goodReply, setGoodReply] = useState("");
  const [scenario, setScenario] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toDelete, setToDelete] = useState<Correction | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.config.listAiCorrections();
      setItems(rows);
    } catch (err: any) {
      toast.error(err?.message || "No se pudieron cargar las correcciones");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (customerContext.trim().length < 5) {
      toast.error("Pegá el mensaje del cliente que disparó la respuesta mala");
      return;
    }
    if (goodReply.trim().length < 5) {
      toast.error("Escribí cómo debería haber respondido el agente");
      return;
    }
    setSubmitting(true);
    try {
      await api.config.addAiCorrection({
        customerContext: customerContext.trim(),
        goodReply: goodReply.trim(),
        scenario: scenario.trim() || undefined,
      });
      toast.success("Corrección guardada — el agente la usa desde la próxima respuesta");
      setCustomerContext("");
      setGoodReply("");
      setScenario("");
      await refresh();
    } catch (err: any) {
      toast.error(err?.message || "No se pudo guardar la corrección");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await api.config.deleteAiCorrection(toDelete.id);
      toast.success("Corrección eliminada");
      setToDelete(null);
      await refresh();
    } catch (err: any) {
      toast.error(err?.message || "No se pudo eliminar");
    }
  };

  return (
    <div className="rounded-2xl border border-violet-200/70 bg-gradient-to-br from-white to-violet-50/30 p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_4px_12px_-2px_rgb(139_92_246/0.45)]">
          <AutoFixHighIcon sx={{ fontSize: 18 }} />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-slate-900">Correcciones del agente</h3>
          <p className="text-xs text-slate-500">
            Cuando veas una respuesta mala en una conversación, pegá acá lo que dijo el cliente y cómo debería haber respondido. Desde la próxima respuesta el agente lo usa como ejemplo — sin recargas ni cambios de código.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3" data-testid="ai-correction-form">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Mensaje del cliente (contexto)
          </label>
          <textarea
            value={customerContext}
            onChange={(e) => setCustomerContext(e.target.value)}
            placeholder="ej. 'estoy necesitando resina para una mesa de 1m² superficial'"
            disabled={submitting}
            rows={2}
            data-testid="ai-correction-context"
            className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Cómo debería haber respondido (texto exacto)
          </label>
          <textarea
            value={goodReply}
            onChange={(e) => setGoodReply(e.target.value)}
            placeholder="ej. 'Para 1 m² de recubrimiento superficial necesitás 1-2 kg de Resina Epoxi Cristal. Kit de 1 kg — $12.500: link. Para cubrir 1 m² tomá 2 unidades.'"
            disabled={submitting}
            rows={5}
            data-testid="ai-correction-good"
            className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Etiqueta de escenario (opcional)
            </label>
            <input
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              placeholder="ej. mesa-rio o piso-taller"
              disabled={submitting}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            data-testid="ai-correction-submit"
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-gradient-to-br from-violet-600 to-purple-600 px-4 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(139_92_246/0.5)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-6px_rgb(139_92_246/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:opacity-70 disabled:hover:translate-y-0"
          >
            <AddIcon sx={{ fontSize: 16 }} />
            {submitting ? "Guardando…" : "Agregar corrección"}
          </button>
        </div>
      </form>

      <div className="mt-6 border-t border-slate-200/70 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Correcciones activas ({items.length})
          </h4>
        </div>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
            Sin correcciones todavía. Cuando agregues una, va a aparecer acá.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="ai-correction-list">
            {items.map((it) => {
              const customerTurn = it.turns.find((t) => t.role === "user")?.content ?? "";
              const agentTurn = it.turns.find((t) => t.role === "assistant")?.content ?? "";
              return (
                <li
                  key={it.id}
                  className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-medium text-violet-700">
                      {it.scenario}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400">{safeFormatDate(it.createdAt, "d MMM yyyy")}</span>
                      <button
                        type="button"
                        onClick={() => setToDelete(it)}
                        aria-label="Eliminar corrección"
                        className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                      >
                        <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                      </button>
                    </div>
                  </div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Cliente</p>
                  <p className="mb-2 text-sm text-slate-700">{customerTurn}</p>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Respuesta correcta</p>
                  <p className="text-sm text-slate-700 whitespace-pre-line">{agentTurn}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar corrección</AlertDialogTitle>
            <AlertDialogDescription>
              El agente deja de usar este ejemplo desde la próxima respuesta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
