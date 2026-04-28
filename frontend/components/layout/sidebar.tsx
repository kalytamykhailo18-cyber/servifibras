"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  BookOpen,
  BarChart3,
  TrendingUp,
  Package,
  Settings,
} from "lucide-react";

// ============================================================================
// NAVIGATION ITEMS
// ============================================================================

const navigationItems = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    name: "Conversaciones",
    href: "/dashboard/conversations",
    icon: MessageSquare,
  },
  {
    name: "Contactos",
    href: "/dashboard/contacts",
    icon: Users,
  },
  {
    name: "Base de Conocimiento",
    href: "/dashboard/knowledge",
    icon: BookOpen,
  },
  {
    name: "Analíticas",
    href: "/dashboard/analytics",
    icon: BarChart3,
  },
  {
    name: "Oportunidades",
    href: "/dashboard/leads",
    icon: TrendingUp,
  },
  {
    name: "Pedidos",
    href: "/dashboard/orders",
    icon: Package,
  },
  {
    name: "Configuración",
    href: "/dashboard/settings",
    icon: Settings,
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
      <div className="flex h-16 items-center px-6 border-b border-border">
        <Link href="/dashboard" className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-lg">S</span>
          </div>
          <span className="font-bold text-xl">Servifibras</span>
        </Link>
      </div>

      {/* NAVIGATION */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        <ul className="space-y-1">
          {navigationItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all hover:bg-accent",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* FOOTER */}
      <div className="border-t border-border p-4">
        <p className="text-xs text-muted-foreground text-center">
          © 2024 Servifibras
        </p>
      </div>
    </aside>
  );
}
