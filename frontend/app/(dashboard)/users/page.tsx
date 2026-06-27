"use client";

// Admin-only user management. Lets Marcos add/remove employees without
// SQL access. Soft-delete (active=false) is the primary delete path so
// historical references on conversations/leads stay intact.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api/endpoints";
import { useAuthStore } from "@/lib/store/auth-store";
import { UserRole } from "@/types";
import { useRoleGuard } from "@/lib/hooks/use-role-guard";
import { useClientPagination } from "@/lib/hooks/use-client-pagination";
import { Pagination } from "@/components/ui/pagination";
import GroupIcon from "@mui/icons-material/Group";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HighlightOffIcon from "@mui/icons-material/HighlightOff";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import LoginIcon from "@mui/icons-material/Login";
import RestoreIcon from "@mui/icons-material/Restore";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ROLES = [UserRole.ADMIN];
const ROLE_OPTIONS: UserRole[] = [
  UserRole.ADMIN, UserRole.VENTAS, UserRole.ATENCION, UserRole.LOGISTICA, UserRole.ENCARGADO,
];

const ROLE_LABEL: Record<string, string> = {
  ADMIN:     "Administrador",
  VENTAS:    "Ventas",
  ATENCION:  "Atención",
  LOGISTICA: "Logística",
  ENCARGADO: "Encargado",
};

interface UserRow {
  id: string; email: string; username: string; name: string;
  role: string; active: boolean;
  createdAt: string; updatedAt: string;
}
interface FormState {
  id: string | null;
  email: string; username: string; name: string;
  role: string; password: string;
  /** Marcos 2026-06-10 + 2026-06-22 prod incidents: el input de
   *  contraseña estaba siendo autofilleado por el browser con la
   *  contraseña guardada del propio admin al abrir el form de edit;
   *  el password autofilleado entraba al payload y terminaba hasheado
   *  sobre el row del target user, dejando 6 cuentas sin poder
   *  loguear (Aldo, Admin, Marcos, Matias, Franco, Brenda — todas
   *  editadas el mismo día). El guard original (passwordTouched
   *  bumpeado en onChange + autoComplete="new-password") no alcanzó
   *  porque algunos browsers (Chrome, Edge) disparan onChange en el
   *  autofill — passwordTouched terminaba en true sin que el admin
   *  haya tipeado nada. Marcos 2026-06-27 (post-incidente): en edit
   *  ocultamos el input por default y solo lo mostramos cuando el
   *  admin toggle el checkbox `wantsPasswordChange`. Un autofill no
   *  puede togglear un checkbox, así que el campo no llega al DOM
   *  ni al payload a menos que el admin lo pida explícitamente. */
  passwordTouched: boolean;
  wantsPasswordChange: boolean;
}
const EMPTY: FormState = { id: null, email: '', username: '', name: '', role: 'VENTAS', password: '', passwordTouched: false, wantsPasswordChange: false };

export default function UsersPage() {
  const { isAllowed } = useRoleGuard(ROLES);
  const me = useAuthStore((s) => s.user);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const [togglingActive, setTogglingActive] = useState<UserRow | null>(null);
  const pg = useClientPagination(users, { storageKey: "users", defaultPageSize: 25 });

  const refresh = async () => {
    try {
      setLoading(true);
      const list = await api.users.list({ activeOnly: !showInactive });
      setUsers(list as any);
    } catch (err: any) {
      toast.error(err?.message ?? 'Error cargando usuarios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isAllowed) refresh(); }, [isAllowed, showInactive]);

  const startEdit = (u: UserRow) => {
    setForm({
      id: u.id, email: u.email, username: u.username, name: u.name,
      role: u.role, password: '', passwordTouched: false, wantsPasswordChange: false,
    });
    setFormOpen(true);
  };
  const startCreate = () => {
    setForm(EMPTY);
    setFormOpen(true);
  };
  const cancelEdit = () => { setFormOpen(false); setForm(EMPTY); };

  const submit = async () => {
    if (!form.name.trim()) { toast.error('Falta el nombre'); return; }
    if (!form.email.trim()) { toast.error('Falta el email'); return; }
    if (!form.username.trim()) { toast.error('Falta el usuario'); return; }
    if (!form.id && form.password.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    setSaving(true);
    try {
      if (form.id) {
        const payload: any = {
          email: form.email, username: form.username, name: form.name, role: form.role,
        };
        // Marcos 2026-06-27 (post-incidente del 06-22): el guard
        // ahora es triple — wantsPasswordChange (checkbox que el
        // admin tiene que togglear explícito, autofill no puede
        // disparar) + passwordTouched (onChange real) + length
        // check. Sin wantsPasswordChange=true el password ni siquiera
        // llega al DOM, así que browser autofill no tiene field
        // donde inyectarse.
        if (form.wantsPasswordChange && form.passwordTouched && form.password.length >= 6) {
          payload.password = form.password;
        } else if (form.wantsPasswordChange && form.passwordTouched && form.password.length > 0 && form.password.length < 6) {
          toast.error('La contraseña debe tener al menos 6 caracteres');
          setSaving(false);
          return;
        }
        await api.users.update(form.id, payload);
        toast.success('Usuario actualizado');
      } else {
        await api.users.create({
          email: form.email, username: form.username, name: form.name,
          role: form.role, password: form.password,
        });
        toast.success('Usuario creado');
      }
      setForm(EMPTY);
      setFormOpen(false);
      void refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = (u: UserRow) => {
    if (u.id === me?.id && u.active) {
      toast.error('No podés desactivar tu propia cuenta');
      return;
    }
    // Always confirm — both directions matter. Deactivating accidentally
    // kicks an employee out of the system; reactivating accidentally puts an
    // ex-employee back in. Same impact, same modal.
    setTogglingActive(u);
  };
  const confirmToggleActive = async () => {
    if (!togglingActive) return;
    const u = togglingActive;
    setTogglingActive(null);
    try {
      await api.users.update(u.id, { active: !u.active });
      toast.success(u.active ? 'Usuario desactivado' : 'Usuario reactivado');
      void refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? 'Error');
    }
  };

  const remove = (u: UserRow) => {
    if (u.id === me?.id) {
      toast.error('No podés eliminar tu propia cuenta');
      return;
    }
    setDeleting(u);
  };
  const confirmRemove = async () => {
    if (!deleting) return;
    try {
      const r = await api.users.delete(deleting.id);
      if (r.ok) {
        toast.success('Usuario eliminado');
        void refresh();
      } else {
        toast.message('No se puede eliminar', {
          description: r.reason ?? 'El usuario tiene referencias históricas. Usá "Desactivar" en su lugar.',
        });
      }
    } catch (err: any) {
      toast.error(err?.message ?? 'Error al eliminar');
    } finally {
      setDeleting(null);
    }
  };

  if (!isAllowed) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(99_102_241/0.45)] sm:h-11 sm:w-11">
            <GroupIcon sx={{ fontSize: 20 }} className="sm:[font-size:22px]" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-3xl text-slate-900">Usuarios</h1>
            <p className="hidden text-sm text-muted-foreground sm:block">Operadores con acceso al panel.</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="hidden sm:inline">Mostrar inactivos</span>
            <span className="sm:hidden">Inactivos</span>
          </label>
          <button
            type="button"
            onClick={refresh}
            aria-label="Refrescar"
            className="inline-flex h-9 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
          >
            <RefreshIcon sx={{ fontSize: 14 }} className="text-blue-600" />
            <span className="hidden sm:inline">Refrescar</span>
          </button>
          <button
            type="button"
            onClick={startCreate}
            aria-label="Nuevo usuario"
            className="inline-flex h-9 items-center gap-1 rounded-full bg-gradient-to-r from-indigo-600 to-violet-500 px-3 text-xs font-medium text-white shadow-[0_8px_20px_-6px_rgb(99_102_241/0.5)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-6px_rgb(99_102_241/0.6)] active:translate-y-0 active:scale-[0.97]"
          >
            <AddIcon sx={{ fontSize: 14 }} />
            <span className="hidden sm:inline">Nuevo usuario</span>
            <span className="sm:hidden">Nuevo</span>
          </button>
        </div>
      </div>

      <section className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
          {loading ? (
            <p className="text-sm text-slate-500">Cargando…</p>
          ) : users.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              Sin usuarios.
            </p>
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
              {pg.slice.map((u) => {
                const editing = form.id === u.id;
                return (
                <li
                  key={u.id}
                  className={
                    "relative flex min-w-0 items-center gap-2 py-3 px-2 rounded-xl transition-colors sm:gap-3 sm:px-3 sm:-mx-3 " +
                    (editing
                      ? "bg-indigo-50/70 ring-2 ring-indigo-300 shadow-[0_4px_12px_-6px_rgb(99_102_241/0.35)]"
                      : "")
                  }
                >
                  {editing && (
                    <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-gradient-to-b from-indigo-500 to-violet-500" aria-hidden />
                  )}
                  <span className={
                    "grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white " +
                    (u.active
                      ? "bg-gradient-to-br from-indigo-500 to-violet-500"
                      : "bg-gradient-to-br from-slate-400 to-slate-500 opacity-70")
                  }>
                    {u.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">{u.name}</span>
                      <span className="text-[11px] text-slate-500">{u.email}</span>
                      {editing && (
                        <span className="inline-flex items-center rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          editando
                        </span>
                      )}
                      {!u.active && (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          inactivo
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      @{u.username} · {ROLE_LABEL[u.role] ?? u.role}
                    </div>
                  </div>
                  <span className={u.active ? "text-emerald-600" : "text-slate-400"}>
                    {u.active
                      ? <CheckCircleIcon sx={{ fontSize: 16 }} />
                      : <HighlightOffIcon sx={{ fontSize: 16 }} />}
                  </span>
                  <button
                    type="button"
                    onClick={() => startEdit(u)}
                    aria-label="Editar"
                    aria-pressed={editing}
                    className={
                      "grid h-8 w-8 place-items-center rounded-lg " +
                      (editing
                        ? "bg-indigo-600 text-white shadow-[0_4px_10px_-4px_rgb(99_102_241/0.6)]"
                        : "text-blue-600 hover:bg-blue-50 hover:text-blue-700")
                    }
                  >
                    <EditIcon sx={{ fontSize: 16 }} />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleActive(u)}
                    aria-label={u.active ? 'Desactivar' : 'Reactivar'}
                    className={
                      "grid h-8 w-8 place-items-center rounded-lg " +
                      (u.active
                        ? "text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                        : "text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700")
                    }
                  >
                    {u.active
                      ? <PowerSettingsNewIcon sx={{ fontSize: 16 }} />
                      : <LoginIcon sx={{ fontSize: 16 }} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(u)}
                    aria-label="Eliminar"
                    className="grid h-8 w-8 place-items-center rounded-lg text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                  </button>
                </li>
                );
              })}
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

        {/* CREATE/EDIT MODAL */}
        <Dialog
          open={formOpen}
          onOpenChange={(open) => {
            if (!open) cancelEdit();
            else setFormOpen(true);
          }}
        >
          <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200/70 bg-white/95 p-4 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150 sm:max-w-[520px] sm:p-6">
            <DialogHeader className="flex flex-row items-center gap-3 space-y-0">
              <span
                className={
                  "grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(99_102_241/0.45)] sm:h-11 sm:w-11 " +
                  (form.id
                    ? "bg-gradient-to-br from-indigo-500 to-violet-500"
                    : "bg-gradient-to-br from-emerald-500 to-teal-400")
                }
              >
                {form.id
                  ? <EditIcon sx={{ fontSize: 20 }} className="sm:[font-size:22px]" />
                  : <AddIcon sx={{ fontSize: 20 }} className="sm:[font-size:22px]" />}
              </span>
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
                  {form.id ? 'Editar usuario' : 'Nuevo usuario'}
                </DialogTitle>
                <DialogDescription className="truncate text-xs text-slate-500 sm:text-sm">
                  {form.id
                    ? `@${form.username || '—'} · ${ROLE_LABEL[form.role] ?? form.role}`
                    : 'Crea un operador con acceso al panel'}
                </DialogDescription>
              </div>
            </DialogHeader>

            <div className="mt-2 space-y-3">
              <Field label="Nombre"  value={form.name}     onChange={(v) => setForm({ ...form, name: v })} />
              <Field label="Email"   value={form.email}    onChange={(v) => setForm({ ...form, email: v })} />
              <Field label="Usuario" value={form.username} onChange={(v) => setForm({ ...form, username: v })} />
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">Rol</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </select>
              </div>
              {/* Marcos 2026-06-27 (post-incidente 06-22): en edit
                  mode el input de contraseña ahora vive detrás de un
                  toggle explícito que el admin tiene que prender.
                  Sin el toggle el input no se renderiza, así que
                  browser autofill no tiene field donde inyectar la
                  contraseña guardada del propio admin. En create
                  mode el input siempre se muestra y es required. */}
              {!form.id ? (
                <div>
                  <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">
                    Contraseña
                  </label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value, passwordTouched: true })}
                    autoComplete="new-password"
                    data-testid="users-form-password"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15"
                  />
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200/70 bg-amber-50/40 p-3 space-y-2">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.wantsPasswordChange}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          wantsPasswordChange: e.target.checked,
                          // Reset relacionados cuando se apaga el toggle.
                          password: e.target.checked ? form.password : '',
                          passwordTouched: e.target.checked ? form.passwordTouched : false,
                        })
                      }
                      data-testid="users-form-want-password-change"
                      className="mt-0.5 h-4 w-4 cursor-pointer rounded border-amber-400 text-amber-600"
                    />
                    <span className="text-[12px] text-amber-900">
                      <strong>Cambiar contraseña</strong>
                      <span className="block text-[11px] text-amber-800">
                        Sin tildar esto el campo no se modifica.
                      </span>
                    </span>
                  </label>
                  {form.wantsPasswordChange && (
                    <input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value, passwordTouched: true })}
                      placeholder="Nueva contraseña (mínimo 6 caracteres)"
                      autoComplete="new-password"
                      data-testid="users-form-password"
                      className="h-10 w-full rounded-xl border border-amber-300 bg-white px-3 text-sm outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
                    />
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={saving}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(99_102_241/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(99_102_241/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  {saving ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Guardando...
                    </>
                  ) : form.id ? 'Guardar cambios' : 'Crear usuario'}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

      <AlertDialog open={!!togglingActive} onOpenChange={(open) => { if (!open) setTogglingActive(null); }}>
        <AlertDialogContent className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150">
          <AlertDialogHeader className="space-y-3">
            <span
              className={
                "grid h-12 w-12 place-items-center rounded-2xl text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25)] " +
                (togglingActive?.active
                  ? "bg-gradient-to-br from-amber-500 to-orange-500 shadow-[0_8px_20px_-6px_rgb(245_158_11/0.45)]"
                  : "bg-gradient-to-br from-emerald-500 to-teal-500 shadow-[0_8px_20px_-6px_rgb(16_185_129/0.45)]")
              }
            >
              {togglingActive?.active
                ? <PowerSettingsNewIcon sx={{ fontSize: 22 }} />
                : <LoginIcon sx={{ fontSize: 22 }} />}
            </span>
            <AlertDialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              {togglingActive?.active ? '¿Desactivar usuario?' : '¿Reactivar usuario?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-slate-600">
              {togglingActive ? (togglingActive.active ? (
                <>
                  Vas a desactivar a{" "}
                  <span className="font-semibold text-slate-900">{togglingActive.name}</span>{" "}
                  (<span className="font-mono text-slate-700">@{togglingActive.username}</span>).
                  Pierde acceso al panel inmediatamente y deja de figurar en la lista activa.
                  Lo podés reactivar en cualquier momento marcando "Mostrar inactivos".
                </>
              ) : (
                <>
                  Vas a reactivar a{" "}
                  <span className="font-semibold text-slate-900">{togglingActive.name}</span>{" "}
                  (<span className="font-mono text-slate-700">@{togglingActive.username}</span>).
                  Recupera acceso al panel con su rol original.
                </>
              )) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmToggleActive}
              className={
                "inline-flex h-10 items-center justify-center rounded-xl px-5 text-sm font-medium text-white transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] " +
                (togglingActive?.active
                  ? "bg-gradient-to-r from-amber-600 to-orange-500 shadow-[0_8px_20px_-6px_rgb(245_158_11/0.5)] hover:shadow-[0_14px_30px_-6px_rgb(245_158_11/0.65)]"
                  : "bg-gradient-to-r from-emerald-600 to-teal-500 shadow-[0_8px_20px_-6px_rgb(16_185_129/0.5)] hover:shadow-[0_14px_30px_-6px_rgb(16_185_129/0.65)]")
              }
            >
              {togglingActive?.active ? 'Desactivar' : 'Reactivar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <AlertDialogContent className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150">
          <AlertDialogHeader className="space-y-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-red-500 to-rose-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(239_68_68/0.45)]">
              <DeleteIcon sx={{ fontSize: 22 }} />
            </span>
            <AlertDialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              ¿Eliminar usuario?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-slate-600">
              {deleting ? (
                <>
                  Vas a eliminar definitivamente a{" "}
                  <span className="font-semibold text-slate-900">{deleting.name}</span>{" "}
                  (<span className="font-mono text-slate-700">@{deleting.username}</span>). Si el
                  usuario tiene historial de conversaciones o pedidos, el sistema va a rechazar la
                  eliminación y conviene usar Desactivar en su lugar.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(239_68_68/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(239_68_68/0.65)] active:translate-y-0 active:scale-[0.97]"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface FieldProps { label: string; value: string; onChange: (v: string) => void; }
function Field({ label, value, onChange }: FieldProps) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15"
      />
    </div>
  );
}
