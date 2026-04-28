"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import DashboardIcon from '@mui/icons-material/Dashboard';
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

const navigationItems = [
  {
    name: "Conversaciones",
    href: "/conversations",
    icon: ChatBubbleOutlineIcon,
  },
  {
    name: "Contactos",
    href: "/contacts",
    icon: PeopleIcon,
  },
  {
    name: "Base de Conocimiento",
    href: "/knowledge",
    icon: MenuBookIcon,
  },
  {
    name: "Analíticas",
    href: "/analytics",
    icon: BarChartIcon,
  },
  {
    name: "Oportunidades",
    href: "/leads",
    icon: TrendingUpIcon,
  },
  {
    name: "Pedidos",
    href: "/orders",
    icon: InventoryIcon,
  },
  {
    name: "Configuración",
    href: "/settings",
    icon: SettingsIcon,
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
        <Link href="/conversations" className="flex items-center space-x-2">
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
