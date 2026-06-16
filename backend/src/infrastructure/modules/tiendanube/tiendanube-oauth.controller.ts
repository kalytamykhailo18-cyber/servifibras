import {
  Controller,
  Get,
  Logger,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { OAuthCredentialsService } from '../../../adapters/oauth/oauth-credentials.service';

@Controller('tiendanube/oauth')
export class TiendaNubeOAuthController {
  private readonly logger = new Logger(TiendaNubeOAuthController.name);

  constructor(private readonly credentials: OAuthCredentialsService) {}

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Res() res: Response,
  ) {
    if (!code) {
      return res
        .status(400)
        .send('<h2>Falta el parámetro <code>code</code></h2>');
    }

    const appId = process.env.TIENDANUBE_APP_ID;
    const clientSecret = process.env.TIENDANUBE_CLIENT_SECRET;
    const tokenUrl =
      process.env.TIENDANUBE_TOKEN_URL ||
      'https://www.tiendanube.com/apps/authorize/token';

    if (!appId || !clientSecret) {
      this.logger.error(
        'TiendaNube OAuth env not configured (need TIENDANUBE_APP_ID, TIENDANUBE_CLIENT_SECRET)',
      );
      return res
        .status(500)
        .send('<h2>OAuth no configurado en el servidor</h2>');
    }

    try {
      const body = new URLSearchParams({
        client_id: appId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
      });

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: body.toString(),
      });

      const json: any = await response.json();
      if (!response.ok) {
        this.logger.error(
          `Token exchange failed: HTTP ${response.status} — ${JSON.stringify(json)}`,
        );
        return res
          .status(502)
          .send(
            `<h2>Error intercambiando el código</h2><pre>${JSON.stringify(json, null, 2)}</pre>`,
          );
      }

      const accessToken = json.access_token;
      const userId =
        json.user_id != null ? String(json.user_id) : null;

      if (!accessToken) {
        this.logger.error(
          `Token exchange returned no access_token: ${JSON.stringify(json)}`,
        );
        return res
          .status(502)
          .send('<h2>La respuesta de TiendaNube no incluyó access_token</h2>');
      }

      const ttlSec =
        Number(process.env.TIENDANUBE_TOKEN_TTL_SEC) || 100 * 365 * 24 * 60 * 60;

      await this.credentials.save('tiendanube', {
        accessToken,
        refreshToken: null,
        externalId: userId,
        expiresInSec: ttlSec,
        metadata: { scope: json.scope, tokenType: json.token_type },
      });

      this.logger.log(
        `TiendaNube install completed (store_id=${userId ?? '—'})`,
      );

      // Auto-register product event webhooks so price/stock changes
      // reflect in the catalog in real time. Errors are logged but not
      // surfaced to the merchant — partial install is still useful (the
      // daily cron keeps things in sync as a fallback).
      if (userId) {
        this.subscribeProductWebhooks(userId, accessToken).catch((err) =>
          this.logger.warn(`webhook subscription failed: ${err.message}`),
        );
      }
      return res.status(200).send(`
        <html><body style="font-family:sans-serif;padding:32px;max-width:480px;margin:auto">
          <h2>TiendaNube conectada</h2>
          <p>Servifibras ya puede sincronizar productos y leer pedidos desde tu tienda.</p>
          <p>Podés cerrar esta pestaña.</p>
        </body></html>
      `);
    } catch (err: any) {
      this.logger.error(`Callback error: ${err.message}`);
      return res
        .status(500)
        .send(`<h2>Error interno</h2><pre>${err.message}</pre>`);
    }
  }

  private async subscribeProductWebhooks(storeId: string, accessToken: string): Promise<void> {
    const apiUrl = process.env.TIENDANUBE_API_URL || 'https://api.tiendanube.com/v1';
    const ua = process.env.TIENDANUBE_USER_AGENT || 'Servifibras-Backend';
    const target = `${process.env.TIENDANUBE_REDIRECT_URI?.replace('/oauth/callback', '/webhook') || 'https://api-dev.servifibras.com/tiendanube/webhook'}`;
    const events = ['product/created', 'product/updated', 'product/deleted'];

    for (const event of events) {
      try {
        const r = await fetch(`${apiUrl}/${storeId}/webhooks`, {
          method: 'POST',
          headers: {
            Authentication: `bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': ua,
          },
          body: JSON.stringify({ event, url: target }),
        });
        if (r.ok) {
          this.logger.log(`subscribed ${event} → ${target}`);
        } else if (r.status === 422) {
          // 422 commonly means "already exists" — not an error.
          this.logger.debug(`${event} already subscribed (422)`);
        } else {
          const body = await r.text().catch(() => '');
          this.logger.warn(`subscribe ${event} failed: HTTP ${r.status} ${body.slice(0, 200)}`);
        }
      } catch (err: any) {
        this.logger.warn(`subscribe ${event} threw: ${err.message}`);
      }
    }
  }
}
