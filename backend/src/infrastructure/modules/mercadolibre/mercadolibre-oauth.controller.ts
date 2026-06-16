import {
  Controller,
  Get,
  Logger,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { OAuthCredentialsService } from '../../../adapters/oauth/oauth-credentials.service';

@Controller('mercadolibre/oauth')
export class MercadoLibreOAuthController {
  private readonly logger = new Logger(MercadoLibreOAuthController.name);

  constructor(private readonly credentials: OAuthCredentialsService) {}

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ) {
    // Bloque B item 1 (Marcos 2026-06-08): multi-cuenta support.
    // The same ML app handles both cuenta 1 and cuenta 2. We
    // disambiguate via the OAuth `state` query param the install
    // URL carries — state=cuenta2 lands in the second-cuenta
    // provider key without clobbering cuenta 1's credentials.
    const provider =
      state && state.trim().toLowerCase() === 'cuenta2'
        ? 'mercadolibre_cuenta2'
        : 'mercadolibre';
    if (error) {
      this.logger.warn(
        `MercadoLibre rejected the install: ${error} — ${errorDescription ?? ''}`,
      );
      return res
        .status(400)
        .send(
          `<h2>Error de instalación</h2><p>${error}: ${
            errorDescription ?? '—'
          }</p>`,
        );
    }

    if (!code) {
      return res
        .status(400)
        .send('<h2>Falta el parámetro <code>code</code></h2>');
    }

    const appId = process.env.MERCADOLIBRE_APP_ID;
    const clientSecret = process.env.MERCADOLIBRE_CLIENT_SECRET;
    const redirectUri = process.env.MERCADOLIBRE_REDIRECT_URI;
    const tokenUrl =
      process.env.MERCADOLIBRE_TOKEN_URL ||
      'https://api.mercadolibre.com/oauth/token';

    if (!appId || !clientSecret || !redirectUri) {
      this.logger.error(
        'MercadoLibre OAuth env not configured (need MERCADOLIBRE_APP_ID, MERCADOLIBRE_CLIENT_SECRET, MERCADOLIBRE_REDIRECT_URI)',
      );
      return res
        .status(500)
        .send('<h2>OAuth no configurado en el servidor</h2>');
    }

    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: appId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
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
      const refreshToken = json.refresh_token ?? null;
      const userId = json.user_id != null ? String(json.user_id) : null;
      const expiresInSec = Number(json.expires_in) || 6 * 60 * 60;

      if (!accessToken) {
        this.logger.error(
          `Token exchange returned no access_token: ${JSON.stringify(json)}`,
        );
        return res
          .status(502)
          .send('<h2>La respuesta de Mercado Libre no incluyó access_token</h2>');
      }

      await this.credentials.save(provider, {
        accessToken,
        refreshToken,
        externalId: userId,
        expiresInSec,
        metadata: { tokenType: json.token_type, scope: json.scope },
      });

      const cuentaLabel = provider === 'mercadolibre_cuenta2' ? 'cuenta 2' : 'cuenta 1';
      this.logger.log(
        `MercadoLibre ${cuentaLabel} install completed (user_id=${userId ?? '—'})`,
      );
      return res.status(200).send(`
        <html><body style="font-family:sans-serif;padding:32px;max-width:480px;margin:auto">
          <h2>Mercado Libre (${cuentaLabel}) conectado</h2>
          <p>Servifibras ya puede leer preguntas y responder en esta cuenta de Mercado Libre.</p>
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
}
