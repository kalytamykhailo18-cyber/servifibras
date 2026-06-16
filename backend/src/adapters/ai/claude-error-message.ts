/**
 * ADAPTERS LAYER — Claude error → operator-friendly message
 *
 * Anthropic SDK errors come back as English JSON blobs that mean
 * nothing to a Spanish-speaking operator clicking "Redactar con IA" or
 * watching an AI reply silently not arrive. This helper detects the
 * common upstream failure patterns and returns a clean Spanish line
 * that names the actual blocker AND who has to act on it (Marcos for
 * billing/key issues, the operator for transient retries).
 *
 * Patterns covered today:
 *   - "credit balance is too low"        → recargar API key (Marcos)
 *   - "invalid x-api-key" / 401          → key inválida (Marcos)
 *   - "rate_limit" / 429                 → reintentar en unos segundos
 *   - "overloaded_error" / 529           → Anthropic saturado, reintentar
 *   - network / timeout                  → conexión, reintentar
 *   - default                            → genérico "IA no disponible"
 */
export function claudeErrorMessage(err: any): string {
  const raw = String(err?.message ?? err?.error?.message ?? err ?? '');
  const lower = raw.toLowerCase();

  if (lower.includes('credit balance') || lower.includes('billing')) {
    return 'Crédito de IA agotado. Avisale a Marcos para recargar la API key de Anthropic — el agente vuelve apenas se recargue.';
  }
  if (lower.includes('invalid x-api-key') || lower.includes('authentication_error') || lower.includes('unauthorized')) {
    return 'API key de IA inválida o expirada. Marcos tiene que actualizar la key — el agente queda pausado hasta entonces.';
  }
  if (lower.includes('rate_limit') || lower.includes('429') || lower.includes('too many requests')) {
    return 'La IA recibió demasiadas consultas en este momento. Esperá unos segundos y volvé a intentar.';
  }
  if (lower.includes('overloaded') || lower.includes('529') || lower.includes('503')) {
    return 'El servicio de IA está sobrecargado por un momento. Reintentá enseguida.';
  }
  if (lower.includes('econnreset') || lower.includes('timeout') || lower.includes('network')) {
    return 'No se pudo conectar con la IA (red o tiempo de espera). Intentá de nuevo en un instante.';
  }
  return 'La IA no está disponible en este momento. Reintentá; si persiste, avisale a Marcos.';
}
