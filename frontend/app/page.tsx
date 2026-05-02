"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";
import Link from "next/link";
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

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuthStore();

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.push("/conversations");
    }
  }, [isAuthenticated, isLoading, router]);

  // Show loading or nothing while redirecting
  if (isLoading || isAuthenticated) {
    return null;
  }
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Navigation */}
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-slate-900/[0.06] bg-white/70 backdrop-blur-2xl backdrop-saturate-150 animate-slide-down">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          {/* Logo — breathing glow + gentle float, hover scale/rotate */}
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="animate-float">
              <span className="relative grid h-8 w-8 place-items-center rounded-[0.55rem] bg-gradient-to-br from-blue-500 to-cyan-400 animate-glow-pulse transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-[1.12]">
                <span className="text-sm font-bold tracking-tight text-white">S</span>
                <span className="pointer-events-none absolute inset-0 rounded-[0.55rem] bg-gradient-to-b from-white/30 to-transparent" />
              </span>
            </span>
            {/* Wordmark — vivid blue→cyan→indigo gradient, continuous sweep */}
            <span className="text-[1.05rem] font-semibold tracking-tight text-slate-900">
              Servifibras
            </span>
          </Link>

          {/* Pill links — animated underline grows from center */}
          <div className="hidden items-center gap-1 md:flex">
            <a
              href="#features"
              className="group relative rounded-full px-4 py-2 text-sm font-medium text-slate-600 transition-colors duration-300 hover:text-slate-900"
            >
              Funcionalidades
              <span className="pointer-events-none absolute inset-x-4 bottom-1 h-px origin-center scale-x-0 bg-gradient-to-r from-blue-500 to-cyan-400 transition-transform duration-300 ease-out group-hover:scale-x-100" />
            </a>
            <a
              href="#integrations"
              className="group relative rounded-full px-4 py-2 text-sm font-medium text-slate-600 transition-colors duration-300 hover:text-slate-900"
            >
              Integraciones
              <span className="pointer-events-none absolute inset-x-4 bottom-1 h-px origin-center scale-x-0 bg-gradient-to-r from-blue-500 to-cyan-400 transition-transform duration-300 ease-out group-hover:scale-x-100" />
            </a>
          </div>

          {/* CTA — continuous shimmer + lift on hover + press feedback */}
          <Link
            href="/login"
            className="group relative inline-flex h-9 items-center overflow-hidden rounded-full bg-slate-900 px-5 text-sm font-medium text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.12),0_1px_3px_0_rgb(0_0_0/0.1)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.20),0_12px_30px_-6px_rgb(15_23_42/0.55)] active:translate-y-0 active:scale-[0.97]"
          >
            {/* Always-running shimmer band */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer"
            />
            <span className="relative">Acceder al Panel</span>
          </Link>
        </div>
      </nav>

      {/* ─── Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 pt-32 pb-24">
        {/* Animated background blobs */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-32 top-10 h-80 w-80 rounded-full bg-blue-300/40 blur-3xl animate-blob" />
          <div className="absolute right-0 top-40 h-72 w-72 rounded-full bg-cyan-300/40 blur-3xl animate-blob [animation-delay:-6s]" />
          <div className="absolute bottom-10 left-1/3 h-96 w-96 rounded-full bg-indigo-300/30 blur-3xl animate-blob [animation-delay:-12s]" />
        </div>

        <div className="mx-auto max-w-6xl text-center">
          {/* Badge — fade-up + soft pulse */}
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

          {/* H1 — line 1 fade-up, line 2 gradient sweeping continuously */}
          <h1 className="mb-6 text-6xl font-bold leading-[1.05] tracking-tight md:text-7xl">
            <span className="block animate-fade-up [animation-delay:0.25s] bg-gradient-to-r from-slate-900 via-slate-700 to-slate-900 bg-clip-text text-transparent">
              Tu agente de IA experto en
            </span>
            <span className="mt-1 block animate-fade-up [animation-delay:0.45s] bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
              materiales compuestos
            </span>
          </h1>

          {/* Subtitle */}
          <p className="mx-auto mb-10 max-w-3xl animate-fade-up text-xl leading-relaxed text-slate-600 [animation-delay:0.65s]">
            Automatiza consultas técnicas, genera cotizaciones inteligentes y convierte conversaciones
            en ventas. Integrado con WhatsApp, Instagram, Facebook y MercadoLibre.
          </p>

          {/* CTA — gradient bg, continuous shimmer, lift, press, glow halo */}
          <div className="mb-12 animate-fade-up [animation-delay:0.85s]">
            <Link
              href="/login"
              className="group relative inline-flex h-14 items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 px-9 text-lg font-medium text-white shadow-[0_8px_24px_-6px_rgb(59_130_246/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-1 hover:shadow-[0_18px_40px_-8px_rgb(59_130_246/0.7)] active:translate-y-0 active:scale-[0.97]"
            >
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
              <span className="relative">Acceder al sistema</span>
              <ArrowForwardIcon sx={{ fontSize: 22 }} className="relative transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </div>

          {/* Live indicator */}
          <div className="flex animate-fade-up items-center justify-center gap-2 text-sm text-slate-500 [animation-delay:1.05s]">
            <PeopleIcon sx={{ fontSize: 16 }} />
            Atendiendo +600 conversaciones semanales
          </div>

          {/* Scroll cue */}
          <div aria-hidden className="mt-16 flex animate-fade-in justify-center [animation-delay:1.4s]">
            <span className="flex h-9 w-5 justify-center rounded-full border border-slate-300 pt-1.5">
              <span className="h-2 w-px animate-bounce rounded-full bg-slate-400" />
            </span>
          </div>
        </div>
      </section>

      {/* ─── Stats — animated gradient bg, pop-in numbers ────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-r from-blue-600 to-cyan-500 px-6 py-16">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-20 left-10 h-60 w-60 rounded-full bg-white/10 blur-3xl animate-blob" />
          <div className="absolute -bottom-20 right-10 h-72 w-72 rounded-full bg-white/10 blur-3xl animate-blob [animation-delay:-9s]" />
        </div>

        <div className="relative mx-auto grid max-w-6xl grid-cols-2 gap-8 text-center text-white md:grid-cols-4">
          {[
            { num: '24/7', label: 'Atención continua', delay: '0s' },
            { num: '88%', label: 'WhatsApp Business', delay: '0.1s' },
            { num: '6K+', label: 'Mensajes por semana', delay: '0.2s' },
            { num: '95%', label: 'Respuestas automáticas', delay: '0.3s' },
          ].map((s) => (
            <div
              key={s.num}
              className="group animate-pop-in"
              style={{ animationDelay: s.delay }}
            >
              <div className="mb-2 text-5xl font-bold tracking-tight transition-transform duration-300 group-hover:scale-110">
                {s.num}
              </div>
              <div className="text-blue-50/90">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Features — staggered fade-up cards, icon glow on hover ─── */}
      <section id="features" className="relative overflow-hidden px-6 py-24">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute right-0 top-1/3 h-96 w-96 rounded-full bg-blue-100/60 blur-3xl animate-float-slow" />
        </div>

        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 animate-fade-up text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">
              Funcionalidades potenciadas por IA
            </h2>
            <p className="mx-auto max-w-2xl animate-fade-up text-xl text-slate-600 [animation-delay:0.15s]">
              Todo lo que necesitas para automatizar tu atención al cliente y aumentar tus ventas
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            {[
              {
                icon: ChatBubbleOutlineIcon,
                gradient: 'from-blue-500 to-cyan-400',
                glow: '59_130_246',
                title: 'Consultas técnicas automatizadas',
                body: 'El agente responde preguntas sobre resinas, fibra de vidrio y cauchos de silicona con precisión técnica usando una base de conocimiento especializada.',
                items: ['Respuestas técnicas 24/7', 'Base de conocimiento actualizable', 'Recomendaciones de productos'],
                delay: '0s',
              },
              {
                icon: FlashOnIcon,
                gradient: 'from-purple-500 to-pink-400',
                glow: '168_85_247',
                title: 'Cotizaciones en tiempo real',
                body: 'Genera presupuestos automáticos aplicando tipo de cambio del día, volumen de compra y canal de venta. Sincronizado con TiendaNube.',
                items: ['Dólar blue actualizado', 'Descuentos por volumen automáticos', 'Precios diferenciados por canal'],
                delay: '0.15s',
              },
              {
                icon: TrendingUpIcon,
                gradient: 'from-orange-500 to-red-400',
                glow: '249_115_22',
                title: 'Identificación de leads mayoristas',
                body: 'Detecta automáticamente clientes de alto valor y los deriva al equipo comercial con toda la información relevante.',
                items: ['Clasificación automática', 'Derivación a ventas', 'Pipeline de oportunidades'],
                delay: '0.3s',
              },
              {
                icon: ShoppingCartIcon,
                gradient: 'from-green-500 to-emerald-400',
                glow: '34_197_94',
                title: 'Gestión de pedidos completa',
                body: 'Seguimiento desde la confirmación hasta la entrega. Notificaciones automáticas al equipo de logística y respuestas de tracking.',
                items: ['Notificaciones a logística', 'Estado de pedido automático', 'Alertas de stock bajo'],
                delay: '0.45s',
              },
            ].map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="group relative animate-fade-up overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-8 shadow-[0_1px_3px_0_rgb(0_0_0/0.05)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-2 hover:border-transparent hover:shadow-[0_24px_60px_-12px_rgb(0_0_0/0.18)]"
                  style={{ animationDelay: f.delay }}
                >
                  {/* Hover gradient border glow */}
                  <span
                    aria-hidden
                    className={`pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-br ${f.gradient} opacity-0 transition-opacity duration-500 group-hover:opacity-[0.06]`}
                  />
                  {/* Hover shimmer sweep */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/40 to-transparent opacity-0 transition-all duration-1000 group-hover:left-[150%] group-hover:opacity-100"
                  />

                  <div className="relative">
                    {/* Icon — gradient tile, breathes always, scale+rotate on hover */}
                    <div
                      className={`mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${f.gradient} transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-110`}
                      style={{ boxShadow: `0 8px 24px -4px rgb(${f.glow} / 0.45)` }}
                    >
                      <span className="animate-pulse-soft">
                        <Icon sx={{ fontSize: 28, color: 'white' }} />
                      </span>
                    </div>
                    <h3 className="mb-4 text-2xl font-bold text-slate-900">{f.title}</h3>
                    <p className="mb-4 leading-relaxed text-slate-600">{f.body}</p>
                    <ul className="space-y-2">
                      {f.items.map((item) => (
                        <li
                          key={item}
                          className="flex items-center gap-2 text-slate-700 transition-transform duration-300 group-hover:translate-x-1"
                        >
                          <CheckCircleIcon sx={{ fontSize: 20, color: '#22c55e' }} />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Integrations — staggered pop-in, icon halo on hover ─────── */}
      <section id="integrations" className="relative overflow-hidden bg-slate-50 px-6 py-24">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/4 top-1/2 h-80 w-80 rounded-full bg-blue-200/40 blur-3xl animate-float-slow" />
        </div>

        <div className="relative mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 animate-fade-up text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">
              Conectado a todos tus canales
            </h2>
            <p className="mx-auto max-w-2xl animate-fade-up text-xl text-slate-600 [animation-delay:0.15s]">
              Un solo sistema para gestionar WhatsApp, redes sociales y marketplaces
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {[
              { Icon: WhatsAppIcon, color: '#25D366', name: 'WhatsApp', sub: 'Business API', halo: '37_211_102' },
              { Icon: InstagramIcon, color: '#E4405F', name: 'Instagram', sub: 'DMs y Comentarios', halo: '228_64_95' },
              { Icon: FacebookIcon, color: '#1877F2', name: 'Facebook', sub: 'Messenger', halo: '24_119_242' },
              { Icon: StorefrontIcon, color: '#FFE600', name: 'MercadoLibre', sub: 'Preguntas', halo: '255_230_0' },
              { Icon: ShoppingBagIcon, color: '#9333ea', name: 'TiendaNube', sub: 'Sync de productos', halo: '147_51_234' },
              { Icon: ComputerIcon, color: '#06b6d4', name: 'Webchat', sub: 'Widget web', halo: '6_182_212' },
              { Icon: CampaignIcon, color: '#6366f1', name: 'Meta Ads', sub: 'Captura de leads', halo: '99_102_241' },
              { Icon: BarChartIcon, color: '#64748b', name: 'Analytics', sub: 'Métricas en tiempo real', halo: '100_116_139' },
            ].map((c, i) => {
              const Icon = c.Icon;
              return (
                <div
                  key={c.name}
                  className="group relative animate-pop-in cursor-pointer overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-[0_1px_3px_0_rgb(0_0_0/0.04)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-2 hover:border-transparent"
                  style={{
                    animationDelay: `${i * 0.07}s`,
                    ['--halo' as string]: c.halo,
                  }}
                >
                  {/* Hover halo */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 blur-md transition-opacity duration-500 group-hover:opacity-100"
                    style={{ boxShadow: `0 16px 40px -8px rgb(${c.halo} / 0.45)` }}
                  />
                  <div className="relative">
                    <div className="mb-3 flex justify-center transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:-translate-y-1 group-hover:scale-110">
                      <Icon sx={{ fontSize: 56, color: c.color }} />
                    </div>
                    <h4 className="font-bold text-slate-900">{c.name}</h4>
                    <p className="mt-2 text-sm text-slate-600">{c.sub}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Bottom CTA — animated gradient, decorative blobs ────────── */}
      <section className="relative overflow-hidden bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 px-6 py-24">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -left-20 top-10 h-80 w-80 rounded-full bg-white/15 blur-3xl animate-blob" />
          <div className="absolute -right-20 bottom-10 h-96 w-96 rounded-full bg-cyan-200/20 blur-3xl animate-blob [animation-delay:-8s]" />
        </div>

        <div className="relative mx-auto max-w-4xl text-center text-white">
          <h2 className="mb-6 animate-fade-up text-4xl font-bold tracking-tight md:text-5xl">
            ¿Listo para automatizar tu atención al cliente?
          </h2>
          <p className="mb-10 animate-fade-up text-xl text-blue-50/90 [animation-delay:0.15s]">
            Accede al panel de administración y gestiona todas tus conversaciones en un solo lugar
          </p>

          <Link
            href="/login"
            className="group relative inline-flex h-14 animate-fade-up items-center gap-2 overflow-hidden rounded-full bg-white px-9 text-lg font-medium text-blue-600 shadow-[0_10px_30px_-6px_rgb(0_0_0/0.3)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] [animation-delay:0.3s] hover:-translate-y-1 hover:shadow-[0_22px_50px_-8px_rgb(0_0_0/0.4)] active:translate-y-0 active:scale-[0.97]"
          >
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-blue-200/60 to-transparent animate-shimmer" />
            <span className="relative">Acceder al sistema</span>
            <ArrowForwardIcon sx={{ fontSize: 22 }} className="relative transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </div>
      </section>

      {/* ─── Footer — fade-in, animated underline links ──────────────── */}
      <footer className="bg-slate-900 px-6 py-12 text-slate-300">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 grid animate-fade-in grid-cols-1 gap-8 md:grid-cols-4">
            <div>
              <div className="mb-4 flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 animate-glow-pulse">
                  <span className="text-xs font-bold text-white">S</span>
                </span>
                <span className="text-xl font-bold text-white">
                  Servifibras
                </span>
              </div>
              <p className="text-sm text-slate-400">
                Plataforma de atención al cliente con inteligencia artificial para materiales compuestos.
              </p>
            </div>

            {[
              { title: 'Producto', items: [
                { label: 'Funcionalidades', href: '#features' },
                { label: 'Integraciones', href: '#integrations' },
                { label: 'Panel admin', href: '/login', isLink: true },
              ]},
              { title: 'Soporte', items: [
                { label: 'Documentación', href: '#' },
                { label: 'Centro de ayuda', href: '#' },
                { label: 'Contacto', href: '#' },
              ]},
              { title: 'Legal', items: [
                { label: 'Términos y condiciones', href: '#' },
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
