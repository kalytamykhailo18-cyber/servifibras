"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import PeopleIcon from '@mui/icons-material/People';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import BarChartIcon from '@mui/icons-material/BarChart';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import InventoryIcon from '@mui/icons-material/Inventory';
import SettingsIcon from '@mui/icons-material/Settings';

// ============================================================================
// NAVIGATION ITEMS
// ============================================================================

/**
 * Each item carries its own colour identity:
 *  - `iconColor`: idle (inactive) icon hue
 *  - `activeBg`: gradient pill + shadow when the route is active
 *  - `wash`:    soft gradient overlay sliding in on hover
 *  - `rail`:    left-edge accent that grows on hover
 *
 * Class strings are kept as full literals so Tailwind's JIT picks them up.
 */
const navigationItems = [
  {
    name: "Conversaciones",
    href: "/conversations",
    icon: ChatBubbleOutlineIcon,
    iconColor: "text-blue-600",
    activeBg: "bg-gradient-to-r from-blue-600 via-cyan-500 to-blue-600 shadow-[0_8px_20px_-6px_rgb(59_130_246/0.55)]",
    wash: "bg-gradient-to-r from-blue-500/10 via-cyan-400/10 to-transparent",
    rail: "bg-gradient-to-b from-blue-500 to-cyan-400",
  },
  {
    name: "Contactos",
    href: "/contacts",
    icon: PeopleIcon,
    iconColor: "text-emerald-600",
    activeBg: "bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-600 shadow-[0_8px_20px_-6px_rgb(16_185_129/0.55)]",
    wash: "bg-gradient-to-r from-emerald-500/10 via-teal-400/10 to-transparent",
    rail: "bg-gradient-to-b from-emerald-500 to-teal-400",
  },
  {
    name: "Base de Conocimiento",
    href: "/knowledge",
    icon: MenuBookIcon,
    iconColor: "text-violet-600",
    activeBg: "bg-gradient-to-r from-violet-600 via-purple-500 to-violet-600 shadow-[0_8px_20px_-6px_rgb(139_92_246/0.55)]",
    wash: "bg-gradient-to-r from-violet-500/10 via-purple-400/10 to-transparent",
    rail: "bg-gradient-to-b from-violet-500 to-purple-500",
  },
  {
    name: "Analíticas",
    href: "/analytics",
    icon: BarChartIcon,
    iconColor: "text-pink-600",
    activeBg: "bg-gradient-to-r from-pink-600 via-rose-500 to-pink-600 shadow-[0_8px_20px_-6px_rgb(236_72_153/0.55)]",
    wash: "bg-gradient-to-r from-pink-500/10 via-rose-400/10 to-transparent",
    rail: "bg-gradient-to-b from-pink-500 to-rose-400",
  },
  {
    name: "Oportunidades",
    href: "/leads",
    icon: TrendingUpIcon,
    iconColor: "text-orange-600",
    activeBg: "bg-gradient-to-r from-orange-600 via-red-500 to-orange-600 shadow-[0_8px_20px_-6px_rgb(249_115_22/0.55)]",
    wash: "bg-gradient-to-r from-orange-500/10 via-red-400/10 to-transparent",
    rail: "bg-gradient-to-b from-orange-500 to-red-400",
  },
  {
    name: "Pedidos",
    href: "/orders",
    icon: InventoryIcon,
    iconColor: "text-green-600",
    activeBg: "bg-gradient-to-r from-green-600 via-emerald-500 to-green-600 shadow-[0_8px_20px_-6px_rgb(34_197_94/0.55)]",
    wash: "bg-gradient-to-r from-green-500/10 via-emerald-400/10 to-transparent",
    rail: "bg-gradient-to-b from-green-500 to-emerald-400",
  },
  {
    name: "Configuración",
    href: "/settings",
    icon: SettingsIcon,
    iconColor: "text-slate-600",
    activeBg: "bg-gradient-to-r from-slate-700 via-zinc-500 to-slate-700 shadow-[0_8px_20px_-6px_rgb(100_116_139/0.55)]",
    wash: "bg-gradient-to-r from-slate-500/10 via-zinc-400/10 to-transparent",
    rail: "bg-gradient-to-b from-slate-500 to-zinc-400",
  },
];

// ============================================================================
// SIDEBAR COMPONENT
// ============================================================================

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 lg:border-r lg:border-border lg:bg-card">
      {/* LOGO */}
      <div className="flex h-16 items-center border-b border-border px-6">
        <Link href="/conversations" className="group flex items-center gap-2.5">
          <span className="animate-float">
            <span className="relative grid h-8 w-8 place-items-center rounded-[0.55rem] bg-gradient-to-br from-blue-500 to-cyan-400 animate-glow-pulse transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-[1.12]">
              <span className="text-sm font-bold tracking-tight text-white">S</span>
              <span className="pointer-events-none absolute inset-0 rounded-[0.55rem] bg-gradient-to-b from-white/30 to-transparent" />
            </span>
          </span>
          <span className="text-[1.05rem] font-semibold tracking-tight text-foreground">
            Servifibras
          </span>
        </Link>
      </div>

      {/* NAVIGATION */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {navigationItems.map((item, i) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;

            return (
              <li
                key={item.href}
                className="animate-fade-up"
                style={{ animationDelay: `${0.05 + i * 0.05}s` }}
              >
                <Link
                  href={item.href}
                  className={cn(
                    "group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
                    isActive
                      ? `${item.activeBg} text-white`
                      : "text-foreground/75 hover:text-foreground",
                  )}
                >
                  {/* Active: shimmer band sweeping continuously across the pill */}
                  {isActive && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"
                    />
                  )}

                  {/* Inactive: hover gradient wash slides in from left */}
                  {!isActive && (
                    <span
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute inset-0 -translate-x-full transition-transform duration-500 ease-out group-hover:translate-x-0",
                        item.wash,
                      )}
                    />
                  )}

                  {/* Inactive: animated left rail accent that grows on hover */}
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
      </nav>

      {/* FOOTER */}
      <div className="relative px-4 py-4">
        {/* Shimmering hairline */}
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
  );
}
