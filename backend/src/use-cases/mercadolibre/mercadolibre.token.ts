/**
 * DI token for `MercadoLibreService` so the
 * `ConversationHandlerService` can `@Optional() @Inject` it without
 * creating a top-level import cycle (the ML module already imports
 * conversation-handler indirectly via AIModule). Resolved through
 * `MERCADOLIBRE_SERVICE` instead of the class symbol.
 */
export const MERCADOLIBRE_SERVICE = Symbol('MercadoLibreService');
