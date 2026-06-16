/**
 * Public widget endpoint — Bloque D #2.
 *
 * Lives outside the admin auth boundary on purpose: the embed script
 * ships to anonymous storefront visitors. The session model is a
 * client-generated UUID that we trust as the conversation key for as
 * long as the visitor keeps their localStorage entry. No PII required
 * to start a chat; if the visitor types their email/name we capture it.
 *
 * Gated behind WIDGET_TN_ENABLED. While the flag is false every public
 * endpoint returns 404 so the surface doesn't even exist for scanners.
 * The flip happens once Marcos has the TN install ready.
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  Res,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { randomUUID } from 'crypto';
import {
  WebchatIncomingMessage,
  WebchatMessageType,
} from '../../../domain/entities/webchat-message.entity';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';

const SAFE_SESSION_RE = /^[a-zA-Z0-9_-]{8,128}$/;

@Controller('widget/v1')
export class WidgetController {
  private readonly logger = new Logger(WidgetController.name);

  constructor(
    private readonly conversationHandler: ConversationHandlerService,
  ) {}

  private gateEnabled(): boolean {
    return String(process.env.WIDGET_TN_ENABLED || '').toLowerCase() === 'true';
  }

  /** Allowed origins for the embed. Multiple comma-separated entries.
   *  Empty (or unset) = allow `*` for development; in prod the TN store
   *  origin must be listed. We don't reflect the request Origin without
   *  matching the allowlist, to keep this from being a credential-bearing
   *  open CORS hole if cookies are ever added. */
  private resolveCorsOrigin(reqOrigin: string | undefined): string {
    const list = (process.env.WIDGET_TN_ALLOWED_ORIGINS || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    if (list.length === 0) return '*';
    if (reqOrigin && list.includes(reqOrigin)) return reqOrigin;
    return list[0];
  }

  @Get('health')
  health(@Res() res: Response, @Headers('origin') origin?: string) {
    if (!this.gateEnabled()) throw new NotFoundException();
    res.setHeader('Access-Control-Allow-Origin', this.resolveCorsOrigin(origin));
    return res.json({ status: 'ok', enabled: true });
  }

  /** Serve the embed script directly. A storefront installs the widget
   *  by adding a single <script src="https://servifibras.com/widget/v1.js">
   *  tag — this endpoint returns that script. The actual JS lives at
   *  the bottom of this file so it's edited alongside the API contract.
   */
  @Get('embed.js')
  embedJs(@Res() res: Response) {
    if (!this.gateEnabled()) throw new NotFoundException();
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.send(buildEmbedScript({
      apiBase: process.env.WIDGET_TN_PUBLIC_BASE || '',
      bubbleLabel: process.env.WIDGET_TN_LABEL || 'Hola, ¿en qué te ayudo?',
    }));
  }

  /** Preflight for browsers — same allowlist policy as the POST. */
  @Post('message/preflight')
  preflight(@Res() res: Response, @Headers('origin') origin?: string) {
    if (!this.gateEnabled()) throw new NotFoundException();
    res.setHeader('Access-Control-Allow-Origin', this.resolveCorsOrigin(origin));
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).send();
  }

  /** Public POST — accepts an anonymous visitor message and returns
   *  the agent reply in-band. Limits: 4000 chars text, sessionId must
   *  match the safe pattern, throttle bucket is dedicated to this path.
   */
  @Throttle({ default: { ttl: 60_000, limit: Number(process.env.WIDGET_TN_RATE_LIMIT_PER_MIN) || 30 } })
  @Post('message')
  async message(
    @Body() body: {
      sessionId?: string;
      text?: string;
      customerName?: string;
      customerEmail?: string;
    },
    @Res() res: Response,
    @Headers('origin') origin?: string,
  ) {
    if (!this.gateEnabled()) throw new NotFoundException();
    res.setHeader('Access-Control-Allow-Origin', this.resolveCorsOrigin(origin));

    const sessionId = (body?.sessionId || '').trim();
    const text = (body?.text || '').trim();
    if (!SAFE_SESSION_RE.test(sessionId)) {
      throw new BadRequestException('sessionId inválido');
    }
    if (!text) throw new BadRequestException('text requerido');
    if (text.length > 4000) throw new BadRequestException('text demasiado largo');

    const customerName = (body?.customerName || '').trim().slice(0, 120) || 'Visitante widget';
    const customerEmail = (body?.customerEmail || '').trim().slice(0, 200) || null;

    const inbound = new WebchatIncomingMessage(
      randomUUID(),
      `widget:${sessionId}`,
      `widget:${sessionId}`,
      customerName,
      customerEmail,
      WebchatMessageType.TEXT,
      text,
      new Date(),
    );

    try {
      const result = await this.conversationHandler.handleWebchatMessage(inbound);
      return res.json({
        sessionId,
        reply: result?.response ?? null,
        ok: !!result?.success,
      });
    } catch (err: any) {
      this.logger.error(`widget handleWebchatMessage failed: ${err?.message}`);
      return res.status(502).json({ sessionId, reply: null, ok: false, error: 'agent_unavailable' });
    }
  }
}

function buildEmbedScript({ apiBase, bubbleLabel }: { apiBase: string; bubbleLabel: string }): string {
  // The base is injected by the controller — never the client. Clients
  // can only see this script through a same-origin GET; they cannot
  // override the api root they post against.
  const safeBase = JSON.stringify(apiBase || '');
  const safeLabel = JSON.stringify(bubbleLabel);
  return `(function(){
  if (window.__servifibras_widget_loaded) return;
  window.__servifibras_widget_loaded = true;
  var API = ${safeBase} || (document.currentScript && document.currentScript.src.split('/widget/')[0]) || '';
  var LABEL = ${safeLabel};
  var SID_KEY = 'servifibras.widget.sid';
  function sid() {
    var s = localStorage.getItem(SID_KEY);
    if (s && /^[a-zA-Z0-9_-]{8,128}$/.test(s)) return s;
    s = 'w-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
    localStorage.setItem(SID_KEY, s); return s;
  }
  var css = [
    '.sf-bubble{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:28px;background:#1d4ed8;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.2);z-index:2147483646;font-family:system-ui,sans-serif}',
    '.sf-panel{position:fixed;bottom:96px;right:24px;width:340px;max-width:calc(100vw - 48px);height:480px;max-height:calc(100vh - 120px);background:#fff;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.25);z-index:2147483646;display:none;flex-direction:column;overflow:hidden;font-family:system-ui,sans-serif}',
    '.sf-panel.open{display:flex}',
    '.sf-head{background:#1d4ed8;color:#fff;padding:12px 16px;font-weight:600}',
    '.sf-log{flex:1;overflow-y:auto;padding:12px;background:#f8fafc}',
    '.sf-msg{margin:6px 0;padding:8px 12px;border-radius:12px;max-width:80%;white-space:pre-wrap;word-wrap:break-word;font-size:14px;line-height:1.4}',
    '.sf-msg.me{background:#1d4ed8;color:#fff;margin-left:auto}',
    '.sf-msg.ai{background:#e2e8f0;color:#0f172a}',
    '.sf-form{display:flex;border-top:1px solid #e2e8f0}',
    '.sf-form input{flex:1;border:0;padding:12px;font-size:14px;outline:0}',
    '.sf-form button{border:0;background:#1d4ed8;color:#fff;padding:0 16px;cursor:pointer;font-weight:600}',
  ].join('');
  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  var bubble = document.createElement('div'); bubble.className='sf-bubble'; bubble.title = LABEL; bubble.textContent = '💬';
  var panel = document.createElement('div'); panel.className='sf-panel';
  panel.innerHTML = '<div class="sf-head">Servifibras</div><div class="sf-log" id="sf-log"></div><form class="sf-form" id="sf-form"><input id="sf-input" autocomplete="off" placeholder="Escribí tu consulta..." /><button type="submit">Enviar</button></form>';
  document.body.appendChild(bubble); document.body.appendChild(panel);
  bubble.addEventListener('click', function(){ panel.classList.toggle('open'); });
  var log = panel.querySelector('#sf-log');
  function add(role, text){ var d=document.createElement('div'); d.className='sf-msg '+role; d.textContent=text; log.appendChild(d); log.scrollTop = log.scrollHeight; }
  panel.querySelector('#sf-form').addEventListener('submit', function(e){
    e.preventDefault();
    var inp = panel.querySelector('#sf-input'); var t = (inp.value||'').trim(); if(!t) return;
    inp.value=''; add('me', t);
    fetch(API + '/widget/v1/message', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ sessionId: sid(), text: t }) })
      .then(function(r){ return r.json().catch(function(){return {};}); })
      .then(function(j){ add('ai', j && j.reply ? j.reply : 'No pude procesar tu mensaje. Probá de nuevo en un momento.'); })
      .catch(function(){ add('ai', 'Conexión interrumpida. Probá de nuevo.'); });
  });
})();`;
}
