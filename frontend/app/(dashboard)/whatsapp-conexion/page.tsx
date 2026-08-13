"use client";

/**
 * Marcos 2026-08-13 (WhatsApp 7:04 AR): "se nos desconectó whatsapp
 * y yo no tengo el dispositivo para iniciar sesión. Le podemos dar
 * acceso al qr a otros usuarios para que puedan conectar?".
 *
 * Página dedicada — sólo el QR + status + reconectar. Habilitada a
 * ADMIN y ENCARGADO (Brenda / Franco) para que cuando Marcos no está
 * físicamente con el teléfono, uno de ellos pueda abrir esta URL,
 * ver el QR y escanearlo desde el celular donde vive la cuenta WA.
 * NO expone las otras tabs de /settings (integraciones, prompts,
 * usuarios, etc.) — sólo la palanca de reconexión.
 */

import { WhatsappQrCard } from "@/components/settings/whatsapp-qr-card";
import { useRoleGuard } from "@/lib/hooks/use-role-guard";
import { UserRole } from "@/types";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";

const ALLOWED_ROLES = [UserRole.ADMIN, UserRole.ENCARGADO];

export default function WhatsappConexionPage() {
  const { isAllowed } = useRoleGuard(ALLOWED_ROLES);
  if (!isAllowed) return null;
  return (
    <div className="space-y-6" data-testid="whatsapp-conexion-page">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
          <WhatsAppIcon sx={{ fontSize: 22 }} />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Conexión de WhatsApp</h1>
          <p className="text-sm text-slate-500">
            Si el CRM se desconectó, escaneá el QR desde el celular donde vive la cuenta de WhatsApp
            (Vincular un dispositivo). Cualquiera con rol Admin o Encargado puede abrir esta página.
          </p>
        </div>
      </div>
      <WhatsappQrCard />
    </div>
  );
}
