/**
 * Catches every unhandled exception thrown by request handlers, sends it to
 * Sentry, then re-delegates to Nest's built-in exception flow so the
 * client-facing response is unchanged.
 *
 * Why a filter rather than middleware: filters are guaranteed to fire for
 * exceptions thrown anywhere in the controller / service chain (including
 * async ones), and they have access to the matched route + status code.
 *
 * Skipped for HTTP exceptions in the 4xx range (client errors) — those are
 * expected control-flow, not bugs to alert on.
 */

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter, AbstractHttpAdapter } from '@nestjs/core';
import { SentryService } from '../../adapters/monitoring/sentry.service';

@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SentryExceptionFilter.name);

  constructor(private readonly sentry: SentryService, httpAdapter: AbstractHttpAdapter) {
    // BaseExceptionFilter requires the http adapter to format the error
    // response — without it, super.catch() hangs.
    super(httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : 500;

    // Only ship 5xx and unknown to Sentry. 4xx are routine client errors
    // (auth failures, validation, 404) — alerting on them is noise.
    if (!isHttp || status >= 500) {
      const ctx = host.switchToHttp();
      const req = ctx.getRequest();
      this.sentry.captureException(exception, {
        url: req?.url,
        method: req?.method,
        userId: req?.user?.id,
        userEmail: req?.user?.email,
      });
    }

    // Hand off to Nest's default formatter so the client gets the same
    // response shape it would have without this filter.
    super.catch(exception, host);
  }
}
