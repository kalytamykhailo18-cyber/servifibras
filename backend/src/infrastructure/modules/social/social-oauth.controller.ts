/**
 * INFRASTRUCTURE LAYER — Meta (Facebook + Instagram) OAuth callback.
 *
 * Flow:
 *   1. Marcos clicks the install URL we built from `META_APP_ID`.
 *   2. Meta sends him through Login + Permissions and redirects to
 *      `/social/oauth/callback?code=...`.
 *   3. We exchange `code` → short-lived user token → long-lived (60-day)
 *      user token → list of pages he administers → page-access token
 *      (long-lived, doesn't expire) for the chosen page → IG business
 *      account id linked to that page.
 *   4. Persist `provider=meta` row in `oauth_credentials` with the page
 *      access token (the long-lived one) + metadata { pageId, pageName,
 *      instagramAccountId }.
 *   5. Auto-subscribe the page to Messenger + IG webhooks so inbound
 *      DMs land on `/social/webhook`.
 *
 * Marcos's environment today: ONE Facebook Page with a linked IG
 * Business account, so we pick the first page from `GET /me/accounts`.
 * If he ever manages multiple pages we'll add a chooser step.
 */

import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { OAuthCredentialsService } from '../../../adapters/oauth/oauth-credentials.service';

@Controller('social/oauth')
export class SocialOAuthController {
  private readonly logger = new Logger(SocialOAuthController.name);

  constructor(private readonly credentials: OAuthCredentialsService) {}

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ) {
    if (error) {
      this.logger.warn(`Meta rejected the install: ${error} — ${errorDescription ?? ''}`);
      return res
        .status(400)
        .send(`<h2>Error de instalación</h2><p>${error}: ${errorDescription ?? '—'}</p>`);
    }
    if (!code) {
      return res.status(400).send('<h2>Falta el parámetro <code>code</code></h2>');
    }

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const redirectUri = process.env.META_REDIRECT_URI;
    const apiBase = process.env.FACEBOOK_API_URL || 'https://graph.facebook.com/v18.0';

    if (!appId || !appSecret || !redirectUri) {
      this.logger.error(
        'Meta OAuth env not configured (need META_APP_ID, META_APP_SECRET, META_REDIRECT_URI)',
      );
      return res.status(500).send('<h2>OAuth no configurado en el servidor</h2>');
    }

    try {
      // Step 1: code → short-lived user access token
      const tokenUrl =
        `${apiBase}/oauth/access_token` +
        `?client_id=${encodeURIComponent(appId)}` +
        `&client_secret=${encodeURIComponent(appSecret)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&code=${encodeURIComponent(code)}`;
      const tokRes = await fetch(tokenUrl);
      const tok: any = await tokRes.json();
      if (!tokRes.ok || !tok.access_token) {
        this.logger.error(`code → user token failed: ${JSON.stringify(tok)}`);
        return res
          .status(502)
          .send(`<h2>Error intercambiando el código</h2><pre>${JSON.stringify(tok, null, 2)}</pre>`);
      }
      const shortUserToken = tok.access_token as string;

      // Step 2: short-lived user token → long-lived (60-day) user token
      const longUrl =
        `${apiBase}/oauth/access_token` +
        `?grant_type=fb_exchange_token` +
        `&client_id=${encodeURIComponent(appId)}` +
        `&client_secret=${encodeURIComponent(appSecret)}` +
        `&fb_exchange_token=${encodeURIComponent(shortUserToken)}`;
      const longRes = await fetch(longUrl);
      const long: any = await longRes.json();
      if (!longRes.ok || !long.access_token) {
        this.logger.error(`long-lived exchange failed: ${JSON.stringify(long)}`);
        return res
          .status(502)
          .send('<h2>No se pudo extender el token de usuario</h2>');
      }
      const longUserToken = long.access_token as string;
      const longUserExpires = Number(long.expires_in) || 60 * 24 * 60 * 60; // 60d typical

      // Step 3: list pages the user administers
      const pagesRes = await fetch(
        `${apiBase}/me/accounts?fields=id,name,access_token,category&access_token=${encodeURIComponent(longUserToken)}`,
      );
      const pagesJson: any = await pagesRes.json();
      const pages: Array<{ id: string; name: string; access_token: string; category?: string }> =
        Array.isArray(pagesJson?.data) ? pagesJson.data : [];
      if (pages.length === 0) {
        this.logger.warn(`No pages returned: ${JSON.stringify(pagesJson)}`);
        return res
          .status(502)
          .send('<h2>El usuario no administra ninguna página de Facebook</h2>');
      }
      // Marcos has one page today; pick the first.
      const page = pages[0];

      // Step 4: linked Instagram Business account, if any
      let instagramAccountId: string | null = null;
      let instagramUsername: string | null = null;
      try {
        const igRes = await fetch(
          `${apiBase}/${page.id}?fields=instagram_business_account&access_token=${encodeURIComponent(page.access_token)}`,
        );
        const igJson: any = await igRes.json();
        const igId = igJson?.instagram_business_account?.id;
        if (igId) {
          instagramAccountId = String(igId);
          const igInfoRes = await fetch(
            `${apiBase}/${igId}?fields=id,username&access_token=${encodeURIComponent(page.access_token)}`,
          );
          const igInfo: any = await igInfoRes.json();
          if (igInfo?.username) instagramUsername = String(igInfo.username);
        }
      } catch (err: any) {
        this.logger.warn(`IG link probe failed (non-fatal): ${err.message}`);
      }

      // Step 5: persist credentials
      await this.credentials.save('meta', {
        accessToken: page.access_token,
        refreshToken: null,
        externalId: page.id,
        // Page tokens issued from a long-lived user token are themselves
        // long-lived (no expiry). Store a far-future date so the resolver
        // never considers them stale. The user-token expiry is recorded
        // in metadata for awareness.
        expiresInSec: 100 * 365 * 24 * 60 * 60,
        metadata: {
          pageName: page.name,
          pageCategory: page.category,
          instagramAccountId,
          instagramUsername,
          longUserTokenExpiresInSec: longUserExpires,
        },
      });

      // Step 6: auto-subscribe webhooks for messages + messaging_postbacks
      try {
        const subRes = await fetch(
          `${apiBase}/${page.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,messaging_optins,message_deliveries,message_reads&access_token=${encodeURIComponent(page.access_token)}`,
          { method: 'POST' },
        );
        const subJson: any = await subRes.json();
        if (!subJson?.success) {
          this.logger.warn(`subscribe_apps did not return success: ${JSON.stringify(subJson)}`);
        } else {
          this.logger.log(`subscribed_apps OK for page ${page.id}`);
        }
      } catch (err: any) {
        this.logger.warn(`subscribed_apps call threw (non-fatal): ${err.message}`);
      }

      this.logger.log(
        `Meta install completed (page=${page.id} "${page.name}" · IG=${instagramAccountId ?? '—'})`,
      );
      return res.status(200).send(`
        <html><body style="font-family:sans-serif;padding:32px;max-width:520px;margin:auto">
          <h2>Facebook + Instagram conectados</h2>
          <p>Servifibras ya puede leer y responder mensajes de la página <strong>${escapeHtml(page.name)}</strong>${instagramUsername ? ` y de la cuenta de Instagram <strong>@${escapeHtml(instagramUsername)}</strong>` : ''}.</p>
          <p>Podés cerrar esta pestaña.</p>
        </body></html>
      `);
    } catch (err: any) {
      this.logger.error(`Callback error: ${err.message}`);
      return res.status(500).send(`<h2>Error interno</h2><pre>${err.message}</pre>`);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
