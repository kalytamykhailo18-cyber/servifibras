import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { AppModule } from './app.module';
import { SentryService } from './adapters/monitoring/sentry.service';
import { SentryExceptionFilter } from './infrastructure/filters/sentry-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Preserve the raw body buffer on the request so webhook controllers
    // (TN, WhatsApp, ML) can verify HMAC signatures against bytes-on-the-
    // wire instead of a re-serialized JSON, which would break the hash.
    rawBody: true,
  });

  // Enable CORS for frontend — origins from env (CORS_ORIGINS=comma,separated,list)
  const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // Sentry global exception filter — captures uncaught 5xx exceptions to the
  // monitoring backend (no-op when SENTRY_DSN is unset). The base filter
  // requires the http adapter so it can preserve Nest's default response
  // shape for the client.
  const sentry = app.get(SentryService);
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryExceptionFilter(sentry, httpAdapter));

  // Marcos 2026-06-10: graceful shutdown. systemd sends SIGTERM on
  // `systemctl restart`; without this the Node process gets killed
  // mid-request and webhook providers (WhatsApp, ML, TN) see a 502
  // they may or may not retry. enableShutdownHooks closes the
  // express server + Nest module tree on SIGTERM/SIGINT, which:
  //   1. stops accepting new connections,
  //   2. lets in-flight requests finish,
  //   3. closes Prisma, Sentry, and the schedule registry cleanly.
  // Hard 502 window during a restart drops to a brief queue-then-
  // drain that clients don't notice, and provider webhook retries
  // cover anything that lands in the gap.
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  // Keep-alive timeout tuning so idle sockets release on shutdown.
  const server: any = app.getHttpServer();
  if (server && typeof server.keepAliveTimeout === 'number') {
    server.keepAliveTimeout = 2_000;
    server.headersTimeout = 3_000;
  }

  const port = process.env.PORT || 3001;
  await app.listen(port);

  console.log(`🚀 Servifibras Backend running on port ${port}`);
}

bootstrap();
