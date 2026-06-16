/**
 * INFRASTRUCTURE LAYER — Integrations panel.
 *
 * Returns per-provider connection state for the Settings → Integraciones
 * surface. ADMIN-only — non-admins will get 403 from RolesGuard.
 *
 * Two flavours of provider:
 *   • OAUTH (mercadolibre, tiendanube) — state lives in `oauth_credentials`.
 *     User can install / disconnect from the UI.
 *   • ENV   (claude, dolarBlue, whatsapp, facebook, instagram) — state
 *     derived from .env keys + a lightweight probe. Read-only from the
 *     UI; configuration happens in .env on the VPS.
 */

import {
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { OAuthCredentialsService } from '../../../adapters/oauth/oauth-credentials.service';

interface TestResult {
  success: boolean;
  latencyMs: number;
  detail?: string;
  reason?: string;
}

type Kind = 'oauth' | 'env';
type Status = 'connected' | 'unconfigured' | 'error';

interface ProviderState {
  provider: string;
  kind: Kind;
  status: Status;
  externalId: string | null;
  expiresAt: string | null;
  refreshable: boolean;
  installUrl: string | null;
  metadata?: Record<string, any>;
  productCount?: number;
  errorReason?: string;
}

@Controller('admin/integrations')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class IntegrationsController {
  private readonly logger = new Logger(IntegrationsController.name);
  private readonly prisma = new PrismaClient();

  constructor(private readonly credentials: OAuthCredentialsService) {}

  @Get()
  async list(): Promise<{ success: true; data: ProviderState[] }> {
    const rows = await this.prisma.oAuthCredential.findMany();
    const byProvider = new Map(rows.map((r) => [r.provider, r]));

    // ---- OAuth-backed providers ------------------------------------
    const ml = byProvider.get('mercadolibre');
    const mlState: ProviderState = {
      provider: 'mercadolibre',
      kind: 'oauth',
      status: ml ? 'connected' : 'unconfigured',
      externalId: ml?.externalId ?? null,
      expiresAt: ml?.expiresAt.toISOString() ?? null,
      refreshable: !!ml?.refreshToken,
      installUrl: this.buildMercadoLibreInstallUrl(),
      metadata: ml?.metadata as any,
    };

    const tn = byProvider.get('tiendanube');
    const tnProductCount = tn
      ? await this.prisma.product.count({ where: { source: 'TIENDANUBE' } })
      : 0;
    const tnState: ProviderState = {
      provider: 'tiendanube',
      kind: 'oauth',
      status: tn ? 'connected' : 'unconfigured',
      externalId: tn?.externalId ?? null,
      expiresAt: tn?.expiresAt.toISOString() ?? null,
      refreshable: false,
      installUrl: this.buildTiendaNubeInstallUrl(),
      metadata: tn?.metadata as any,
      productCount: tnProductCount,
    };

    const meta = byProvider.get('meta');
    const metaState: ProviderState = {
      provider: 'meta',
      kind: 'oauth',
      status: meta ? 'connected' : 'unconfigured',
      externalId: meta?.externalId ?? null,
      expiresAt: meta?.expiresAt.toISOString() ?? null,
      refreshable: false,
      installUrl: this.buildMetaInstallUrl(),
      metadata: meta?.metadata as any,
    };

    // ---- Env-backed providers (no install URL, no disconnect) ------
    const claudeState = this.envState(
      'claude',
      !!process.env.CLAUDE_API_KEY,
      process.env.CLAUDE_MODEL ?? null,
      { model: process.env.CLAUDE_MODEL, fallbackModel: process.env.CLAUDE_FALLBACK_MODEL },
    );

    const dolarState = this.envState(
      'dolarBlue',
      !!process.env.BLUELYTICS_API_URL,
      null,
      {
        endpoint: process.env.BLUELYTICS_API_URL,
        cacheMinutes: process.env.EXCHANGE_RATE_CACHE_MINUTES,
      },
    );

    const waState = this.envState(
      'whatsapp',
      !!(
        process.env.WHATSAPP_ACCESS_TOKEN &&
        process.env.WHATSAPP_PHONE_NUMBER_ID
      ),
      process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    );

    // Facebook + Instagram are env-backed surface cards (separate from
    // the OAuth-driven Meta tile that handles the actual install). They
    // mirror the legacy FACEBOOK_PAGE_ID / INSTAGRAM_ACCOUNT_ID env vars
    // so an admin can tell at a glance which page/account the agent
    // would post to if those vars are set instead of the OAuth flow.
    const fbState = this.envState(
      'facebook',
      !!(process.env.FACEBOOK_PAGE_ACCESS_TOKEN && process.env.FACEBOOK_PAGE_ID),
      process.env.FACEBOOK_PAGE_ID || null,
    );
    const igState = this.envState(
      'instagram',
      !!process.env.INSTAGRAM_ACCOUNT_ID,
      process.env.INSTAGRAM_ACCOUNT_ID || null,
    );

    return {
      success: true,
      data: [mlState, tnState, metaState, claudeState, dolarState, waState, fbState, igState],
    };
  }

  @Delete(':provider')
  async disconnect(
    @Param('provider') provider: string,
  ): Promise<{ success: true; data: { deleted: boolean } }> {
    if (provider !== 'mercadolibre' && provider !== 'tiendanube' && provider !== 'meta') {
      return { success: true, data: { deleted: false } };
    }
    const existing = await this.prisma.oAuthCredential.findUnique({
      where: { provider },
    });
    if (!existing) return { success: true, data: { deleted: false } };
    await this.prisma.oAuthCredential.delete({ where: { provider } });
    this.logger.warn(`${provider}: credentials deleted by admin`);
    return { success: true, data: { deleted: true } };
  }

  /**
   * Hit the real provider API with a lightweight probe and return the
   * actual reachability + latency. Catches revoked tokens, expired
   * Meta apps, network outages — cases the env-only check misses.
   */
  @Post(':provider/test')
  async test(@Param('provider') provider: string): Promise<{ success: true; data: TestResult }> {
    const t0 = Date.now();
    let r: TestResult;
    try {
      switch (provider) {
        case 'mercadolibre':
          r = await this.testMercadoLibre();
          break;
        case 'tiendanube':
          r = await this.testTiendaNube();
          break;
        case 'claude':
          r = await this.testClaude();
          break;
        case 'dolarBlue':
          r = await this.testDolarBlue();
          break;
        case 'whatsapp':
          r = await this.testWhatsApp();
          break;
        case 'facebook':
          r = await this.testFacebook();
          break;
        case 'instagram':
          r = await this.testInstagram();
          break;
        case 'meta':
          r = await this.testMeta();
          break;
        default:
          r = { success: false, latencyMs: 0, reason: `Proveedor desconocido: ${provider}` };
      }
    } catch (err: any) {
      r = { success: false, latencyMs: Date.now() - t0, reason: err?.message ?? String(err) };
    }
    if (!r.latencyMs) r.latencyMs = Date.now() - t0;
    this.logger.log(`probe ${provider}: ${r.success ? 'ok' : 'fail'} (${r.latencyMs}ms)`);
    return { success: true, data: r };
  }

  private async testMercadoLibre(): Promise<TestResult> {
    const t0 = Date.now();
    const stored = await this.credentials.getFresh(
      'mercadolibre',
      (refreshToken) => this.refreshMercadoLibreToken(refreshToken),
    );
    if (!stored?.accessToken || !stored.externalId) {
      return { success: false, latencyMs: 0, reason: 'No hay credenciales OAuth guardadas' };
    }
    const apiUrl = process.env.MERCADOLIBRE_API_URL || 'https://api.mercadolibre.com';
    const res = await fetch(`${apiUrl}/users/${stored.externalId}`, {
      headers: { Authorization: `Bearer ${stored.accessToken}` },
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      return { success: false, latencyMs, reason: `HTTP ${res.status}` };
    }
    const j: any = await res.json();
    return { success: true, latencyMs, detail: `nickname=${j.nickname ?? '—'} · ${j.user_type ?? '?'} · MLA reputation=${(j.seller_reputation || {}).level_id ?? '?'}` };
  }

  private async refreshMercadoLibreToken(refreshToken: string) {
    const appId = process.env.MERCADOLIBRE_APP_ID;
    const clientSecret = process.env.MERCADOLIBRE_CLIENT_SECRET;
    const tokenUrl = process.env.MERCADOLIBRE_TOKEN_URL || 'https://api.mercadolibre.com/oauth/token';
    if (!appId || !clientSecret) {
      throw new Error('MERCADOLIBRE_APP_ID / MERCADOLIBRE_CLIENT_SECRET missing');
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: appId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
    const json: any = await res.json();
    if (!res.ok) throw new Error(`refresh failed (HTTP ${res.status}): ${JSON.stringify(json)}`);
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? refreshToken,
      externalId: json.user_id != null ? String(json.user_id) : null,
      expiresInSec: Number(json.expires_in) || 6 * 60 * 60,
      metadata: { tokenType: json.token_type, scope: json.scope },
    };
  }

  private async testTiendaNube(): Promise<TestResult> {
    const t0 = Date.now();
    const stored = await this.credentials.getRaw('tiendanube');
    if (!stored?.accessToken || !stored.externalId) {
      return { success: false, latencyMs: 0, reason: 'No hay credenciales OAuth guardadas' };
    }
    const apiUrl = process.env.TIENDANUBE_API_URL || 'https://api.tiendanube.com/v1';
    const ua = process.env.TIENDANUBE_USER_AGENT || 'Servifibras-Backend';
    const res = await fetch(`${apiUrl}/${stored.externalId}/store`, {
      headers: { Authentication: `bearer ${stored.accessToken}`, 'User-Agent': ua },
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      return { success: false, latencyMs, reason: `HTTP ${res.status}` };
    }
    const j: any = await res.json();
    return { success: true, latencyMs, detail: `${(j.name || {}).es ?? j.name ?? '?'} · ${j.plan_name ?? '?'}` };
  }

  private async testClaude(): Promise<TestResult> {
    const t0 = Date.now();
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) return { success: false, latencyMs: 0, reason: 'CLAUDE_API_KEY ausente' };
    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      return { success: false, latencyMs, reason: err?.error?.message ?? `HTTP ${res.status}` };
    }
    const j: any = await res.json();
    const tok = (j.usage?.input_tokens ?? 0) + (j.usage?.output_tokens ?? 0);
    return { success: true, latencyMs, detail: `model=${j.model} · tokens=${tok}` };
  }

  private async testDolarBlue(): Promise<TestResult> {
    const t0 = Date.now();
    const url = process.env.BLUELYTICS_API_URL || 'https://api.bluelytics.com.ar/v2/latest';
    const res = await fetch(url);
    const latencyMs = Date.now() - t0;
    if (!res.ok) return { success: false, latencyMs, reason: `HTTP ${res.status}` };
    const j: any = await res.json();
    const blue = j?.blue?.value_avg;
    return { success: true, latencyMs, detail: blue ? `dólar blue ARS ${blue}` : 'respuesta sin valor' };
  }

  private async testWhatsApp(): Promise<TestResult> {
    const t0 = Date.now();
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) {
      return { success: false, latencyMs: 0, reason: 'WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID ausentes' };
    }
    const apiUrl = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v18.0';
    const res = await fetch(`${apiUrl}/${phoneId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      return { success: false, latencyMs, reason: err?.error?.message ?? `HTTP ${res.status}` };
    }
    const j: any = await res.json();
    return { success: true, latencyMs, detail: `${j.display_phone_number ?? phoneId} · ${j.verified_name ?? ''}`.trim() };
  }

  private async testFacebook(): Promise<TestResult> {
    const t0 = Date.now();
    const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    const pageId = process.env.FACEBOOK_PAGE_ID;
    if (!token || !pageId) {
      return { success: false, latencyMs: 0, reason: 'FACEBOOK_PAGE_ACCESS_TOKEN o FACEBOOK_PAGE_ID ausentes' };
    }
    const apiUrl = process.env.FACEBOOK_API_URL || 'https://graph.facebook.com/v18.0';
    const res = await fetch(`${apiUrl}/${pageId}?fields=id,name,category`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      return { success: false, latencyMs, reason: err?.error?.message ?? `HTTP ${res.status}` };
    }
    const j: any = await res.json();
    return { success: true, latencyMs, detail: `${j.name ?? pageId} · ${j.category ?? ''}`.trim() };
  }

  private async testMeta(): Promise<TestResult> {
    const t0 = Date.now();
    const stored = await this.credentials.getRaw('meta');
    if (!stored?.accessToken || !stored.externalId) {
      return { success: false, latencyMs: 0, reason: 'No hay credenciales OAuth de Meta guardadas' };
    }
    const apiUrl = process.env.FACEBOOK_API_URL || 'https://graph.facebook.com/v18.0';
    const res = await fetch(
      `${apiUrl}/${stored.externalId}?fields=id,name,category&access_token=${encodeURIComponent(stored.accessToken)}`,
    );
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      return { success: false, latencyMs, reason: err?.error?.message ?? `HTTP ${res.status}` };
    }
    const j: any = await res.json();
    const meta = (stored.metadata as any) ?? {};
    const igTag = meta.instagramUsername ? ` · IG @${meta.instagramUsername}` : '';
    return { success: true, latencyMs, detail: `${j.name ?? stored.externalId}${igTag}` };
  }

  private async testInstagram(): Promise<TestResult> {
    const t0 = Date.now();
    const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN; // IG Graph piggybacks on Page token
    const igId = process.env.INSTAGRAM_ACCOUNT_ID;
    if (!token || !igId) {
      return { success: false, latencyMs: 0, reason: 'FACEBOOK_PAGE_ACCESS_TOKEN o INSTAGRAM_ACCOUNT_ID ausentes' };
    }
    const apiUrl = process.env.FACEBOOK_API_URL || 'https://graph.facebook.com/v18.0';
    const res = await fetch(`${apiUrl}/${igId}?fields=id,username`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      const err: any = await res.json().catch(() => ({}));
      return { success: false, latencyMs, reason: err?.error?.message ?? `HTTP ${res.status}` };
    }
    const j: any = await res.json();
    return { success: true, latencyMs, detail: `@${j.username ?? igId}` };
  }

  private envState(
    provider: string,
    configured: boolean,
    externalId: string | null,
    metadata?: Record<string, any>,
  ): ProviderState {
    return {
      provider,
      kind: 'env',
      status: configured ? 'connected' : 'unconfigured',
      externalId,
      expiresAt: null,
      refreshable: false,
      installUrl: null,
      metadata,
    };
  }

  private buildMercadoLibreInstallUrl(): string | null {
    const appId = process.env.MERCADOLIBRE_APP_ID;
    const redirect = process.env.MERCADOLIBRE_REDIRECT_URI;
    const authBase =
      process.env.MERCADOLIBRE_AUTH_URL ||
      'https://auth.mercadolibre.com.ar/authorization';
    if (!appId || !redirect) return null;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: appId,
      redirect_uri: redirect,
    });
    return `${authBase}?${params.toString()}`;
  }

  private buildTiendaNubeInstallUrl(): string | null {
    const appId = process.env.TIENDANUBE_APP_ID;
    const installBase =
      process.env.TIENDANUBE_INSTALL_URL ||
      'https://www.tiendanube.com/apps';
    if (!appId) return null;
    return `${installBase}/${appId}/authorize`;
  }

  private buildMetaInstallUrl(): string | null {
    const appId = process.env.META_APP_ID;
    const redirect = process.env.META_REDIRECT_URI;
    const authBase =
      process.env.META_AUTH_URL || 'https://www.facebook.com/v18.0/dialog/oauth';
    // Permissions Marcos's flow needs:
    //   - pages_show_list / pages_read_engagement → list + read pages
    //   - pages_manage_metadata → subscribe webhooks on the page
    //   - pages_messaging → send/receive Messenger DMs
    //   - instagram_basic → read IG account info
    //   - instagram_manage_messages → IG DM send/receive
    //   - business_management → access Business Manager assets
    const scopes = (
      process.env.META_OAUTH_SCOPES ||
      'pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,instagram_basic,instagram_manage_messages,business_management'
    ).split(',').map((s) => s.trim()).filter(Boolean).join(',');
    if (!appId || !redirect) return null;
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirect,
      scope: scopes,
      response_type: 'code',
    });
    return `${authBase}?${params.toString()}`;
  }
}
