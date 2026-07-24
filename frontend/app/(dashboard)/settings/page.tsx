"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AISettingsForm } from "@/components/settings/ai-settings-form";
import { AICorrectionsForm } from "@/components/settings/ai-corrections-form";
import { ChannelConfigForm } from "@/components/settings/channel-config-form";
import { PricingForm } from "@/components/settings/pricing-form";
import { CatalogoImportCard } from "@/components/settings/catalogo-import-card";
import { LaminadosForm } from "@/components/settings/laminados-form";
import { SystemSettingsForm } from "@/components/settings/system-settings-form";
import { IntegrationsForm } from "@/components/settings/integrations-form";
import { WhatsappQrCard } from "@/components/settings/whatsapp-qr-card";
import { LeadDetectionForm } from "@/components/settings/lead-detection-form";
import { LogisticaForm } from "@/components/settings/logistica-form";
import { DispatchTariffsForm } from "@/components/settings/dispatch-tariffs-form";
import { CarrierAliasesForm } from "@/components/settings/carrier-aliases-form";
import { ZoneCarrierRecommendationsCard } from "@/components/settings/zone-carrier-recommendations-card";
import { OperationalResponsiblesForm } from "@/components/settings/operational-responsibles-form";
import { QuickRepliesForm } from "@/components/settings/quick-replies-form";
import { useRoleGuard } from "@/lib/hooks/use-role-guard";
import { UserRole } from "@/types";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import BoltIcon from "@mui/icons-material/Bolt";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import HubIcon from "@mui/icons-material/Hub";
import LayersIcon from "@mui/icons-material/Layers";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import SettingsIcon from "@mui/icons-material/Settings";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import WifiIcon from "@mui/icons-material/Wifi";

const SETTINGS_ROLES = [UserRole.ADMIN];

export default function SettingsPage() {
  const { isAllowed } = useRoleGuard(SETTINGS_ROLES);
  // Marcos 2026-06-30: deep-link support — atajos como
  // /configuracion?tab=logistica abren directo en la pestaña
  // correcta. El banner de Listas usa esto para puntear a las
  // recomendaciones de mensajería sin que el operador navegue.
  const searchParams = useSearchParams();
  const initialTab = searchParams?.get("tab") ?? "ai";
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    const t = searchParams?.get("tab");
    if (t && t !== activeTab) setActiveTab(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  if (!isAllowed) return null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* PAGE HEADER */}
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-slate-700 to-zinc-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(100_116_139/0.45)] sm:h-11 sm:w-11">
          <SettingsIcon sx={{ fontSize: 20 }} className="sm:[font-size:22px]" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-3xl text-slate-900">Configuración</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Gestiona las configuraciones del sistema, IA, canales y precios
          </p>
        </div>
      </div>

      {/* TABS — scrolls horizontally on mobile to fit all 6 tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="flex h-12 w-full gap-1 overflow-x-auto rounded-2xl border border-slate-200/70 bg-slate-100/60 p-1.5 sm:grid sm:grid-cols-9">
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
            value="laminados"
            className="group h-9 gap-2 rounded-xl border-0 px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:text-slate-900 data-active:bg-white data-active:text-cyan-700 data-active:shadow-[0_4px_12px_-2px_rgb(15_23_42/0.08)]"
          >
            <LayersIcon sx={{ fontSize: 16 }} />
            <span className="hidden sm:inline">Laminados</span>
          </TabsTrigger>
          <TabsTrigger
            value="integrations"
            className="group h-9 gap-2 rounded-xl border-0 px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:text-slate-900 data-active:bg-white data-active:text-amber-700 data-active:shadow-[0_4px_12px_-2px_rgb(15_23_42/0.08)]"
          >
            <HubIcon sx={{ fontSize: 16 }} />
            <span className="hidden sm:inline">Integraciones</span>
          </TabsTrigger>
          <TabsTrigger
            value="detection"
            className="group h-9 gap-2 rounded-xl border-0 px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:text-slate-900 data-active:bg-white data-active:text-rose-700 data-active:shadow-[0_4px_12px_-2px_rgb(15_23_42/0.08)]"
          >
            <FilterAltIcon sx={{ fontSize: 16 }} />
            <span className="hidden sm:inline">Detección</span>
          </TabsTrigger>
          <TabsTrigger
            value="logistica"
            className="group h-9 gap-2 rounded-xl border-0 px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:text-slate-900 data-active:bg-white data-active:text-amber-700 data-active:shadow-[0_4px_12px_-2px_rgb(15_23_42/0.08)]"
          >
            <LocalShippingIcon sx={{ fontSize: 16 }} />
            <span className="hidden sm:inline">Logística</span>
          </TabsTrigger>
          <TabsTrigger
            value="quickReplies"
            className="group h-9 gap-2 rounded-xl border-0 px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:text-slate-900 data-active:bg-white data-active:text-violet-700 data-active:shadow-[0_4px_12px_-2px_rgb(15_23_42/0.08)]"
          >
            <BoltIcon sx={{ fontSize: 16 }} />
            <span className="hidden sm:inline">Respuestas</span>
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
          <AICorrectionsForm />
        </TabsContent>

        <TabsContent value="channels" className="space-y-4">
          <ChannelConfigForm />
        </TabsContent>

        <TabsContent value="pricing" className="space-y-4">
          <CatalogoImportCard />
          <PricingForm />
        </TabsContent>

        <TabsContent value="laminados" className="space-y-4">
          <LaminadosForm />
        </TabsContent>

        <TabsContent value="integrations" className="space-y-4">
          <IntegrationsForm />
          <WhatsappQrCard />
        </TabsContent>

        <TabsContent value="detection" className="space-y-4">
          <LeadDetectionForm />
        </TabsContent>

        <TabsContent value="logistica" className="space-y-4">
          <LogisticaForm />
          <CarrierAliasesForm />
          <DispatchTariffsForm />
          <ZoneCarrierRecommendationsCard />
          <OperationalResponsiblesForm />
        </TabsContent>

        <TabsContent value="quickReplies" className="space-y-4">
          <QuickRepliesForm />
        </TabsContent>

        <TabsContent value="system" className="space-y-4">
          <SystemSettingsForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
