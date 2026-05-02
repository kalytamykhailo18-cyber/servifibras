"use client";

import { useRouter } from "next/navigation";
import { useAuthStore, selectUser, selectUserName } from "@/lib/store/auth-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import LogoutIcon from '@mui/icons-material/Logout';
import PersonIcon from '@mui/icons-material/Person';
import { USER_ROLE_LABELS } from "@/types";

// ============================================================================
// HEADER COMPONENT
// ============================================================================

export function Header() {
  const router = useRouter();
  const user = useAuthStore(selectUser);
  const userName = useAuthStore(selectUserName);
  const logout = useAuthStore((state) => state.logout);

  // Get user initials for avatar
  const getUserInitials = (name: string | undefined) => {
    if (!name) return "?";
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center border-b border-slate-900/[0.06] bg-card/70 px-6 backdrop-blur-xl backdrop-saturate-150">
      {/* LEFT — mobile-only wordmark (sidebar covers this on lg+) */}
      <h1 className="text-lg font-semibold tracking-tight text-foreground lg:hidden">
        Servifibras
      </h1>

      {/* RIGHT — user menu, pinned to the end */}
      <div className="ml-auto">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Abrir menú de usuario"
              className="group relative h-10 w-10 rounded-full transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:scale-105 active:scale-[0.96]"
            />
          }
        >
          <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 text-sm font-semibold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_4px_12px_-2px_rgb(59_130_246/0.4)]">
            {getUserInitials(userName)}
          </span>
          <span
            aria-hidden
            className="pointer-events-none absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background bg-emerald-500 shadow-[0_0_0_1px_rgb(16_185_129/0.4)]"
          />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          className="w-64 overflow-hidden rounded-2xl border border-slate-200/70 bg-white/85 p-1.5 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.18)] backdrop-blur-xl backdrop-saturate-150"
        >
          {/* User card */}
          <DropdownMenuLabel className="rounded-xl bg-gradient-to-br from-slate-50 to-blue-50/60 p-3 font-normal">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 text-sm font-semibold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_4px_10px_-2px_rgb(59_130_246/0.4)]">
                {getUserInitials(userName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight text-slate-900">{user?.name}</p>
                <p className="truncate text-xs leading-tight text-slate-500">{user?.email}</p>
                {user?.role && (
                  <span className="mt-1.5 inline-flex items-center rounded-full bg-blue-100/80 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                    {USER_ROLE_LABELS[user.role]}
                  </span>
                )}
              </div>
            </div>
          </DropdownMenuLabel>

          <DropdownMenuSeparator className="my-1.5" />

          <DropdownMenuItem
            onClick={() => router.push("/profile")}
            className="group cursor-pointer rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 focus:bg-blue-50 focus:text-blue-700"
          >
            <span className="mr-2.5 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-blue-500 to-cyan-400 text-white transition-transform duration-200 group-hover:scale-105">
              <PersonIcon sx={{ fontSize: 16 }} />
            </span>
            <span>Perfil</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={logout}
            className="group cursor-pointer rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 focus:bg-red-50 focus:text-red-700"
          >
            <span className="mr-2.5 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-red-500 to-rose-500 text-white transition-transform duration-200 group-hover:scale-105">
              <LogoutIcon sx={{ fontSize: 16 }} />
            </span>
            <span>Cerrar Sesión</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
    </header>
  );
}
