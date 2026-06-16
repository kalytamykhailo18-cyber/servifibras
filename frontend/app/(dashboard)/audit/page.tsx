"use client";

// Admin-only audit log viewer. Surfaces the append-only access_logs
// table — same data Marcos would otherwise need SQL access to inspect.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, type AuditEvent } from "@/lib/api/endpoints";
import { UserRole } from "@/types";
import { useRoleGuard } from "@/lib/hooks/use-role-guard";
import { useClientPagination } from "@/lib/hooks/use-client-pagination";
import { Pagination } from "@/components/ui/pagination";
import HistoryIcon from "@mui/icons-material/History";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";

const ROLES = [UserRole.ADMIN];

export default function AuditPage() {
  const { isAllowed } = useRoleGuard(ROLES);
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [actionFilter, setActionFilter] = useState<string>("");
  const [textFilter, setTextFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      setLoading(true);
      const [list, acts] = await Promise.all([
        api.audit.list({ actionPrefix: actionFilter || undefined, limit: 200 }),
        api.audit.actions(),
      ]);
      setItems(list);
      setActions(acts);
    } catch (err: any) {
      toast.error(err?.message ?? "Error cargando log");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isAllowed) refresh(); }, [isAllowed, actionFilter]);

  // Client-side text filter on top of the server-side prefix filter so
  // the operator can drill in without a round-trip per keystroke.
  const filtered = useMemo(() => {
    const q = textFilter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) =>
      i.action.toLowerCase().includes(q) ||
      (i.userEmail ?? '').toLowerCase().includes(q) ||
      (i.userName  ?? '').toLowerCase().includes(q) ||
      (i.ip ?? '').toLowerCase().includes(q),
    );
  }, [items, textFilter]);

  const pg = useClientPagination(filtered, { storageKey: "audit", defaultPageSize: 50 });

  if (!isAllowed) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-slate-700 to-slate-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(100_116_139/0.45)] sm:h-11 sm:w-11">
            <HistoryIcon sx={{ fontSize: 20 }} className="sm:[font-size:22px]" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-3xl text-slate-900">Auditoría</h1>
            <p className="hidden text-sm text-muted-foreground sm:block">Eventos privilegiados y accesos. Solo lectura.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          aria-label="Refrescar"
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 sm:px-4"
        >
          <RefreshIcon sx={{ fontSize: 16 }} className="text-blue-600" />
          <span className="hidden sm:inline">Refrescar</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2 relative">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por acción, usuario o IP..."
            value={textFilter}
            onChange={(e) => setTextFilter(e.target.value)}
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none focus:border-slate-500 focus:ring-4 focus:ring-slate-500/15"
          />
        </div>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-500 focus:ring-4 focus:ring-slate-500/15"
        >
          <option value="">Todas las acciones (últimos 30 días)</option>
          {actions.map((a) => (
            <option key={a} value={a.split(".").slice(0, 2).join(".")}>{a}</option>
          ))}
        </select>
      </div>

      <section className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        {loading ? (
          <p className="p-5 text-sm text-slate-500">Cargando…</p>
        ) : filtered.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">Sin eventos.</p>
        ) : (
          <>
          <div className="px-3 pt-3">
            <Pagination
              position="top"
              page={pg.page}
              totalPages={pg.totalPages}
              totalItems={pg.totalItems}
              pageSize={pg.pageSize}
              onPageChange={pg.setPage}
              onPageSizeChange={pg.setPageSize}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200/70 bg-slate-50/70 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Fecha</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Acción</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Usuario</th>
                  <th className="px-4 py-2.5 text-left font-semibold">IP</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Detalles</th>
                </tr>
              </thead>
              <tbody>
                {pg.slice.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                    <td className="px-4 py-2 align-top text-[12px] tabular-nums text-slate-600">
                      {new Date(row.createdAt).toLocaleString("es-AR")}
                    </td>
                    <td className="px-4 py-2 align-top">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">
                        {row.action}
                      </code>
                    </td>
                    <td className="px-4 py-2 align-top text-xs">
                      {row.userName ?? row.userEmail ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2 align-top text-xs text-slate-600">
                      {row.ip ?? <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2 align-top">
                      {row.metadata && Object.keys(row.metadata).length > 0 ? (
                        <code className="block max-w-md truncate rounded bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                          {JSON.stringify(row.metadata)}
                        </code>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 pb-3 mt-3">
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
    </div>
  );
}
