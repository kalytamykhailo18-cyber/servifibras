"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";
import Link from "next/link";
import Image from "next/image";
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import PeopleIcon from '@mui/icons-material/People';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import InstagramIcon from '@mui/icons-material/Instagram';
import FacebookIcon from '@mui/icons-material/Facebook';
import StorefrontIcon from '@mui/icons-material/Storefront';
import ShoppingBagIcon from '@mui/icons-material/ShoppingBag';
import ComputerIcon from '@mui/icons-material/Computer';
import CampaignIcon from '@mui/icons-material/Campaign';
import BarChartIcon from '@mui/icons-material/BarChart';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import RequestQuoteIcon from '@mui/icons-material/RequestQuote';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import CategoryIcon from '@mui/icons-material/Category';
import GroupIcon from '@mui/icons-material/Group';
import HistoryIcon from '@mui/icons-material/History';
import SettingsIcon from '@mui/icons-material/Settings';
import StarIcon from '@mui/icons-material/Star';
import LockIcon from '@mui/icons-material/Lock';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import HubIcon from '@mui/icons-material/Hub';
import VerifiedIcon from '@mui/icons-material/Verified';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import ShieldIcon from '@mui/icons-material/Shield';
import BoltIcon from '@mui/icons-material/Bolt';
import LayersIcon from '@mui/icons-material/Layers';

// ─────────────────────────────────────────────────────────────────────────
// Browser-frame mockup. Wraps a page screenshot in a stylized browser
// window with traffic lights + URL bar so the marketing visuals look
// like product previews rather than raw screenshots.
// ─────────────────────────────────────────────────────────────────────────
function BrowserFrame({
  src,
  alt,
  url = "dev.servifibras.com",
  accent = "from-blue-500 to-cyan-400",
}: {
  src: string;
  alt: string;
  url?: string;
  accent?: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_24px_60px_-12px_rgb(15_23_42/0.18),0_8px_20px_-6px_rgb(15_23_42/0.08)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-1 hover:shadow-[0_32px_80px_-16px_rgb(15_23_42/0.28)] sm:rounded-3xl">
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 -z-10 rounded-2xl bg-gradient-to-br ${accent} opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-30 sm:rounded-3xl`}
      />
      <div className="flex items-center gap-2 border-b border-slate-200/70 bg-gradient-to-b from-slate-50 to-slate-100/60 px-3 py-2.5 sm:px-4">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57] shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e] shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840] shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3)]" />
        </div>
        <div className="ml-3 hidden flex-1 sm:block">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-medium text-slate-500">
            <LockIcon sx={{ fontSize: 10 }} className="text-emerald-500" />
            {url}
          </span>
        </div>
      </div>
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-50">
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(min-width: 1024px) 720px, 100vw"
          className="object-cover object-top transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-[1.02]"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-white/40 to-transparent"
        />
      </div>
    </div>
  );
}

interface PageSectionProps {
  eyebrow: string;
  eyebrowIcon: any;
  eyebrowColor: string;
  title: string;
  body: string;
  bullets: string[];
  src: string;
  alt: string;
  accent: string;
  reverse?: boolean;
  bg?: string;
  id?: string;
}

function PageSection({
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  eyebrowColor,
  title,
  body,
  bullets,
  src,
  alt,
  accent,
  reverse = false,
  bg = "",
  id,
}: PageSectionProps) {
  return (
    <section id={id} className={`relative overflow-hidden px-6 py-20 sm:py-24 ${bg}`}>
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className={`order-1 ${reverse ? "lg:order-2" : ""}`}>
          <div className={`mb-5 inline-flex items-center gap-2 rounded-full border bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-wider backdrop-blur-sm ${eyebrowColor}`}>
            <EyebrowIcon sx={{ fontSize: 14 }} />
            {eyebrow}
          </div>
          <h2 className="mb-5 animate-fade-up text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
            {title}
          </h2>
          <p className="mb-6 animate-fade-up text-base leading-relaxed text-slate-600 [animation-delay:0.1s] sm:text-lg">
            {body}
          </p>
          <ul className="space-y-2.5">
            {bullets.map((b, i) => (
              <li
                key={b}
                className="flex animate-fade-up items-start gap-2.5 text-slate-700"
                style={{ animationDelay: `${0.2 + i * 0.08}s` }}
              >
                <CheckCircleIcon sx={{ fontSize: 20 }} className="mt-0.5 shrink-0 text-emerald-500" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={`order-2 ${reverse ? "lg:order-1" : ""}`}>
          <div className="animate-fade-up [animation-delay:0.25s]">
            <BrowserFrame src={src} alt={alt} accent={accent} />
          </div>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuthStore();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.push("/conversations");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* ─── Navigation — black bar with official Servifibras mark ─── */}
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-black bg-black animate-slide-down">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-12">
          <Link href="/" className="group flex items-center gap-2.5">
            <Image
              src="/servifibras-mark-inverted.png"
              alt="Servifibras"
              width={32}
              height={32}
              priority
              className="h-8 w-8 object-contain transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-[1.08]"
            />
            <span className="text-[1.05rem] font-semibold tracking-[0.04em] text-white">SERVIFIBRAS</span>
          </Link>

          <div className="hidden items-center gap-1 lg:flex">
            {[
              { label: "Producto", href: "#producto" },
              { label: "Canales", href: "#integrations" },
              { label: "IA", href: "#ai" },
              { label: "Equipo", href: "#roles" },
              { label: "Seguridad", href: "#security" },
              { label: "Precios", href: "#pricing" },
              { label: "FAQ", href: "#faq" },
            ].map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="group relative rounded-full px-3 py-2 text-sm font-medium text-white/75 transition-colors duration-300 hover:text-white"
              >
                {l.label}
                <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px origin-center scale-x-0 bg-gradient-to-r from-blue-400 to-cyan-300 transition-transform duration-300 ease-out group-hover:scale-x-100" />
              </a>
            ))}
          </div>

          <Link
            href="/login"
            className="group relative inline-flex h-9 items-center overflow-hidden rounded-full bg-white px-4 text-sm font-medium text-black shadow-[inset_0_1px_0_0_rgb(255_255_255/0.5),0_1px_3px_0_rgb(0_0_0/0.25)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:bg-slate-100 hover:shadow-[0_12px_30px_-6px_rgb(255_255_255/0.4)] active:translate-y-0 active:scale-[0.97] sm:px-5"
          >
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-black/10 to-transparent animate-shimmer" />
            <span className="relative">Acceder</span>
          </Link>
        </div>
      </nav>

      {/* ─── Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 pt-32 pb-20">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-32 top-10 h-80 w-80 rounded-full bg-blue-300/40 blur-3xl animate-blob" />
          <div className="absolute right-0 top-40 h-72 w-72 rounded-full bg-cyan-300/40 blur-3xl animate-blob [animation-delay:-6s]" />
          <div className="absolute bottom-10 left-1/3 h-96 w-96 rounded-full bg-indigo-300/30 blur-3xl animate-blob [animation-delay:-12s]" />
        </div>

        <div className="mx-auto max-w-6xl text-center">
          <div className="mb-7 inline-flex animate-fade-up [animation-delay:0.1s]">
            <span className="inline-flex items-center gap-2 rounded-full border border-blue-200/70 bg-blue-50/80 px-4 py-2 text-sm font-medium text-blue-700 backdrop-blur-sm shadow-[0_1px_2px_0_rgb(59_130_246/0.1)]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 inline-flex animate-ping rounded-full bg-blue-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-600" />
              </span>
              <AutoAwesomeIcon sx={{ fontSize: 16 }} />
              Atención al cliente con IA 24/7
            </span>
          </div>

          <h1 className="mb-6 text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
            <span className="block animate-fade-up [animation-delay:0.25s] bg-gradient-to-r from-slate-900 via-slate-700 to-slate-900 bg-clip-text text-transparent">
              Tu agente de IA experto en
            </span>
            <span className="mt-1 block animate-fade-up [animation-delay:0.45s] bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
              materiales compuestos
            </span>
          </h1>

          <p className="mx-auto mb-10 max-w-3xl animate-fade-up text-lg leading-relaxed text-slate-600 [animation-delay:0.65s] sm:text-xl">
            Automatiza consultas técnicas, genera cotizaciones inteligentes y convierte conversaciones
            en ventas. Integrado con WhatsApp, Instagram, Facebook, Mercado Libre y TiendaNube — un solo
            panel para todo tu equipo.
          </p>

          <div className="mb-12 flex animate-fade-up flex-wrap items-center justify-center gap-3 [animation-delay:0.85s]">
            <Link
              href="/login"
              className="group relative inline-flex h-14 items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 px-8 text-base font-medium text-white shadow-[0_8px_24px_-6px_rgb(59_130_246/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-1 hover:shadow-[0_18px_40px_-8px_rgb(59_130_246/0.7)] active:translate-y-0 active:scale-[0.97] sm:px-9 sm:text-lg"
            >
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
              <span className="relative">Acceder al sistema</span>
              <ArrowForwardIcon sx={{ fontSize: 22 }} className="relative transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
            <a
              href="#producto"
              className="inline-flex h-14 items-center rounded-full border border-slate-200 bg-white/70 px-6 text-base font-medium text-slate-700 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-white hover:text-blue-700 sm:px-7"
            >
              Ver el producto
            </a>
          </div>

          <div className="mx-auto max-w-5xl animate-fade-up [animation-delay:1.1s]">
            <BrowserFrame
              src="/landing/conversations.png"
              alt="Bandeja de conversaciones de Servifibras"
              url="dev.servifibras.com/conversations"
              accent="from-blue-500 to-cyan-400"
            />
          </div>
        </div>
      </section>

      {/* ─── Stats ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-r from-blue-600 to-cyan-500 px-6 py-16">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-20 left-10 h-60 w-60 rounded-full bg-white/10 blur-3xl animate-blob" />
          <div className="absolute -bottom-20 right-10 h-72 w-72 rounded-full bg-white/10 blur-3xl animate-blob [animation-delay:-9s]" />
        </div>

        <div className="relative mx-auto grid max-w-6xl grid-cols-2 gap-8 text-center text-white md:grid-cols-4">
          {[
            { num: '24/7', label: 'Atención continua', delay: '0s' },
            { num: '5', label: 'Canales conectados', delay: '0.1s' },
            { num: '600+', label: 'Mensajes / semana', delay: '0.2s' },
            { num: '95%', label: 'Respuestas automáticas', delay: '0.3s' },
          ].map((s) => (
            <div key={s.num} className="group animate-pop-in" style={{ animationDelay: s.delay }}>
              <div className="mb-2 text-4xl font-bold tracking-tight transition-transform duration-300 group-hover:scale-110 sm:text-5xl">
                {s.num}
              </div>
              <div className="text-sm text-blue-50/90 sm:text-base">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Product sections ──────────────────────────────────────── */}
      <div id="producto" className="border-b border-slate-200/60">
        <div className="mx-auto max-w-6xl px-6 py-16 text-center">
          <div className="mb-4 inline-flex animate-fade-up items-center gap-2 rounded-full border border-indigo-200/70 bg-indigo-50/80 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-700">
            <HubIcon sx={{ fontSize: 14 }} />
            La plataforma
          </div>
          <h2 className="mx-auto max-w-3xl animate-fade-up text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl [animation-delay:0.1s]">
            Cada página resuelve una parte del trabajo
          </h2>
          <p className="mx-auto mt-4 max-w-2xl animate-fade-up text-base text-slate-600 [animation-delay:0.2s] sm:text-lg">
            Diseñada para los cuatro roles del negocio — atención, ventas, logística y administración.
            Todas las pantallas están conectadas a la misma IA y al mismo CRM.
          </p>
        </div>
      </div>

      <PageSection
        eyebrow="Bandeja de conversaciones"
        eyebrowIcon={ChatBubbleOutlineIcon}
        eyebrowColor="border-blue-200/70 text-blue-700"
        title="Una sola bandeja para todos los canales"
        body="Cada conversación de WhatsApp, Instagram, Facebook, Mercado Libre y el webchat de tu tienda llega al mismo inbox. Los mensajes pendientes de atención humana saltan al tope automáticamente."
        bullets={[
          "Filtros por canal, estado y asignación",
          "Búsqueda full-text en mensajes encriptados",
          "Alertas en tiempo real cuando un cliente necesita un humano",
        ]}
        src="/landing/conversations.png"
        alt="Bandeja de conversaciones"
        accent="from-blue-500 to-cyan-400"
      />

      <PageSection
        eyebrow="Detalle de conversación"
        eyebrowIcon={SupportAgentIcon}
        eyebrowColor="border-cyan-200/70 text-cyan-700"
        title="Respondé con o sin IA, sin salir del chat"
        body="Cada conversación muestra el historial completo del cliente, sus pedidos, presupuestos y notas internas. Redactá manualmente, pedile a la IA que arme una respuesta o transferí a otro operador con una nota privada."
        bullets={[
          "Redacción asistida por Claude — pulí lo que escribas",
          "Adjuntá fotos, PDF, audios o presupuestos generados",
          "Transferencias entre roles con nota interna privada",
          "Pausa/reactiva la IA por conversación con un click",
        ]}
        src="/landing/conversation-detail.png"
        alt="Vista de conversación con composer y panel de contacto"
        accent="from-cyan-500 to-blue-500"
        reverse
        bg="bg-slate-50/60"
      />

      <PageSection
        eyebrow="Base de conocimiento"
        eyebrowIcon={MenuBookIcon}
        eyebrowColor="border-violet-200/70 text-violet-700"
        title="La IA aprende lo que vos le enseñás"
        body="Cargá artículos técnicos sobre resinas, fibras, cauchos, ratios de mezcla, recomendaciones por aplicación. Cada cambio se refleja en la próxima respuesta del agente — sin reentrenar nada."
        bullets={[
          "Categorización por familia de producto",
          "Cambios en caliente — sin reiniciar el sistema",
          "Soporte para texto largo, listas y datos técnicos",
        ]}
        src="/landing/knowledge.png"
        alt="Editor de base de conocimiento"
        accent="from-violet-500 to-purple-500"
      />

      <PageSection
        eyebrow="Pipeline de ventas"
        eyebrowIcon={TrendingUpIcon}
        eyebrowColor="border-orange-200/70 text-orange-700"
        title="Detectá oportunidades antes de que se enfríen"
        body="Cuando un cliente mayorista escribe — palabras clave, volumen pedido, mención de uso industrial — la IA lo deriva al equipo comercial al instante. Pipeline kanban con NUEVO → CONTACTADO → COTIZADO → NEGOCIANDO → GANADO / PERDIDO."
        bullets={[
          "Detección automática de mayoristas",
          "Drag-and-drop entre etapas del pipeline",
          "Recordatorios de seguimiento automáticos",
          "Estadísticas semanales por canal",
        ]}
        src="/landing/leads.png"
        alt="Pipeline kanban de oportunidades"
        accent="from-orange-500 to-red-400"
        reverse
        bg="bg-slate-50/60"
      />

      <PageSection
        eyebrow="Presupuestos"
        eyebrowIcon={RequestQuoteIcon}
        eyebrowColor="border-amber-200/70 text-amber-700"
        title="Cotizaciones PDF con tu formato oficial"
        body="Generá presupuestos PDF directamente desde la conversación, con tu logo, CUIT, IIBB y la numeración 0001-XXXXXXXX. Mandalos por WhatsApp con un click — el cliente los recibe como documento nativo."
        bullets={[
          "Formato AFIP-style con rectángulos anidados",
          "Numeración automática + fecha de emisión",
          "Envío directo al canal del cliente",
          "Histórico de presupuestos por contacto",
        ]}
        src="/landing/quotes.png"
        alt="Generador de presupuestos"
        accent="from-amber-500 to-yellow-400"
      />

      <PageSection
        eyebrow="Catálogo de productos"
        eyebrowIcon={CategoryIcon}
        eyebrowColor="border-cyan-200/70 text-cyan-700"
        title="SKU, precios y stock alimentando a la IA"
        body="676 productos sincronizados con TiendaNube en vivo. La IA ya no inventa precios ni stock — toma todo del catálogo real. Alertas de stock bajo a logística cuando un producto cae bajo su umbral."
        bullets={[
          "Sincronización en tiempo real con TiendaNube",
          "Precios en ARS, USD, con tipo de cambio del día",
          "Umbral de stock bajo configurable por producto",
          "Importación masiva por CSV",
        ]}
        src="/landing/products.png"
        alt="Catálogo de productos"
        accent="from-cyan-500 to-sky-400"
        reverse
        bg="bg-slate-50/60"
      />

      <PageSection
        eyebrow="Pedidos"
        eyebrowIcon={LocalShippingIcon}
        eyebrowColor="border-emerald-200/70 text-emerald-700"
        title="Del confirmado a la puerta del cliente"
        body="Registrá pedidos desde el chat con número, monto, productos y enlace a la conversación origen. Aldo recibe una alerta en tiempo real cuando un mayorista confirma. Estado de pedido automático cuando el cliente pregunta."
        bullets={[
          "Alta de pedidos desde la conversación",
          "Notificación automática a logística",
          "Respuesta automática de tracking al cliente",
          "Estados CONFIRMADO → PROCESANDO → DESPACHADO → ENTREGADO",
        ]}
        src="/landing/orders.png"
        alt="Lista de pedidos y estados de entrega"
        accent="from-green-500 to-emerald-400"
      />

      <PageSection
        eyebrow="Contactos + CRM"
        eyebrowIcon={PeopleIcon}
        eyebrowColor="border-emerald-200/70 text-emerald-700"
        title="Historial completo de cada cliente"
        body="Cada contacto guarda sus conversaciones, presupuestos, pedidos y notas internas. Clasificación automática: minorista, mayorista, industrial, emprendedor, artesano o proveedor. Reactivación de inactivos en cron."
        bullets={[
          "Clasificación 2D: tipo de cliente + etapa del embudo",
          "Reactivación automática de clientes dormidos",
          "Notas internas privadas al equipo",
          "Búsqueda por nombre, teléfono o email",
        ]}
        src="/landing/contacts.png"
        alt="Tabla de contactos clasificados"
        accent="from-emerald-500 to-teal-400"
        reverse
        bg="bg-slate-50/60"
      />

      <PageSection
        eyebrow="Analíticas en tiempo real"
        eyebrowIcon={BarChartIcon}
        eyebrowColor="border-pink-200/70 text-pink-700"
        title="Números que se actualizan mientras hablás"
        body="Métricas por rol — Brenda ve sus conversaciones, Franco sus oportunidades, Aldo sus pedidos pendientes. Calidad de atención evaluada por Claude en cada conversación cerrada con un score 1-10, fortalezas y mejora concreta."
        bullets={[
          "Tick en vivo cuando entra actividad",
          "Quality scoring de Claude por operador",
          "Patrones detectados cuando 3+ operadores repiten el mismo error",
          "Alertas graves separadas (precios incorrectos, promesas imposibles)",
        ]}
        src="/landing/analytics.png"
        alt="Panel de analíticas con KPIs y series temporales"
        accent="from-pink-500 to-rose-400"
      />

      <PageSection
        eyebrow="Campañas masivas"
        eyebrowIcon={CampaignIcon}
        eyebrowColor="border-fuchsia-200/70 text-fuchsia-700"
        title="Mensajes masivos a un segmento, no a una lista"
        body="Filtrá por tipo de cliente o etapa del embudo y mandá un mensaje template aprobado por Meta. Respeta la ventana de 24h y los rate limits de WhatsApp Business Platform — no te bloquean el número."
        bullets={[
          "Segmentación por customer type y funnel stage",
          "Templates Meta-aprobados",
          "Throttling automático para no superar rate limits",
          "Métricas de entrega y respuesta por campaña",
        ]}
        src="/landing/campaigns.png"
        alt="Composer de campañas masivas"
        accent="from-fuchsia-500 to-pink-500"
        reverse
        bg="bg-slate-50/60"
      />

      <PageSection
        eyebrow="Usuarios y roles"
        eyebrowIcon={GroupIcon}
        eyebrowColor="border-indigo-200/70 text-indigo-700"
        title="Cada quien ve lo suyo, exactamente"
        body="Cuatro roles cableados de punta a punta — administrador, atención, ventas, logística. Brenda no ve oportunidades; Franco no ve pedidos en tránsito; Aldo no edita la base de conocimiento. RBAC enforced en API y en UI."
        bullets={[
          "Permisos verificados en backend (no solo en UI)",
          "Filtrado por ownership en cada lista",
          "Sesiones JWT cortas con refresh-token rotativo",
          "Auditoría de cada acción privilegiada",
        ]}
        src="/landing/users.png"
        alt="Gestión de usuarios y roles"
        accent="from-indigo-500 to-violet-500"
      />

      <PageSection
        eyebrow="Auditoría"
        eyebrowIcon={HistoryIcon}
        eyebrowColor="border-slate-200 text-slate-700"
        title="Quién hizo qué, cuándo, desde dónde"
        body="Cada acción privilegiada queda registrada con usuario, IP, user-agent y metadatos. Búsqueda por acción o por usuario para resolver una duda en segundos. Solo lectura — nadie puede borrar el rastro."
        bullets={[
          "Logging exhaustivo de cambios de configuración",
          "Búsqueda por acción, usuario, fecha",
          "Retención larga para defensas al consumidor",
        ]}
        src="/landing/audit.png"
        alt="Registro de auditoría"
        accent="from-slate-500 to-zinc-500"
        reverse
        bg="bg-slate-50/60"
      />

      <PageSection
        eyebrow="Configuración"
        eyebrowIcon={SettingsIcon}
        eyebrowColor="border-slate-200 text-slate-700"
        title="Canales, IA y precios bajo tu control"
        body="Activá o desactivá canales con un toggle, ajustá el comportamiento de la IA, configurá descuentos por volumen y reglas de precios diferenciados. Cambios sin reiniciar — la plataforma los toma en caliente."
        bullets={[
          "Toggle de canal por proveedor (WhatsApp, FB, IG, ML, TN)",
          "Reglas de pricing — dólar blue, volumen, canal",
          "Configuración de la IA — modelo, presupuesto, prompts",
          "Integraciones OAuth con test de conexión",
        ]}
        src="/landing/settings.png"
        alt="Panel de configuración"
        accent="from-slate-600 to-zinc-500"
      />

      {/* ─── AI capabilities ────────────────────────────────────────── */}
      <section id="ai" className="relative overflow-hidden bg-slate-900 px-6 py-24">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/4 top-0 h-96 w-96 rounded-full bg-violet-500/20 blur-3xl animate-blob" />
          <div className="absolute right-0 bottom-0 h-80 w-80 rounded-full bg-cyan-500/20 blur-3xl animate-blob [animation-delay:-8s]" />
        </div>
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <div className="mb-4 inline-flex animate-fade-up items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-violet-200 backdrop-blur-sm">
              <AutoAwesomeIcon sx={{ fontSize: 14 }} />
              Inteligencia artificial
            </div>
            <h2 className="mx-auto max-w-3xl animate-fade-up text-3xl font-bold tracking-tight text-white sm:text-5xl [animation-delay:0.1s]">
              Claude debajo de cada respuesta
            </h2>
            <p className="mx-auto mt-4 max-w-2xl animate-fade-up text-base text-slate-300 [animation-delay:0.2s] sm:text-lg">
              Anthropic Claude leyendo tu base de conocimiento, tu catálogo, el historial del cliente y la
              conversación en vivo — todo en cada respuesta.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: AutoAwesomeIcon, title: "Detección de mayoristas", body: "Palabras clave + volumen pedido + uso industrial → derivación a Franco en milisegundos, sin cotizar el bot.", color: "from-orange-500 to-red-400" },
              { icon: SupportAgentIcon, title: "Handoff a humano", body: "Frases como 'quiero hablar con alguien' o un L3 (complaint) derivan al rol correcto con contexto completo.", color: "from-rose-500 to-pink-500" },
              { icon: StarIcon, title: "Quality scoring", body: "Cada conversación cerrada recibe un score 1-10 + 3 fortalezas + 1 mejora con la versión 'alternativa' del mensaje.", color: "from-amber-500 to-yellow-400" },
              { icon: BoltIcon, title: "Redacción asistida", body: "El operador escribe un borrador, Claude lo pule. O el operador no escribe nada y Claude sugiere.", color: "from-violet-500 to-purple-500" },
              { icon: TrendingUpIcon, title: "Clasificación 2D", body: "Cada contacto se clasifica por tipo (minorista/mayorista/industrial/...) y por etapa del embudo automáticamente.", color: "from-blue-500 to-cyan-400" },
              { icon: ShieldIcon, title: "Budget hard-stop", body: "Cap mensual de gasto en Claude configurable. Cuando se llega al cap, el sistema rechaza calls limpiamente.", color: "from-emerald-500 to-teal-400" },
            ].map((card, i) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.title}
                  className="group animate-fade-up rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm transition-all duration-500 hover:-translate-y-1 hover:border-white/20 hover:bg-white/10"
                  style={{ animationDelay: `${i * 0.08}s` }}
                >
                  <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${card.color} shadow-[0_8px_20px_-4px_rgb(15_23_42/0.4)]`}>
                    <Icon sx={{ fontSize: 24, color: "white" }} />
                  </div>
                  <h3 className="mb-2 text-lg font-bold text-white">{card.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-300">{card.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Channels strip ─────────────────────────────────────────── */}
      <section id="integrations" className="relative overflow-hidden bg-slate-50 px-6 py-24">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/4 top-1/2 h-80 w-80 rounded-full bg-blue-200/40 blur-3xl animate-float-slow" />
        </div>

        <div className="relative mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <div className="mb-4 inline-flex animate-fade-up items-center gap-2 rounded-full border border-blue-200/70 bg-blue-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-blue-700">
              <HubIcon sx={{ fontSize: 14 }} />
              Canales
            </div>
            <h2 className="mb-4 animate-fade-up text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl [animation-delay:0.1s]">
              Conectado a todos tus canales
            </h2>
            <p className="mx-auto max-w-2xl animate-fade-up text-base text-slate-600 [animation-delay:0.2s] sm:text-lg">
              Un solo sistema para gestionar WhatsApp, redes sociales y marketplaces
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-4">
            {[
              { Icon: WhatsAppIcon, color: '#25D366', name: 'WhatsApp', sub: 'Business Platform', halo: '37_211_102' },
              { Icon: InstagramIcon, color: '#E4405F', name: 'Instagram', sub: 'DMs y Comentarios', halo: '228_64_95' },
              { Icon: FacebookIcon, color: '#1877F2', name: 'Facebook', sub: 'Messenger', halo: '24_119_242' },
              { Icon: StorefrontIcon, color: '#FFE600', name: 'Mercado Libre', sub: 'Preguntas + Reviews', halo: '255_230_0' },
              { Icon: ShoppingBagIcon, color: '#9333ea', name: 'TiendaNube', sub: 'Sync de productos', halo: '147_51_234' },
              { Icon: ComputerIcon, color: '#06b6d4', name: 'Webchat', sub: 'Widget embebible', halo: '6_182_212' },
              { Icon: CampaignIcon, color: '#6366f1', name: 'Meta Ads', sub: 'Captura de leads', halo: '99_102_241' },
              { Icon: BarChartIcon, color: '#64748b', name: 'Analytics', sub: 'Métricas tiempo real', halo: '100_116_139' },
            ].map((c, i) => {
              const Icon = c.Icon;
              return (
                <div
                  key={c.name}
                  className="group relative animate-pop-in cursor-pointer overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-6 text-center shadow-[0_1px_3px_0_rgb(0_0_0/0.04)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-2 hover:border-transparent sm:p-8"
                  style={{
                    animationDelay: `${i * 0.07}s`,
                    ['--halo' as string]: c.halo,
                  }}
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 blur-md transition-opacity duration-500 group-hover:opacity-100"
                    style={{ boxShadow: `0 16px 40px -8px rgb(${c.halo} / 0.45)` }}
                  />
                  <div className="relative">
                    <div className="mb-3 flex justify-center transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:-translate-y-1 group-hover:scale-110">
                      <Icon sx={{ fontSize: 48 }} className="sm:[font-size:56px]" style={{ color: c.color }} />
                    </div>
                    <h4 className="font-bold text-slate-900">{c.name}</h4>
                    <p className="mt-1 text-xs text-slate-600 sm:text-sm">{c.sub}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Roles & permissions ─────────────────────────────────────── */}
      <section id="roles" className="relative overflow-hidden px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <div className="mb-4 inline-flex animate-fade-up items-center gap-2 rounded-full border border-indigo-200/70 bg-indigo-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-700">
              <GroupIcon sx={{ fontSize: 14 }} />
              Tu equipo
            </div>
            <h2 className="animate-fade-up text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl [animation-delay:0.1s]">
              Cuatro roles, una sola plataforma
            </h2>
            <p className="mx-auto mt-4 max-w-2xl animate-fade-up text-base text-slate-600 [animation-delay:0.2s] sm:text-lg">
              Cada miembro del equipo entra y ve exactamente lo que necesita — nada más, nada menos.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { title: "Administrador", emoji: "AD", color: "from-slate-600 to-slate-800", bullets: ["Acceso total", "Métricas del equipo", "Configuración del sistema", "Auditoría"] },
              { title: "Atención (Brenda)", emoji: "BR", color: "from-blue-500 to-cyan-400", bullets: ["Bandeja de conversaciones", "Responder con o sin IA", "Transferir a otros roles", "Sin acceso a leads ni pedidos"] },
              { title: "Ventas (Franco)", emoji: "FR", color: "from-emerald-500 to-teal-400", bullets: ["Pipeline de oportunidades", "Cotizaciones y presupuestos", "Mayoristas detectados", "Sus propias conversaciones"] },
              { title: "Logística (Aldo)", emoji: "AL", color: "from-amber-500 to-orange-400", bullets: ["Cola de pedidos", "Tracking y despacho", "Alertas de stock bajo", "Notificaciones de mayoristas"] },
            ].map((r, i) => (
              <div
                key={r.title}
                className="group animate-fade-up rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_3px_0_rgb(0_0_0/0.04)] transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_24px_60px_-12px_rgb(15_23_42/0.18)]"
                style={{ animationDelay: `${i * 0.08}s` }}
              >
                <div className={`mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br ${r.color} text-base font-bold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(15_23_42/0.25)]`}>
                  {r.emoji}
                </div>
                <h3 className="mb-3 text-lg font-bold text-slate-900">{r.title}</h3>
                <ul className="space-y-1.5 text-sm text-slate-600">
                  {r.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-1.5">
                      <CheckCircleIcon sx={{ fontSize: 14 }} className="mt-0.5 shrink-0 text-emerald-500" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Mobile ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-slate-50/60 px-6 py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-200/70 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-cyan-700">
              <SmartphoneIcon sx={{ fontSize: 14 }} />
              Mobile-first
            </div>
            <h2 className="mb-5 animate-fade-up text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
              Tu negocio en el bolsillo
            </h2>
            <p className="mb-6 animate-fade-up text-base leading-relaxed text-slate-600 [animation-delay:0.1s] sm:text-lg">
              Toda la plataforma corre en tu celular como una app nativa. Drawer de navegación, composer
              optimizado para pantallas chicas, toques grandes para los dedos. No es una versión recortada
              — es la misma plataforma adaptada.
            </p>
            <ul className="space-y-2.5">
              {["Drawer lateral con todos los canales", "Composer adaptado al ancho del teléfono", "Notificaciones en tiempo real", "Funciona en datos móviles"].map((b, i) => (
                <li key={b} className="flex animate-fade-up items-start gap-2.5 text-slate-700" style={{ animationDelay: `${0.2 + i * 0.08}s` }}>
                  <CheckCircleIcon sx={{ fontSize: 20 }} className="mt-0.5 shrink-0 text-emerald-500" />
                  {b}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-center">
            <div className="relative animate-fade-up [animation-delay:0.25s]">
              {/* ─── Realistic phone shape ─────────────────────────────────
                  Includes: volume up/down on left, power on right, notch +
                  camera dot on top, system status bar (time + signal + wifi
                  + bluetooth + battery %), Android nav (◁ ○ □) at bottom,
                  subtle glass reflection across the screen.
                  ────────────────────────────────────────────────────────── */}
              <div className="relative w-[280px] sm:w-[320px]">
                {/* ─── Side buttons — protrude visibly from the frame ───── */}
                {/* Volume up (left, upper) */}
                <span
                  aria-hidden
                  className="absolute left-0 top-[22%] -translate-x-full h-12 w-1 rounded-l-md bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.12)]"
                />
                {/* Volume down (left, just below volume up) */}
                <span
                  aria-hidden
                  className="absolute left-0 top-[34%] -translate-x-full h-12 w-1 rounded-l-md bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.12)]"
                />
                {/* Power (right, mid-upper, longer than vol buttons) */}
                <span
                  aria-hidden
                  className="absolute right-0 top-[26%] translate-x-full h-16 w-1 rounded-r-md bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.12)]"
                />

                {/* Outer bezel */}
                <div className="relative rounded-[2.5rem] border-[10px] border-slate-900 bg-slate-900 p-0 shadow-[0_30px_60px_-12px_rgb(15_23_42/0.45),inset_0_0_0_1px_rgb(255_255_255/0.06)]">
                  {/* Inner screen — portrait aspect ratio ≈19.5:9, real phone */}
                  <div className="relative overflow-hidden rounded-[1.85rem] bg-white aspect-[9/19.5]">
                    {/* ── System status bar (dark, on top of the bezel area)
                          Sits at the very top of the screen, in front of the
                          page screenshot, with the dynamic-island pill set
                          inside it so it never hides time/icons. ──────────── */}
                    <div className="absolute inset-x-0 top-0 z-40 flex h-7 items-center justify-between bg-slate-900 px-4 text-[10px] font-semibold leading-none text-white">
                      <span className="tabular-nums">9:41</span>

                      {/* Dynamic island — small pill, doesn't overlap text */}
                      <span aria-hidden className="absolute left-1/2 top-1/2 h-3.5 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]">
                        <span className="absolute right-1.5 top-1/2 block h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-slate-700 ring-1 ring-slate-500/40" />
                      </span>

                      <div className="flex items-center gap-1">
                        {/* Signal — 4 ascending bars */}
                        <svg viewBox="0 0 16 12" className="h-3 w-[14px] fill-current" aria-hidden>
                          <rect x="0" y="8.5" width="2.4" height="3.5" rx="0.4" />
                          <rect x="3.6" y="6" width="2.4" height="6" rx="0.4" />
                          <rect x="7.2" y="3.5" width="2.4" height="8.5" rx="0.4" />
                          <rect x="10.8" y="1" width="2.4" height="11" rx="0.4" />
                        </svg>
                        {/* WiFi — three arcs + dot */}
                        <svg viewBox="0 0 16 12" className="h-3 w-[14px] fill-current" aria-hidden>
                          <path d="M8 11.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z" />
                          <path d="M3.2 6.6c2.8-2.6 6.8-2.6 9.6 0l-1.5 1.5c-2.0-1.8-4.6-1.8-6.6 0L3.2 6.6z" />
                          <path d="M.4 3.8c4.2-4 11-4 15.2 0l-1.5 1.5C10.5 2.0 5.5 2.0 1.9 5.3L.4 3.8z" />
                        </svg>
                        {/* Bluetooth — classic B-rune */}
                        <svg viewBox="0 0 16 16" className="h-3 w-3 stroke-current" aria-hidden fill="none" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
                          <path d="M5 4.5 11 11.5 8 14V2l3 2.5L5 11.5" />
                        </svg>
                        {/* Battery — 78% + body + cap */}
                        <span className="ml-1 inline-flex items-center gap-1 leading-none">
                          <span className="tabular-nums">78%</span>
                          <span className="relative inline-flex h-2.5 w-5 items-center rounded-[2px] border border-current p-px">
                            <span className="block h-full w-[78%] rounded-[1px] bg-current" />
                          </span>
                          <span className="-ml-0.5 h-1 w-0.5 rounded-r-sm bg-current" />
                        </span>
                      </div>
                    </div>

                    {/* Page screenshot — REAL mobile viewport capture of the
                        responsive /conversations page, fills below status bar */}
                    <Image
                      src="/landing/mobile-chat.png"
                      alt="Servifibras en móvil — chat real con cliente"
                      fill
                      sizes="(min-width: 1024px) 320px, 70vw"
                      className="object-cover object-top pt-7"
                    />

                    {/* Android nav bar — back triangle / home circle / recents square */}
                    <div className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-around bg-slate-900/95 py-2 backdrop-blur-sm" aria-hidden>
                      {/* Back — triangle pointing left */}
                      <span className="grid h-6 w-6 place-items-center text-white/85">
                        <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current">
                          <polygon points="11.5,2.5 11.5,13.5 3,8" />
                        </svg>
                      </span>
                      {/* Home — circle */}
                      <span className="grid h-6 w-6 place-items-center text-white/85">
                        <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current">
                          <circle cx="8" cy="8" r="6" />
                        </svg>
                      </span>
                      {/* Recents — square */}
                      <span className="grid h-6 w-6 place-items-center text-white/85">
                        <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current">
                          <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
                        </svg>
                      </span>
                    </div>

                    {/* Glass reflection — subtle highlight strip across the
                        upper half of the screen */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 z-20 bg-gradient-to-br from-white/8 via-transparent to-transparent"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Security ────────────────────────────────────────────────── */}
      <section id="security" className="relative overflow-hidden px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <div className="mb-4 inline-flex animate-fade-up items-center gap-2 rounded-full border border-emerald-200/70 bg-emerald-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700">
              <ShieldIcon sx={{ fontSize: 14 }} />
              Seguridad
            </div>
            <h2 className="animate-fade-up text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl [animation-delay:0.1s]">
              Conversaciones encriptadas. Sesiones cortas. Auditoría completa.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl animate-fade-up text-base text-slate-600 [animation-delay:0.2s] sm:text-lg">
              Cada decisión de arquitectura está pensada para que cuando crezcas, no tengas que reescribir
              nada para pasar una auditoría.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: LockIcon, title: "AES-256-GCM en reposo", body: "Todos los mensajes y notas internas se guardan encriptados en PostgreSQL. Rotación de claves soportada." },
              { icon: VerifiedIcon, title: "JWT cortos + refresh rotativo", body: "Access token de 15 minutos. Refresh token con family-tracking para revocar sesiones comprometidas." },
              { icon: LayersIcon, title: "RBAC en cuatro capas", body: "Filtro en sidebar, route guard, API guard, scoping por ownership. No alcanza con una sola capa." },
              { icon: HistoryIcon, title: "Backups diarios", body: "Dump completo de Postgres cada noche a las 03:15 UTC. Retención de 14 días configurable." },
              { icon: ShieldIcon, title: "HTTPS + HSTS", body: "Caddy auto-renueva certificados Let's Encrypt. HSTS 6 meses, X-Frame-Options SAMEORIGIN, Referrer-Policy estricta." },
              { icon: HistoryIcon, title: "Audit log", body: "Cada acción privilegiada queda registrada con IP, user-agent y metadatos. Inmutable, búsqueda full-text." },
            ].map((card, i) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.title}
                  className="group animate-fade-up rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_3px_0_rgb(0_0_0/0.04)] transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_18px_40px_-12px_rgb(15_23_42/0.18)]"
                  style={{ animationDelay: `${i * 0.07}s` }}
                >
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(16_185_129/0.45)]">
                    <Icon sx={{ fontSize: 20 }} />
                  </div>
                  <h3 className="mb-2 text-base font-bold text-slate-900">{card.title}</h3>
                  <p className="text-sm leading-relaxed text-slate-600">{card.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Architecture ───────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-slate-50/60 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <div className="mb-4 inline-flex animate-fade-up items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700">
              <HubIcon sx={{ fontSize: 14 }} />
              Arquitectura
            </div>
            <h2 className="animate-fade-up text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl [animation-delay:0.1s]">
              Modular para sumar canales sin reescribir nada
            </h2>
            <p className="mx-auto mt-4 max-w-2xl animate-fade-up text-base text-slate-600 [animation-delay:0.2s] sm:text-lg">
              Clean architecture en cuatro capas. Agregar TikTok, Telegram o un agente de voz es sumar un
              adaptador — no reescribir el núcleo.
            </p>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_3px_0_rgb(0_0_0/0.05)] sm:p-10">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
              {[
                { layer: "domain/", body: "Entidades de negocio puras. Sin dependencias externas.", tint: "from-blue-500 to-cyan-400" },
                { layer: "use-cases/", body: "Interfaces de aplicación. Define qué se puede hacer.", tint: "from-violet-500 to-purple-500" },
                { layer: "adapters/", body: "Implementaciones — channel adapters, AI, repositorios.", tint: "from-amber-500 to-orange-400" },
                { layer: "infrastructure/", body: "Controllers, modules NestJS, guards, gateways Socket.io.", tint: "from-emerald-500 to-teal-400" },
              ].map((row, i) => (
                <div
                  key={row.layer}
                  className="group relative animate-fade-up rounded-2xl border border-slate-200/70 bg-slate-50/60 p-5 transition-all duration-500 hover:-translate-y-1 hover:border-transparent hover:shadow-[0_18px_40px_-12px_rgb(15_23_42/0.15)]"
                  style={{ animationDelay: `${i * 0.1}s` }}
                >
                  <span
                    aria-hidden
                    className={`pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br ${row.tint} opacity-0 transition-opacity duration-500 group-hover:opacity-[0.08]`}
                  />
                  <div className="relative">
                    <span className={`mb-3 inline-flex items-center rounded-md bg-gradient-to-r ${row.tint} px-2 py-0.5 font-mono text-[11px] font-semibold text-white`}>
                      {row.layer}
                    </span>
                    <p className="text-sm leading-relaxed text-slate-600">{row.body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 border-t border-slate-200/70 pt-6 text-xs text-slate-500">
              {["NestJS", "Next.js 16", "Prisma 5", "PostgreSQL 16", "Socket.io", "Anthropic Claude", "Tailwind 4", "Caddy"].map((t) => (
                <span key={t} className="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono">{t}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Pricing / Phases ─────────────────────────────────────────── */}
      <section id="pricing" className="relative overflow-hidden px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <div className="mb-4 inline-flex animate-fade-up items-center gap-2 rounded-full border border-amber-200/70 bg-amber-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700">
              <RocketLaunchIcon sx={{ fontSize: 14 }} />
              Implementación
            </div>
            <h2 className="animate-fade-up text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl [animation-delay:0.1s]">
              Entrega por fases, pago por entrega
            </h2>
            <p className="mx-auto mt-4 max-w-2xl animate-fade-up text-base text-slate-600 [animation-delay:0.2s] sm:text-lg">
              No pagás un mes de SaaS. Pagás la plataforma una vez, queda tuya — código y datos.
              30 días de garantía de bugs sin costo en cada fase.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
            {[
              { phase: "Fase 1", price: "USD 2.500", title: "Núcleo", body: "Agente IA en los cinco canales, CRM con cuatro roles, panel admin con KB editor, métricas en tiempo real, sync TiendaNube.", color: "from-blue-500 to-cyan-400" },
              { phase: "Fase 2", price: "USD 1.000", title: "Automatizaciones", body: "Follow-ups, reactivación, respuestas a reviews ML, notificaciones a logística, alertas de stock bajo, tracking automático.", color: "from-violet-500 to-purple-500" },
              { phase: "Fase 3", price: "USD 1.200", title: "Administración + Marketing", body: "PDFs de presupuestos, registro de pedidos en CRM, reportes semanales, captura de leads Meta Ads, campañas masivas.", color: "from-orange-500 to-red-400" },
              { phase: "Fase 4", price: "USD 800", title: "Canales + Seguridad", body: "Webchat embebible en TiendaNube, encriptación de conversaciones, backups, rate limiting, HTTPS y documentación técnica.", color: "from-emerald-500 to-teal-400" },
            ].map((p, i) => (
              <div
                key={p.phase}
                className="group relative animate-fade-up overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_3px_0_rgb(0_0_0/0.04)] transition-all duration-500 hover:-translate-y-2 hover:border-transparent hover:shadow-[0_24px_60px_-12px_rgb(15_23_42/0.18)]"
                style={{ animationDelay: `${i * 0.1}s` }}
              >
                <span aria-hidden className={`pointer-events-none absolute -top-1 left-0 right-0 h-1 bg-gradient-to-r ${p.color}`} />
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{p.phase}</div>
                <div className={`mb-4 bg-gradient-to-r ${p.color} bg-clip-text text-3xl font-bold tracking-tight text-transparent`}>
                  {p.price}
                </div>
                <h3 className="mb-2 text-lg font-bold text-slate-900">{p.title}</h3>
                <p className="text-sm leading-relaxed text-slate-600">{p.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-slate-200/70 bg-slate-50 p-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200/70 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
              <CheckCircleIcon sx={{ fontSize: 14 }} />
              30 días de garantía
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-blue-200/70 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">
              <VerifiedIcon sx={{ fontSize: 14 }} />
              Código y datos tuyos
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-200/70 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700">
              <BoltIcon sx={{ fontSize: 14 }} />
              Mantenimiento opcional USD 400/mes
            </span>
          </div>
        </div>
      </section>

      {/* ─── FAQ ──────────────────────────────────────────────────────── */}
      <section id="faq" className="relative overflow-hidden bg-slate-50/60 px-6 py-24">
        <div className="mx-auto max-w-3xl">
          <div className="mb-12 text-center">
            <h2 className="animate-fade-up text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Preguntas frecuentes
            </h2>
          </div>

          <div className="space-y-3">
            {[
              { q: "¿Qué pasa con los datos cuando termina la garantía?", a: "Quedan tuyos. La plataforma corre en tu propio servidor (o en uno administrado), con tu PostgreSQL. No hay vendor lock-in, no hay export que firmar — es tu base de datos." },
              { q: "¿Cuánto cuesta operar la IA por mes?", a: "Depende del volumen. A ~95 mensajes/hora con un prompt completo (KB + catálogo + historial), proyecta ~USD 60/día. El cap mensual de Claude es configurable en .env y el hard-stop evita sorpresas en la factura." },
              { q: "¿Cuántos canales puedo agregar?", a: "Los 5 ya integrados (WhatsApp, FB, IG, ML, TN webchat) más cualquier otro con un adaptador. La arquitectura modular soporta TikTok, Telegram o un agente de voz sin reescribir el núcleo — solo sumás otro módulo." },
              { q: "¿Tengo que migrar de prometheo todo de golpe?", a: "No. Los dos sistemas corren en paralelo durante el período de validación. Cuando estás cómodo, el cutover es flip de webhook en un click — y la reversión a prometheo es igual de rápida si algo falla." },
              { q: "¿La IA realmente entiende sobre fibra de vidrio, resinas y siliconas?", a: "Anthropic Claude Sonnet 4.6 con el contexto de tu base de conocimiento, tu catálogo de productos (676 SKUs sincronizados con TiendaNube) y el historial del cliente — sí. La IA no inventa precios ni stock, los lee de la tabla. La parte técnica la enseñás vos via el editor de KB." },
              { q: "¿Y la verificación del negocio en Meta?", a: "Es un trámite Meta-side (CUIT, dirección, sitio web público). El bot funciona sin verificación, con límites de volumen menores. Una vez aprobado por Meta, los límites desaparecen y se habilitan templates + Click-to-WhatsApp." },
              { q: "¿Quién mantiene el código después de la entrega?", a: "El proyecto se entrega con documentación técnica completa — arquitectura, runbook, lista de envs, channel onboarding y handoff para el próximo dev. Mantenimiento mensual opcional (USD 400) cubre Node/Claude/Meta updates y soporte para ajustes menores." },
            ].map((f, i) => (
              <details
                key={f.q}
                className="group animate-fade-up rounded-2xl border border-slate-200/80 bg-white p-5 transition-all duration-300 hover:border-slate-300"
                style={{ animationDelay: `${i * 0.05}s` }}
              >
                <summary className="flex cursor-pointer items-start justify-between gap-3 font-semibold text-slate-900">
                  <span className="text-sm sm:text-base">{f.q}</span>
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition-transform duration-300 group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Bottom CTA ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 px-6 py-24">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-20 top-10 h-80 w-80 rounded-full bg-white/15 blur-3xl animate-blob" />
          <div className="absolute -right-20 bottom-10 h-96 w-96 rounded-full bg-cyan-200/20 blur-3xl animate-blob [animation-delay:-8s]" />
        </div>

        <div className="relative mx-auto max-w-4xl text-center text-white">
          <h2 className="mb-6 animate-fade-up text-3xl font-bold tracking-tight sm:text-5xl">
            ¿Listo para automatizar tu atención al cliente?
          </h2>
          <p className="mb-10 animate-fade-up text-lg text-blue-50/90 [animation-delay:0.15s] sm:text-xl">
            Accede al panel y gestioná todas tus conversaciones, leads y pedidos en un solo lugar.
          </p>

          <Link
            href="/login"
            className="group relative inline-flex h-14 animate-fade-up items-center gap-2 overflow-hidden rounded-full bg-white px-8 text-base font-medium text-blue-600 shadow-[0_10px_30px_-6px_rgb(0_0_0/0.3)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] [animation-delay:0.3s] hover:-translate-y-1 hover:shadow-[0_22px_50px_-8px_rgb(0_0_0/0.4)] active:translate-y-0 active:scale-[0.97] sm:px-9 sm:text-lg"
          >
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-blue-200/60 to-transparent animate-shimmer" />
            <span className="relative">Acceder al sistema</span>
            <ArrowForwardIcon sx={{ fontSize: 22 }} className="relative transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────────── */}
      <footer className="bg-slate-900 px-6 py-12 text-slate-300">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 grid animate-fade-in grid-cols-1 gap-8 md:grid-cols-4">
            <div>
              <div className="mb-4 flex items-center gap-2.5">
                <Image
                  src="/servifibras-mark-inverted.png"
                  alt="Servifibras"
                  width={32}
                  height={32}
                  className="h-8 w-8 object-contain"
                />
                <span className="text-xl font-bold tracking-[0.04em] text-white">SERVIFIBRAS</span>
              </div>
              <p className="text-sm text-slate-400">
                Plataforma de atención al cliente con inteligencia artificial para materiales compuestos.
              </p>
            </div>

            {[
              { title: 'Producto', items: [
                { label: 'Bandeja de conversaciones', href: '#producto' },
                { label: 'Base de conocimiento', href: '#producto' },
                { label: 'Pipeline de ventas', href: '#producto' },
                { label: 'Analíticas', href: '#producto' },
                { label: 'Canales', href: '#integrations' },
                { label: 'Panel admin', href: '/login', isLink: true },
              ]},
              { title: 'Plataforma', items: [
                { label: 'IA y modelos', href: '#ai' },
                { label: 'Equipo y roles', href: '#roles' },
                { label: 'Seguridad', href: '#security' },
                { label: 'Precios', href: '#pricing' },
                { label: 'Preguntas frecuentes', href: '#faq' },
              ]},
              { title: 'Soporte', items: [
                { label: 'Documentación', href: '#' },
                { label: 'Centro de ayuda', href: '#' },
                { label: 'Contacto', href: '#' },
                { label: 'Términos', href: '#' },
                { label: 'Privacidad', href: '#' },
              ]},
            ].map((col) => (
              <div key={col.title}>
                <h4 className="mb-4 font-bold text-white">{col.title}</h4>
                <ul className="space-y-2 text-sm">
                  {col.items.map((it: any) => {
                    const className = "group relative inline-flex text-slate-400 transition-colors duration-300 hover:text-white";
                    const inner = (
                      <>
                        {it.label}
                        <span className="pointer-events-none absolute inset-x-0 -bottom-0.5 h-px origin-left scale-x-0 bg-gradient-to-r from-blue-400 to-cyan-300 transition-transform duration-300 group-hover:scale-x-100" />
                      </>
                    );
                    return (
                      <li key={it.label}>
                        {it.isLink ? (
                          <Link href={it.href} className={className}>{inner}</Link>
                        ) : (
                          <a href={it.href} className={className}>{inner}</a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-800 pt-8 text-center text-sm text-slate-500">
            <p>&copy; 2026 Servifibras. Todos los derechos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
