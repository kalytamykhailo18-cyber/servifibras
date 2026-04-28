"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AISettingsForm } from "@/components/settings/ai-settings-form";
import { ChannelConfigForm } from "@/components/settings/channel-config-form";
import { PricingForm } from "@/components/settings/pricing-form";
import { SystemSettingsForm } from "@/components/settings/system-settings-form";
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import SettingsIcon from '@mui/icons-material/Settings';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import WifiIcon from '@mui/icons-material/Wifi';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("ai");

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* HEADER */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground">
          Gestiona las configuraciones del sistema, IA, canales y precios
        </p>
      </div>

      {/* TABS */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="ai" className="flex items-center gap-2">
            <SmartToyIcon className="h-4 w-4" />
            <span className="hidden sm:inline">IA</span>
          </TabsTrigger>
          <TabsTrigger value="channels" className="flex items-center gap-2">
            <WifiIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Canales</span>
          </TabsTrigger>
          <TabsTrigger value="pricing" className="flex items-center gap-2">
            <AttachMoneyIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Precios</span>
          </TabsTrigger>
          <TabsTrigger value="system" className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4" />
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
