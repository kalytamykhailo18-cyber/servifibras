"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-white/80 backdrop-blur-xl border-b border-slate-200 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AutoAwesomeIcon className="text-blue-600" sx={{ fontSize: 32 }} />
              <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
                Servifibras
              </span>
            </div>

            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-slate-600 hover:text-slate-900 transition">Funcionalidades</a>
              <a href="#integrations" className="text-slate-600 hover:text-slate-900 transition">Integraciones</a>
            </div>

            <Link href="/login">
              <Button className="bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600">
                Acceder al Panel
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6">
        <div className="container mx-auto max-w-6xl text-center">
          <Badge className="mb-6 bg-blue-50 text-blue-600 border-blue-200 px-4 py-2">
            <AutoAwesomeIcon sx={{ fontSize: 16, marginRight: 1 }} />
            Atención al cliente con IA 24/7
          </Badge>

          <h1 className="text-6xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-slate-900 via-blue-800 to-slate-900 bg-clip-text text-transparent leading-tight">
            Tu agente de IA experto en
            <br />
            <span className="bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
              materiales compuestos
            </span>
          </h1>

          <p className="text-xl text-slate-600 mb-10 max-w-3xl mx-auto leading-relaxed">
            Automatiza consultas técnicas, genera cotizaciones inteligentes y convierte conversaciones
            en ventas. Integrado con WhatsApp, Instagram, Facebook y MercadoLibre.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <Link href="/login">
              <Button size="lg" className="text-lg px-8 py-6 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 shadow-xl hover:shadow-2xl transition-all inline-flex items-center gap-2">
                Acceder al sistema
                <ArrowForwardIcon sx={{ fontSize: 20 }} />
              </Button>
            </Link>
          </div>

          <div className="text-sm text-slate-500 flex items-center justify-center gap-2">
            <PeopleIcon sx={{ fontSize: 16 }} />
            Atendiendo +600 conversaciones semanales
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 px-6 bg-gradient-to-r from-blue-600 to-cyan-500">
        <div className="container mx-auto max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 text-white text-center">
            <div>
              <div className="text-5xl font-bold mb-2">24/7</div>
              <div className="text-blue-100">Atención continua</div>
            </div>
            <div>
              <div className="text-5xl font-bold mb-2">88%</div>
              <div className="text-blue-100">WhatsApp Business</div>
            </div>
            <div>
              <div className="text-5xl font-bold mb-2">6K+</div>
              <div className="text-blue-100">Mensajes por semana</div>
            </div>
            <div>
              <div className="text-5xl font-bold mb-2">95%</div>
              <div className="text-blue-100">Respuestas automáticas</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-6">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4 text-slate-900">
              Funcionalidades potenciadas por IA
            </h2>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto">
              Todo lo que necesitas para automatizar tu atención al cliente y aumentar tus ventas
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Feature 1 */}
            <Card className="p-8 hover:shadow-2xl transition-all border-2 hover:border-blue-200 group">
              <div className="bg-gradient-to-br from-blue-500 to-cyan-400 w-14 h-14 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition">
                <ChatBubbleOutlineIcon sx={{ fontSize: 28, color: 'white' }} />
              </div>
              <h3 className="text-2xl font-bold mb-4 text-slate-900">Consultas técnicas automatizadas</h3>
              <p className="text-slate-600 mb-4 leading-relaxed">
                El agente responde preguntas sobre resinas, fibra de vidrio y cauchos de silicona
                con precisión técnica usando una base de conocimiento especializada.
              </p>
              <ul className="space-y-2">
                <li className="flex items-center text-slate-700 gap-2">
                  <CheckCircleIcon sx={{ fontSize: 20, color: '#22c55e' }} />
                  Respuestas técnicas 24/7
                </li>
                <li className="flex items-center text-slate-700 gap-2">
                  <CheckCircleIcon sx={{ fontSize: 20, color: '#22c55e' }} />
                  Base de conocimiento actualizable
                </li>
                <li className="flex items-center text-slate-700 gap-2">
                  <CheckCircleIcon sx={{ fontSize: 20, color: '#22c55e' }} />
                  Recomendaciones de productos
                </li>
              </ul>
            </Card>

            {/* Feature 2 */}
            <Card className="p-8 hover:shadow-2xl transition-all border-2 hover:border-blue-200 group">
              <div className="bg-gradient-to-br from-purple-500 to-pink-400 w-14 h-14 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition">
                <FlashOnIcon sx={{ fontSize: 28, color: 'white' }} />
              </div>
              <h3 className="text-2xl font-bold mb-4 text-slate-900">Cotizaciones en tiempo real</h3>
              <p className="text-slate-600 mb-4 leading-relaxed">
                Genera presupuestos automáticos aplicando tipo de cambio del día, volumen de compra
                y canal de venta. Sincronizado con TiendaNube.
              </p>
              <ul className="space-y-2">
                <li className="flex items-center text-slate-700 gap-2">
                  <CheckCircleIcon sx={{ fontSize: 20, color: '#22c55e' }} />
                  Dólar blue actualizado
                </li>
                <li className="flex items-center text-slate-700 gap-2">
                  <CheckCircleIcon sx={{ fontSize: 20, color: '#22c55e' }} />
                  Descuentos por volumen automáticos
                </li>
                <li className="flex items-center text-slate-700 gap-2">
                  <CheckCircleIcon sx={{ fontSize: 20, color: '#22c55e' }} />
                  Precios diferenciados por canal
                </li>
              </ul>
            </Card>

            {/* Feature 3 */}
            <Card className="p-8 hover:shadow-2xl transition-all border-2 hover:border-blue-200 group">
              <div className="bg-gradient-to-br from-orange-500 to-red-400 w-14 h-14 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition">
                <TrendingUpIcon sx={{ fontSize: 28, color: 'white' }} />
              </div>
              <h3 className="text-2xl font-bold mb-4 text-slate-900">Identificación de leads mayoristas</h3>
              <p className="text-slate-600 mb-4 leading-relaxed">
                Detecta automáticamente clientes de alto valor y los deriva al equipo comercial
                con toda la información relevante.
              </p>
              <ul className="space-y-2">
                <li className="flex items-center text-slate-700 gap-2">
                  <CheckCircleIcon sx={{ fontSize: 20, color: '#22c55e' }} />
                  Clasificación automática
                </li>
                <li className="flex items-center text-slate-700 gap-2">
                  <CheckCircleIcon sx={{ fontSize: 20, color: '#22c55e' }} />
                  Derivación a ventas
                </li>
                <li className="flex items-center text-slate-700 gap-2">
                  <CheckCircleIcon sx={{ fontSize: 20, color: '#22c55e' }} />
                  Pipeline de oportunidades
                </li>
              </ul>
            </Card>

            {/* Feature 4 */}
            <Card className="p-8 hover:shadow-2xl transition-all border-2 hover:border-blue-200 group">
              <div className="bg-gradient-to-br from-green-500 to-emerald-400 w-14 h-14 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition">
                <ShoppingCartIcon sx={{ fontSize: 28, color: 'white' }} />
              </div>
              <h3 className="text-2xl font-bold mb-4 text-slate-900">Gestión de pedidos completa</h3>
              <p className="text-slate-600 mb-4 leading-relaxed">
                Seguimiento desde la confirmación hasta la entrega. Notificaciones automáticas
                al equipo de logística y respuestas de tracking.
              </p>
              <ul className="space-y-2">
                <li className="flex items-center text-slate-700 gap-2">
                  <CheckCircleIcon sx={{ fontSize: 20, color: '#22c55e' }} />
                  Notificaciones a logística
                </li>
                <li className="flex items-center text-slate-700 gap-2">
                  <CheckCircleIcon sx={{ fontSize: 20, color: '#22c55e' }} />
                  Estado de pedido automático
                </li>
                <li className="flex items-center text-slate-700 gap-2">
                  <CheckCircleIcon sx={{ fontSize: 20, color: '#22c55e' }} />
                  Alertas de stock bajo
                </li>
              </ul>
            </Card>
          </div>
        </div>
      </section>

      {/* Integrations Section */}
      <section id="integrations" className="py-20 px-6 bg-slate-50">
        <div className="container mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-bold mb-4 text-slate-900">
              Conectado a todos tus canales
            </h2>
            <p className="text-xl text-slate-600 max-w-2xl mx-auto">
              Un solo sistema para gestionar WhatsApp, redes sociales y marketplaces
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <Card className="p-8 text-center hover:shadow-xl transition border-2 hover:border-green-400">
              <div className="flex justify-center mb-3">
                <WhatsAppIcon sx={{ fontSize: 56, color: '#25D366' }} />
              </div>
              <h4 className="font-bold text-slate-900">WhatsApp</h4>
              <p className="text-sm text-slate-600 mt-2">Business API</p>
            </Card>
            <Card className="p-8 text-center hover:shadow-xl transition border-2 hover:border-pink-400">
              <div className="flex justify-center mb-3">
                <InstagramIcon sx={{ fontSize: 56, color: '#E4405F' }} />
              </div>
              <h4 className="font-bold text-slate-900">Instagram</h4>
              <p className="text-sm text-slate-600 mt-2">DMs y Comentarios</p>
            </Card>
            <Card className="p-8 text-center hover:shadow-xl transition border-2 hover:border-blue-400">
              <div className="flex justify-center mb-3">
                <FacebookIcon sx={{ fontSize: 56, color: '#1877F2' }} />
              </div>
              <h4 className="font-bold text-slate-900">Facebook</h4>
              <p className="text-sm text-slate-600 mt-2">Messenger</p>
            </Card>
            <Card className="p-8 text-center hover:shadow-xl transition border-2 hover:border-yellow-400">
              <div className="flex justify-center mb-3">
                <StorefrontIcon sx={{ fontSize: 56, color: '#FFE600' }} />
              </div>
              <h4 className="font-bold text-slate-900">MercadoLibre</h4>
              <p className="text-sm text-slate-600 mt-2">Preguntas</p>
            </Card>
            <Card className="p-8 text-center hover:shadow-xl transition border-2 hover:border-purple-400">
              <div className="flex justify-center mb-3">
                <ShoppingBagIcon sx={{ fontSize: 56, color: '#9333ea' }} />
              </div>
              <h4 className="font-bold text-slate-900">TiendaNube</h4>
              <p className="text-sm text-slate-600 mt-2">Sync de productos</p>
            </Card>
            <Card className="p-8 text-center hover:shadow-xl transition border-2 hover:border-cyan-400">
              <div className="flex justify-center mb-3">
                <ComputerIcon sx={{ fontSize: 56, color: '#06b6d4' }} />
              </div>
              <h4 className="font-bold text-slate-900">Webchat</h4>
              <p className="text-sm text-slate-600 mt-2">Widget web</p>
            </Card>
            <Card className="p-8 text-center hover:shadow-xl transition border-2 hover:border-indigo-400">
              <div className="flex justify-center mb-3">
                <CampaignIcon sx={{ fontSize: 56, color: '#6366f1' }} />
              </div>
              <h4 className="font-bold text-slate-900">Meta Ads</h4>
              <p className="text-sm text-slate-600 mt-2">Captura de leads</p>
            </Card>
            <Card className="p-8 text-center hover:shadow-xl transition border-2 hover:border-slate-400">
              <div className="flex justify-center mb-3">
                <BarChartIcon sx={{ fontSize: 56, color: '#64748b' }} />
              </div>
              <h4 className="font-bold text-slate-900">Analytics</h4>
              <p className="text-sm text-slate-600 mt-2">Métricas en tiempo real</p>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6 bg-gradient-to-r from-blue-600 to-cyan-500">
        <div className="container mx-auto max-w-4xl text-center text-white">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            ¿Listo para automatizar tu atención al cliente?
          </h2>
          <p className="text-xl mb-10 text-blue-50">
            Accede al panel de administración y gestiona todas tus conversaciones en un solo lugar
          </p>
          <Link href="/login">
            <Button size="lg" className="text-lg px-10 py-6 bg-white text-blue-600 hover:bg-slate-50 shadow-2xl inline-flex items-center gap-2">
              Acceder al sistema
              <ArrowForwardIcon sx={{ fontSize: 20 }} />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 bg-slate-900 text-slate-300">
        <div className="container mx-auto max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <AutoAwesomeIcon sx={{ fontSize: 24, color: '#60a5fa' }} />
                <span className="text-xl font-bold text-white">Servifibras</span>
              </div>
              <p className="text-sm text-slate-400">
                Plataforma de atención al cliente con inteligencia artificial para materiales compuestos.
              </p>
            </div>

            <div>
              <h4 className="font-bold text-white mb-4">Producto</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="hover:text-white transition">Funcionalidades</a></li>
                <li><a href="#integrations" className="hover:text-white transition">Integraciones</a></li>
                <li><Link href="/login" className="hover:text-white transition">Panel admin</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-white mb-4">Soporte</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:text-white transition">Documentación</a></li>
                <li><a href="#" className="hover:text-white transition">Centro de ayuda</a></li>
                <li><a href="#" className="hover:text-white transition">Contacto</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-white mb-4">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:text-white transition">Términos y condiciones</a></li>
                <li><a href="#" className="hover:text-white transition">Privacidad</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-8 text-center text-sm text-slate-500">
            <p>&copy; 2026 Servifibras. Todos los derechos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
