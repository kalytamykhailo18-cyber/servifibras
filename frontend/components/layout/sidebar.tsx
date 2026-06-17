"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuthStore, selectUserRole } from "@/lib/store/auth-store";
import { UserRole } from "@/types";
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import PeopleIcon from '@mui/icons-material/People';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import BarChartIcon from '@mui/icons-material/BarChart';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import InventoryIcon from '@mui/icons-material/Inventory';
import CategoryIcon from '@mui/icons-material/Category';
import RequestQuoteIcon from '@mui/icons-material/RequestQuote';
import CampaignIcon from '@mui/icons-material/Campaign';
import GroupIcon from '@mui/icons-material/Group';
import HistoryIcon from '@mui/icons-material/History';
import SettingsIcon from '@mui/icons-material/Settings';
import ScienceIcon from '@mui/icons-material/Science';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

const ALL_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA, UserRole.ENCARGADO];

// Marcos 2026-06-11: collapsible categories. Order matters — categories
// render in the order declared here. Items inside each category render
// in their navigationItems order, filtered to the active role.
type Category = 'atencion' | 'logistica' | 'metricas' | 'sistema';
const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: 'atencion',  label: 'Atención'  },
  { id: 'logistica', label: 'Logística' },
  { id: 'metricas',  label: 'Métricas'  },
  { id: 'sistema',   label: 'Sistema'   },
];
const COLLAPSED_KEY = 'sidebar-collapsed-categories';

// ============================================================================
// NAVIGATION ITEMS
// ============================================================================

// Marcos 2026-06-11: the sidebar is grouped into 4 collapsible
// categories (Atención / Logística / Métricas / Sistema). Each item
// declares which category it sits in via the `category` field below;
// CATEGORIES (above) controls the order categories render in, and
// items render in their declaration order within each group, filtered
// to the active role. An item's role gates still hide it from users
// who shouldn't see it, and a category with zero visible items is
// hidden entirely.
const navigationItems = [
  {
    name: "Conversaciones",
    href: "/conversations",
    icon: ChatBubbleOutlineIcon,
    iconColor: "text-blue-600",
    activeBg: "bg-gradient-to-r from-blue-600 via-cyan-500 to-blue-600 shadow-[0_8px_20px_-6px_rgb(59_130_246/0.55)]",
    wash: "bg-gradient-to-r from-blue-500/10 via-cyan-400/10 to-transparent",
    rail: "bg-gradient-to-b from-blue-500 to-cyan-400",
    roles: ALL_ROLES,
    category: 'atencion' as Category,
  },
  {
    name: "Pedidos",
    href: "/orders",
    icon: InventoryIcon,
    iconColor: "text-green-600",
    activeBg: "bg-gradient-to-r from-green-600 via-emerald-500 to-green-600 shadow-[0_8px_20px_-6px_rgb(34_197_94/0.55)]",
    wash: "bg-gradient-to-r from-green-500/10 via-emerald-400/10 to-transparent",
    rail: "bg-gradient-to-b from-green-500 to-emerald-400",
    // Marcos 2026-06-11: lifted into Atención so the attention desk
    // can see + load orders alongside chats. Logística still has its
    // own dedicated "Armado" section under Logística.
    roles: [UserRole.ADMIN, UserRole.VENTAS, UserRole.LOGISTICA, UserRole.ATENCION, UserRole.ENCARGADO],
    category: 'atencion' as Category,
  },
  {
    // Marcos 2026-06-15: align sidebar visibility with the page-level
    // role gate ([ADMIN, VENTAS] per app/(dashboard)/quotes/page.tsx).
    // ATENCION was seeing the link, clicking it, and being redirected
    // — confusing and against the "no silent 403" principle: if she
    // can't open it, the link shouldn't be there.
    name: "Presupuestos",
    href: "/quotes",
    icon: RequestQuoteIcon,
    iconColor: "text-amber-600",
    activeBg: "bg-gradient-to-r from-amber-600 via-yellow-500 to-amber-600 shadow-[0_8px_20px_-6px_rgb(217_119_6/0.55)]",
    wash: "bg-gradient-to-r from-amber-500/10 via-yellow-400/10 to-transparent",
    rail: "bg-gradient-to-b from-amber-500 to-yellow-400",
    roles: [UserRole.ADMIN, UserRole.VENTAS, UserRole.ENCARGADO],
    category: 'atencion' as Category,
  },
  {
    name: "Contactos",
    href: "/contacts",
    icon: PeopleIcon,
    iconColor: "text-emerald-600",
    activeBg: "bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-600 shadow-[0_8px_20px_-6px_rgb(16_185_129/0.55)]",
    wash: "bg-gradient-to-r from-emerald-500/10 via-teal-400/10 to-transparent",
    rail: "bg-gradient-to-b from-emerald-500 to-teal-400",
    roles: ALL_ROLES,
    category: 'atencion' as Category,
  },
  {
    // Marcos 2026-06-11: renamed from "Logística diaria" so the
    // sidebar label matches the daily flow (armado / picking).
    name: "Armado",
    href: "/logistica-diaria",
    icon: InventoryIcon,
    iconColor: "text-orange-600",
    activeBg: "bg-gradient-to-r from-orange-600 via-amber-500 to-orange-600 shadow-[0_8px_20px_-6px_rgb(249_115_22/0.55)]",
    wash: "bg-gradient-to-r from-orange-500/10 via-amber-400/10 to-transparent",
    rail: "bg-gradient-to-b from-orange-500 to-amber-400",
    roles: [UserRole.ADMIN, UserRole.LOGISTICA, UserRole.ENCARGADO],
    category: 'logistica' as Category,
  },
  {
    // Marcos 2026-06-11: renamed from "Placas PRFV" → "Laminados PRFV"
    // to align with the integrated laminados flow Marcos described
    // (Pedido → placa PENDIENTE auto-created here).
    name: "Laminados PRFV",
    href: "/prfv-placas",
    icon: CategoryIcon,
    iconColor: "text-amber-600",
    activeBg: "bg-gradient-to-r from-amber-600 via-orange-500 to-amber-600 shadow-[0_8px_20px_-6px_rgb(245_158_11/0.55)]",
    wash: "bg-gradient-to-r from-amber-500/10 via-orange-400/10 to-transparent",
    rail: "bg-gradient-to-b from-amber-500 to-orange-400",
    roles: [UserRole.ADMIN, UserRole.LOGISTICA, UserRole.ENCARGADO],
    category: 'logistica' as Category,
  },
  {
    name: "Campañas",
    href: "/campaigns",
    icon: CampaignIcon,
    iconColor: "text-fuchsia-600",
    activeBg: "bg-gradient-to-r from-fuchsia-600 via-pink-500 to-fuchsia-600 shadow-[0_8px_20px_-6px_rgb(217_70_239/0.55)]",
    wash: "bg-gradient-to-r from-fuchsia-500/10 via-pink-400/10 to-transparent",
    rail: "bg-gradient-to-b from-fuchsia-500 to-pink-400",
    roles: [UserRole.ADMIN],
    category: 'metricas' as Category,
  },
  {
    name: "Oportunidades",
    href: "/leads",
    icon: TrendingUpIcon,
    iconColor: "text-orange-600",
    activeBg: "bg-gradient-to-r from-orange-600 via-red-500 to-orange-600 shadow-[0_8px_20px_-6px_rgb(249_115_22/0.55)]",
    wash: "bg-gradient-to-r from-orange-500/10 via-red-400/10 to-transparent",
    rail: "bg-gradient-to-b from-orange-500 to-red-400",
    roles: [UserRole.ADMIN, UserRole.VENTAS],
    category: 'metricas' as Category,
  },
  {
    name: "Analíticas",
    href: "/analytics",
    icon: BarChartIcon,
    iconColor: "text-pink-600",
    activeBg: "bg-gradient-to-r from-pink-600 via-rose-500 to-pink-600 shadow-[0_8px_20px_-6px_rgb(236_72_153/0.55)]",
    wash: "bg-gradient-to-r from-pink-500/10 via-rose-400/10 to-transparent",
    rail: "bg-gradient-to-b from-pink-500 to-rose-400",
    roles: ALL_ROLES,
    category: 'metricas' as Category,
  },
  {
    name: "Catálogo",
    href: "/products",
    icon: CategoryIcon,
    iconColor: "text-cyan-600",
    activeBg: "bg-gradient-to-r from-cyan-600 via-sky-500 to-cyan-600 shadow-[0_8px_20px_-6px_rgb(6_182_212/0.55)]",
    wash: "bg-gradient-to-r from-cyan-500/10 via-sky-400/10 to-transparent",
    rail: "bg-gradient-to-b from-cyan-500 to-sky-400",
    // Read-allowed for every role (same as Knowledge) so operators can
    // look up SKU + price + stock while replying to a customer. The
    // page gates write affordances behind canWrite = ADMIN.
    roles: ALL_ROLES,
    category: 'sistema' as Category,
  },
  {
    name: "Usuarios",
    href: "/users",
    icon: GroupIcon,
    iconColor: "text-indigo-600",
    activeBg: "bg-gradient-to-r from-indigo-600 via-violet-500 to-indigo-600 shadow-[0_8px_20px_-6px_rgb(99_102_241/0.55)]",
    wash: "bg-gradient-to-r from-indigo-500/10 via-violet-400/10 to-transparent",
    rail: "bg-gradient-to-b from-indigo-500 to-violet-400",
    roles: [UserRole.ADMIN],
    category: 'sistema' as Category,
  },
  {
    name: "Auditoría",
    href: "/audit",
    icon: HistoryIcon,
    iconColor: "text-slate-600",
    activeBg: "bg-gradient-to-r from-slate-700 via-slate-500 to-slate-700 shadow-[0_8px_20px_-6px_rgb(71_85_105/0.55)]",
    wash: "bg-gradient-to-r from-slate-500/10 via-zinc-400/10 to-transparent",
    rail: "bg-gradient-to-b from-slate-500 to-zinc-400",
    roles: [UserRole.ADMIN],
    category: 'sistema' as Category,
  },
  {
    // "Probar como cliente" — sandbox surface for chatting with the
    // agent in the customer role without touching the real inbox.
    // Visible to every role so any operator can rehearse before a
    // tricky reply; backend gates it identically.
    name: "Probar agente",
    href: "/sandbox",
    icon: ScienceIcon,
    iconColor: "text-violet-600",
    activeBg: "bg-gradient-to-r from-violet-600 via-purple-500 to-violet-600 shadow-[0_8px_20px_-6px_rgb(139_92_246/0.55)]",
    wash: "bg-gradient-to-r from-violet-500/10 via-purple-400/10 to-transparent",
    rail: "bg-gradient-to-b from-violet-500 to-purple-500",
    roles: ALL_ROLES,
    category: 'sistema' as Category,
  },
  {
    name: "Configuración",
    href: "/settings",
    icon: SettingsIcon,
    iconColor: "text-slate-600",
    activeBg: "bg-gradient-to-r from-slate-700 via-zinc-500 to-slate-700 shadow-[0_8px_20px_-6px_rgb(100_116_139/0.55)]",
    wash: "bg-gradient-to-r from-slate-500/10 via-zinc-400/10 to-transparent",
    rail: "bg-gradient-to-b from-slate-500 to-zinc-400",
    roles: [UserRole.ADMIN],
    category: 'sistema' as Category,
  },
  {
    name: "Base de Conocimiento",
    href: "/knowledge",
    icon: MenuBookIcon,
    iconColor: "text-violet-600",
    activeBg: "bg-gradient-to-r from-violet-600 via-purple-500 to-violet-600 shadow-[0_8px_20px_-6px_rgb(139_92_246/0.55)]",
    wash: "bg-gradient-to-r from-violet-500/10 via-purple-400/10 to-transparent",
    rail: "bg-gradient-to-b from-violet-500 to-purple-500",
    roles: ALL_ROLES,
    category: 'sistema' as Category,
  },
];

// ============================================================================
// SIDEBAR COMPONENT
// ============================================================================

interface SidebarProps {
  /** Open state of the mobile drawer. Ignored at lg+ where the sidebar is permanent. */
  mobileOpen?: boolean;
  /** Called when the user dismisses the mobile drawer (backdrop click, close button, or route change). */
  onMobileClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const role = useAuthStore(selectUserRole);

  // Marcos 2026-06-17: ENCARGADO inherits ATENCION + LOGISTICA
  // visibility automatically — same rule as useRoleGuard + the
  // backend RolesGuard. An item allowed for either role is also
  // visible to ENCARGADO without having to list it explicitly.
  const visibleItems = role
    ? navigationItems.filter((item) => {
        if (item.roles.includes(role)) return true;
        if (
          role === UserRole.ENCARGADO
          && (item.roles.includes(UserRole.ATENCION) || item.roles.includes(UserRole.LOGISTICA))
        ) {
          return true;
        }
        return false;
      })
    : [];

  // Group visible items by category, preserving (a) the CATEGORIES
  // declaration order and (b) the navigationItems declaration order
  // within each category.
  const grouped = CATEGORIES.map((c) => ({
    ...c,
    items: visibleItems.filter((it) => it.category === c.id),
  })).filter((c) => c.items.length > 0);

  // Marcos 2026-06-11: accordion — only ONE category is expanded at
  // a time. On first load the open category is the one containing
  // the active route (or the first visible category if no match).
  // Clicking the open category collapses it (zero open); clicking a
  // different one closes the previous and opens it. localStorage
  // remembers the operator's last choice across reloads.
  const activeCategory: Category | null =
    grouped.find((c) => c.items.some((it) => pathname === it.href || pathname.startsWith(it.href + "/")))?.id
    ?? grouped[0]?.id
    ?? null;
  const [expanded, setExpanded] = useState<Category | null>(activeCategory);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(COLLAPSED_KEY);
      if (raw == null) return;
      if (raw === 'null') { setExpanded(null); return; }
      if (raw === 'atencion' || raw === 'logistica' || raw === 'metricas' || raw === 'sistema') {
        setExpanded(raw as Category);
      }
    } catch { /* ignore corrupted state */ }
  }, []);
  const toggleCategory = (id: Category) => {
    setExpanded((prev) => {
      const next = prev === id ? null : id;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next === null ? 'null' : next);
      } catch { /* storage quota / disabled — UI still works in-session */ }
      return next;
    });
  };

  // Auto-close the drawer when the route changes — without this, tapping a
  // nav item navigates but leaves the drawer open over the new page.
  useEffect(() => {
    if (mobileOpen && onMobileClose) onMobileClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open so the page underneath
  // doesn't scroll along with the drawer.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (mobileOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [mobileOpen]);

  return (
    <>
      {/* MOBILE BACKDROP — fades in behind the drawer, taps dismiss */}
      <div
        aria-hidden
        onClick={onMobileClose}
        className={cn(
          "fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-200 lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      {/* SIDEBAR — fixed drawer on mobile, permanent rail at lg+ */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card shadow-xl transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
          // Mobile: slide in from left
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: always visible, no shadow needed
          "lg:translate-x-0 lg:shadow-none",
        )}
      >
        {/* LOGO + mobile close button — black header per Marcos 2026-06-03,
            uses the official Servifibras mark (inverted variant on dark bg). */}
        <div className="flex h-16 items-center justify-between border-b border-black bg-black px-4 lg:px-12">
          <Link
            href="/conversations"
            onClick={onMobileClose}
            className="group flex items-center gap-2.5"
          >
            <span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-[1.08]">
              <Image
                src="/servifibras-mark-inverted.png"
                alt="Servifibras"
                width={36}
                height={36}
                priority
                className="h-9 w-9 object-contain"
              />
            </span>
            <span className="text-[1.05rem] font-semibold tracking-[0.04em] text-white">
              SERVIFIBRAS
            </span>
          </Link>
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Cerrar menú"
            className="grid h-9 w-9 place-items-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
          >
            <CloseIcon sx={{ fontSize: 20 }} />
          </button>
        </div>

        {/* NAVIGATION — Marcos 2026-06-11: grouped into collapsible
            categories (Atención / Logística / Métricas / Sistema).
            Categories sit flush against each other so there are no
            dead zones between them — every pixel under the cursor is
            either a hoverable item or a hoverable category header. */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <div>
            {grouped.map((cat, ci) => {
              const isCollapsed = expanded !== cat.id;
              return (
                <div
                  key={cat.id}
                  // Open category gets a soft slate wash + a 2px left
                  // accent rail so the open vs closed groups are
                  // visually distinct at a glance. Closed categories
                  // stay flat so the eye lands on the open one.
                  className={cn(
                    "transition-colors duration-200",
                    !isCollapsed && "rounded-lg bg-slate-50/80 border-l-2 border-slate-300",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat.id)}
                    aria-expanded={!isCollapsed}
                    aria-controls={`sidebar-cat-${cat.id}`}
                    data-testid={`sidebar-category-${cat.id}`}
                    className={cn(
                      "group flex w-full items-center justify-between rounded-lg px-3 py-3 text-[11px] font-semibold uppercase tracking-wider transition-all duration-200",
                      isCollapsed
                        ? "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                        : "text-slate-800 hover:bg-slate-100/70",
                    )}
                  >
                    <span className="transition-transform duration-200 group-hover:translate-x-0.5">{cat.label}</span>
                    {isCollapsed ? (
                      <ChevronRightIcon sx={{ fontSize: 16 }} className="text-slate-400 transition-colors group-hover:text-slate-700" />
                    ) : (
                      <ExpandMoreIcon sx={{ fontSize: 16 }} className="text-slate-600" />
                    )}
                  </button>
                  {!isCollapsed && (
                    <ul id={`sidebar-cat-${cat.id}`} className="pb-1">
                      {cat.items.map((item, ii) => {
                        const isActive =
                          pathname === item.href || pathname.startsWith(item.href + "/");
                        const Icon = item.icon;
                        return (
                          <li
                            key={item.href}
                            className="animate-fade-up"
                            style={{ animationDelay: `${0.05 + (ci * 0.04) + (ii * 0.04)}s` }}
                          >
                            <Link
                              href={item.href}
                              onClick={() => {
                                if (typeof window !== "undefined") {
                                  requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior }));
                                }
                                onMobileClose?.();
                              }}
                              className={cn(
                                "group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                                isActive
                                  ? `${item.activeBg} text-white`
                                  : "text-foreground/75 hover:bg-slate-100 hover:text-foreground",
                              )}
                            >
                              {isActive && (
                                <span
                                  aria-hidden
                                  className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"
                                />
                              )}
                              {!isActive && (
                                <span
                                  aria-hidden
                                  className={cn(
                                    "pointer-events-none absolute inset-0 -translate-x-full transition-transform duration-500 ease-out group-hover:translate-x-0",
                                    item.wash,
                                  )}
                                />
                              )}
                              {!isActive && (
                                <span
                                  aria-hidden
                                  className={cn(
                                    "pointer-events-none absolute left-0 top-1/2 h-0 w-0.5 -translate-y-1/2 rounded-r-full transition-all duration-300 group-hover:h-6",
                                    item.rail,
                                  )}
                                />
                              )}
                              <Icon
                                className={cn(
                                  "relative h-5 w-5 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                                  isActive
                                    ? "text-white drop-shadow-[0_2px_4px_rgb(255_255_255/0.3)]"
                                    : `${item.iconColor} group-hover:scale-110`,
                                )}
                              />
                              <span className="relative transition-transform duration-300 group-hover:translate-x-0.5">
                                {item.name}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </nav>

        {/* FOOTER */}
        <div className="relative px-4 py-4">
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-300/60 to-transparent" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500">
              © 2026 Servifibras
            </span>
            <span className="group inline-flex items-center gap-1.5 rounded-full border border-blue-200/60 bg-blue-50/60 px-2 py-0.5 text-[10px] font-medium text-blue-700 transition-all duration-300 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 inline-flex animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              v1.0
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
