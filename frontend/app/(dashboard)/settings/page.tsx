"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AISettingsForm } from "@/components/settings/ai-settings-form";
import { ChannelConfigForm } from "@/components/settings/channel-config-form";
import { PricingForm } from "@/components/settings/pricing-form";
import { SystemSettingsForm } from "@/components/settings/system-settings-form";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import SettingsIcon from "@mui/icons-material/Settings";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import WifiIcon from "@mui/icons-material/Wifi";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("ai");

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* PAGE HEADER */}
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-slate-700 to-zinc-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(100_116_139/0.45)]">
          <SettingsIcon sx={{ fontSize: 22 }} />
        </span>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Configuración</h1>
          <p className="text-sm text-muted-foreground">
            Gestiona las configuraciones del sistema, IA, canales y precios
          </p>
        </div>
      </div>

      {/* TABS */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid h-12 w-full grid-cols-4 gap-1 rounded-2xl border border-slate-200/70 bg-slate-100/60 p-1.5">
          <TabsTrigger
            value="ai"
            className="group h-9 gap-2 rounded-xl border-0 px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:text-slate-900 data-active:bg-white data-active:text-violet-700 data-active:shadow-[0_4px_12px_-2px_rgb(15_23_42/0.08)]"
          >
            <SmartToyIcon sx={{ fontSize: 16 }} />
            <span className="hidden sm:inline">IA</span>
          </TabsTrigger>
          <TabsTrigger
            value="channels"
            className="group h-9 gap-2 rounded-xl border-0 px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:text-slate-900 data-active:bg-white data-active:text-blue-700 data-active:shadow-[0_4px_12px_-2px_rgb(15_23_42/0.08)]"
          >
            <WifiIcon sx={{ fontSize: 16 }} />
            <span className="hidden sm:inline">Canales</span>
          </TabsTrigger>
          <TabsTrigger
            value="pricing"
            className="group h-9 gap-2 rounded-xl border-0 px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:text-slate-900 data-active:bg-white data-active:text-emerald-700 data-active:shadow-[0_4px_12px_-2px_rgb(15_23_42/0.08)]"
          >
            <AttachMoneyIcon sx={{ fontSize: 16 }} />
            <span className="hidden sm:inline">Precios</span>
          </TabsTrigger>
          <TabsTrigger
            value="system"
            className="group h-9 gap-2 rounded-xl border-0 px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:text-slate-900 data-active:bg-white data-active:text-slate-900 data-active:shadow-[0_4px_12px_-2px_rgb(15_23_42/0.08)]"
          >
            <SettingsIcon sx={{ fontSize: 16 }} />
            <span className="hidden sm:inline">Sistema</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ai" className="space-y-4">
          <AISettingsForm />
        </TabsContent>

        <TabsContent value="channels" className="space-y-4">
          <ChannelConfigForm />
        </TabsContent>

        <TabsContent value="pricing" className="space-y-4">
          <PricingForm />
        </TabsContent>

        <TabsContent value="system" className="space-y-4">
          <SystemSettingsForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
