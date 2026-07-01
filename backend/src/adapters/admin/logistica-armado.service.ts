/**
 * ADAPTERS LAYER — Logística row lifecycle (Bloque C + Bloque B #3.6).
 *
 * Originally Bloque C — Marcos 2026-06-06. Tracked which rows on the
 * daily Excel had been ticked by the picker (binary armado / no).
 *
 * Bloque B item 3.6 — Marcos 2026-06-08. Extended to a 3-state
 * machine that mirrors the PRFV placas page Marcos already uses:
 *
 *   PENDIENTE — implicit when no row exists in this table.
 *   ARMADO    — picker tildated the row, pack assembled.
 *   LISTO     — pack closed and labelled, esperando retiro.
 *
 * Transitions are forward-only via `advanceState`:
 *   PENDIENTE → ARMADO → LISTO
 * The bulk-action endpoint accepts an explicit target state so the
 * operator can mark many rows as ARMADO in one click OR jump them
 * all to LISTO without ticking each individually.
 *
 * Unmark deletes the row, returning the lifecycle to PENDIENTE.
 *
 * The `rowKey` is the same identifier the aggregator emits for each
 * row (`ml:1:pack:<packId>` / `ml:1:<orderId>` / `crm:<orderId>` /
 * `tn:<orderId>` / etc.) so state stays stable across day boundaries.
 */

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaClient, LogisticaArmado, LogisticaArmadoState } from '@prisma/client';

export type RowLifecycleState = 'PENDIENTE' | 'ARMADO' | 'LISTO';

export interface RowLifecycleLookup {
  state: RowLifecycleState;
  armadoAt: Date | null;
  listoAt: Date | null;
  stampedAt: Date;
  stampedById: string | null;
  /**
   * Marcos 2026-06-25: resolved display name of stampedBy. Antes el
   * frontend solo veía el opaque user-id en armadoById, así que no
   * podía mostrar "Armado por dario" sin un fetch por separado.
   * Resuelto en lookupMany via include de User.name (con fallback a
   * username / email). Null si el operador fue borrado (cascade
   * deja stampedById a null).
   */
  stampedByName: string | null;
  /** Bloque B item 3.7 — per-item check progress. Empty array when
   *  nothing's been ticked off yet OR for legacy rows. */
  itemsChecked: string[];
  /** Total items the picker expects to tick before LISTO. null for
   *  legacy / single-item rows where the per-item flow doesn't apply. */
  itemsExpected: number | null;
  /** Bloque B item 3.8 — per-row free-text note ("falta confirmar
   *  color", "pedido frágil") the armador types inline. Null when
   *  the row hasn't been annotated yet. */
  notes: string | null;
  /** Marcos 2026-06-10: which flex courier carried the package (FLEX
   *  rows only). Null when unset. */
  flexCourier: string | null;
  /** Marcos 2026-06-10: timestamp the picker dismissed a cancelled
   *  row. Aggregator drops rows with archivedAt != null from the
   *  panel. */
  archivedAt: Date | null;
  /** Marcos 2026-06-10: per-row manual section override. When set,
   *  the aggregator places the row in this section instead of the
   *  computed one. Used for ML "Acordá entrega" vs "Acordá envío"
   *  where the API can't auto-distinguish. */
  sectionOverride: string | null;
  /** Marcos 2026-06-10: manual dispatch confirmation. Aggregator
   *  treats the row as dispatched when this is non-null, even if
   *  the underlying ML/TN order says otherwise. */
  manuallyDispatchedAt: Date | null;
}

@Injectable()
export class LogisticaArmadoService {
  private readonly logger = new Logger(LogisticaArmadoService.name);
  private readonly prisma = new PrismaClient();

  /**
   * Mark a row ARMADO. Idempotent — re-calling on an already-armado
   * row leaves the original armadoAt timestamp alone (so re-clicking
   * doesn't reset the picker's completion time). Kept for backwards
   * compatibility with the existing toggle endpoint; `setState` /
   * `advanceState` are the preferred surface for the 3-state UI.
   */
  async mark(args: {
    rowKey: string;
    dayDate: string;
    stampedById: string | null;
  }): Promise<LogisticaArmado> {
    return this.setState({
      rowKey: args.rowKey,
      dayDate: args.dayDate,
      targetState: LogisticaArmadoState.ARMADO,
      stampedById: args.stampedById,
    });
  }

  /**
   * Set a row to an explicit state. Idempotent on ARMADO/LISTO; the
   * relevant per-state timestamp is preserved if it already exists
   * (re-marking ARMADO doesn't reset armadoAt; re-marking LISTO
   * doesn't reset listoAt). Setting LISTO on a row that's still
   * PENDIENTE in the table also stamps armadoAt — the row went
   * through ARMADO implicitly in the same click.
   */
  async setState(args: {
    rowKey: string;
    dayDate: string;
    targetState: LogisticaArmadoState;
    stampedById: string | null;
  }): Promise<LogisticaArmado> {
    const now = new Date();
    const existing = await this.prisma.logisticaArmado.findUnique({
      where: { rowKey: args.rowKey },
    });
    // Marcos 2026-06-25: ver guardItemsCompleteForListo — el bulk
    // "Enviar a Listas para despachar" llegaba acá sin chequeo y
    // dejaba paquetes en Despachadas con items pendientes.
    if (args.targetState === LogisticaArmadoState.LISTO && existing) {
      this.guardItemsCompleteForListo(existing);
    }
    const armadoAt =
      args.targetState === LogisticaArmadoState.ARMADO ||
      args.targetState === LogisticaArmadoState.LISTO
        ? existing?.armadoAt ?? now
        : null;
    const listoAt =
      args.targetState === LogisticaArmadoState.LISTO
        ? existing?.listoAt ?? now
        : null;
    if (existing) {
      const row = await this.prisma.logisticaArmado.update({
        where: { rowKey: args.rowKey },
        data: {
          state: args.targetState,
          armadoAt,
          listoAt,
          stampedAt: now,
          stampedById: args.stampedById ?? existing.stampedById,
          dayDate: args.dayDate || existing.dayDate,
        },
      });
      this.logger.log(
        `lifecycle: ${args.rowKey} → ${args.targetState} (by ${args.stampedById?.slice(0, 8) ?? 'unknown'})`,
      );
      return row;
    }
    const row = await this.prisma.logisticaArmado.create({
      data: {
        rowKey: args.rowKey,
        dayDate: args.dayDate,
        state: args.targetState,
        armadoAt,
        listoAt,
        stampedById: args.stampedById ?? null,
      },
    });
    this.logger.log(
      `lifecycle: ${args.rowKey} → ${args.targetState} (first set, by ${args.stampedById?.slice(0, 8) ?? 'unknown'})`,
    );
    return row;
  }

  /**
   * Forward-only state advance. PENDIENTE → ARMADO → LISTO. Calling
   * advance on LISTO is a no-op (returns the existing row). Used by
   * the row-level click handler in the daily logística panel.
   *
   * Bloque B item 3.7 — Marcos 2026-06-08: when the row carries an
   * `itemsExpected` count (per-item check flow), the LISTO transition
   * refuses to fire until every item has been ticked off. Throws an
   * Error the controller maps to a 409 so the UI can keep the LISTO
   * button disabled with a clear message.
   */
  async advanceState(args: {
    rowKey: string;
    dayDate: string;
    stampedById: string | null;
  }): Promise<LogisticaArmado> {
    const existing = await this.prisma.logisticaArmado.findUnique({
      where: { rowKey: args.rowKey },
    });
    // Marcos 2026-06-11: PENDIENTE is now a real state in the
    // enum (rows with admin-side metadata can carry it). Advance
    // ladder: PENDIENTE → ARMADO → LISTO → LISTO (no-op).
    const nextState: LogisticaArmadoState =
      !existing
        ? LogisticaArmadoState.ARMADO
        : existing.state === LogisticaArmadoState.PENDIENTE
          ? LogisticaArmadoState.ARMADO
          : existing.state === LogisticaArmadoState.ARMADO
            ? LogisticaArmadoState.LISTO
            : LogisticaArmadoState.LISTO; // already LISTO → idempotent
    if (nextState === LogisticaArmadoState.LISTO && existing) {
      this.guardItemsCompleteForListo(existing);
    }
    return this.setState({
      rowKey: args.rowKey,
      dayDate: args.dayDate,
      targetState: nextState,
      stampedById: args.stampedById,
    });
  }

  /**
   * Marcos 2026-06-25: el guard "no se puede mandar a LISTO sin todos
   * los items tildados" antes vivía solo en advance(), así que
   * bulkSetState (botón "Enviar a Listas para despachar") y
   * setFlexCourier (auto-promote al asignar courier) lo bypasseaban.
   * Eso producía packs en Despachadas con items sin marcar — Marcos
   * lo reportó porque no podía verificar si un reclamo era válido.
   * Helper compartido: cualquier path que mueva a LISTO lo invoca.
   * itemsExpected ≤ 1 ⇒ no per-item flow (pack chico o sin tracking),
   * skip silencioso. Mismo BadRequestException-equivalente (Error con
   * code='ITEMS_INCOMPLETE') que advance() ya tiraba — el frontend
   * lo cazaba y mostraba al operador.
   */
  private guardItemsCompleteForListo(existing: LogisticaArmado): void {
    const expected = existing.itemsExpected ?? 0;
    const checked = Array.isArray(existing.itemsChecked as any)
      ? (existing.itemsChecked as string[]).length
      : 0;
    if (expected > 1 && checked < expected) {
      const err: any = new BadRequestException(
        `Faltan ${expected - checked} de ${expected} items por tildar antes de enviar a Listas (${checked}/${expected} tildados).`,
      );
      err.code = 'ITEMS_INCOMPLETE';
      err.checked = checked;
      err.expected = expected;
      throw err;
    }
  }

  /**
   * Bloque B item 3.7 — Marcos 2026-06-08: toggle per-item check for
   * the multi-item picker flow. Stamps `itemsExpected` on first call
   * (so the LISTO guard knows the denominator) and adds/removes
   * `itemKey` from the `itemsChecked` array. Idempotent — repeated
   * checks on the same key are no-ops. Also advances state to
   * ARMADO if the row was implicitly PENDIENTE (first tick = packing
   * started).
   */
  async toggleItemCheck(args: {
    rowKey: string;
    dayDate: string;
    itemKey: string;
    checked: boolean;
    itemsExpected: number;
    stampedById: string | null;
  }): Promise<LogisticaArmado> {
    const now = new Date();
    const existing = await this.prisma.logisticaArmado.findUnique({
      where: { rowKey: args.rowKey },
    });
    // Marcos 2026-06-27 (audit fix): congelar el state de los items
    // una vez que la fila pasó a LISTO. El frontend ya disabilita los
    // checkboxes en ese state (page.tsx:1757), pero un call directo a
    // la API podía cambiarlos igual y corromper la evidencia que el
    // operador puede mirar después en un reclamo. Para corregir items
    // post-LISTO el operador tiene que revertir a Pendiente primero,
    // que es el flujo intencionado.
    if (existing && existing.state === LogisticaArmadoState.LISTO) {
      throw new BadRequestException(
        'No se pueden modificar items en una fila LISTO. Revertí a Pendiente primero.',
      );
    }
    const prevChecked = Array.isArray(existing?.itemsChecked as any)
      ? ((existing!.itemsChecked as any) as string[])
      : [];
    const set = new Set(prevChecked);
    if (args.checked) {
      set.add(args.itemKey);
    } else {
      // Marcos 2026-06-30: además del delete exact, remover TODA
      // entrada con el mismo <sku>: prefix. Los índices dentro del
      // key (SKU:idx) dependen del orden que el aggregator devuelve
      // para el pack, que puede variar entre requests. Sin este
      // limpieza-por-prefijo, un stamp viejo con índice desactualizado
      // (ej. "6x5002:2") sobrevive un untick del key nuevo (ej.
      // "6x5002:1") y el reader tolerante lo sigue mostrando tildado
      // creando confusión "toqué el checkbox pero no se apagó".
      set.delete(args.itemKey);
      const colon = args.itemKey.indexOf(':');
      const rawPrefix = colon > 0 ? args.itemKey.substring(0, colon) : '';
      // Excluir "item" (items sin sku son order-dependent solamente
      // — clean-by-prefix borraría todos los item:* de golpe).
      if (rawPrefix && rawPrefix !== 'item') {
        const pref = rawPrefix + ':';
        for (const k of Array.from(set)) if (k.startsWith(pref)) set.delete(k);
      }
    }
    const nextChecked = Array.from(set);
    const expected = Math.max(args.itemsExpected, prevChecked.length, nextChecked.length);

    if (existing) {
      return this.prisma.logisticaArmado.update({
        where: { rowKey: args.rowKey },
        data: {
          itemsChecked: nextChecked as any,
          itemsExpected: expected,
          stampedAt: now,
          stampedById: args.stampedById ?? existing.stampedById,
          // Stay in ARMADO until the operator hits advance — items
          // ticking is independent of the row-level state pill.
          state:
            existing.state === LogisticaArmadoState.LISTO
              ? LogisticaArmadoState.LISTO
              : LogisticaArmadoState.ARMADO,
          armadoAt: existing.armadoAt ?? now,
        },
      });
    }
    return this.prisma.logisticaArmado.create({
      data: {
        rowKey: args.rowKey,
        dayDate: args.dayDate,
        state: LogisticaArmadoState.ARMADO,
        armadoAt: now,
        itemsChecked: nextChecked as any,
        itemsExpected: expected,
        stampedById: args.stampedById ?? null,
      },
    });
  }

  /**
   * Bulk set many rows to the same target state in one call. Used by
   * the "select N rows + Marcar LISTO" action bar on the daily
   * logística panel. Each row is upserted independently so a single
   * failed row doesn't block the rest.
   */
  async bulkSetState(args: {
    rowKeys: string[];
    dayDate: string;
    targetState: LogisticaArmadoState;
    stampedById: string | null;
  }): Promise<{
    updated: number;
    created: number;
    failed: string[];
    // Marcos 2026-06-25: motivos per-row para que el frontend pueda
    // mostrar "Cliente X: faltan 2 items" en lugar de un genérico
    // "N con error". Mismo patrón que bulkSetManualDispatch.
    failedReasons?: Array<{ rowKey: string; reason: string }>;
  }> {
    const result = {
      updated: 0,
      created: 0,
      failed: [] as string[],
      failedReasons: [] as Array<{ rowKey: string; reason: string }>,
    };
    if (args.rowKeys.length === 0) return result;
    for (const rowKey of args.rowKeys) {
      try {
        const existed = await this.prisma.logisticaArmado.findUnique({
          where: { rowKey },
        });
        await this.setState({
          rowKey,
          dayDate: args.dayDate,
          targetState: args.targetState,
          stampedById: args.stampedById,
        });
        if (existed) result.updated++;
        else result.created++;
      } catch (err: any) {
        this.logger.warn(`bulkSetState: ${rowKey} failed: ${err.message}`);
        result.failed.push(rowKey);
        result.failedReasons.push({ rowKey, reason: err?.message ?? 'error' });
      }
    }
    this.logger.log(
      `bulk lifecycle: ${args.rowKeys.length} rows → ${args.targetState} (created=${result.created} updated=${result.updated} failed=${result.failed.length})`,
    );
    return result;
  }

  /**
   * Bloque B item 3.8 — Marcos 2026-06-08: set the per-row free-text
   * note. Empty string clears it (back to null). Creates the row if
   * needed but stays in ARMADO state — the note is independent of
   * the lifecycle pill.
   */
  async setNote(args: {
    rowKey: string;
    dayDate: string;
    note: string | null;
    stampedById: string | null;
  }): Promise<LogisticaArmado> {
    const now = new Date();
    const cleaned = args.note?.trim();
    const value = cleaned && cleaned.length > 0 ? cleaned.slice(0, 500) : null;
    const existing = await this.prisma.logisticaArmado.findUnique({
      where: { rowKey: args.rowKey },
    });
    if (existing) {
      return this.prisma.logisticaArmado.update({
        where: { rowKey: args.rowKey },
        data: {
          notes: value,
          stampedAt: now,
          stampedById: args.stampedById ?? existing.stampedById,
          dayDate: args.dayDate || existing.dayDate,
        },
      });
    }
    return this.prisma.logisticaArmado.create({
      data: {
        rowKey: args.rowKey,
        dayDate: args.dayDate,
        // Marcos 2026-06-11: writing a note is admin-side, not a
        // lifecycle event. Keep state PENDIENTE so the state pill
        // stays clickable.
        state: LogisticaArmadoState.PENDIENTE,
        notes: value,
        stampedById: args.stampedById ?? null,
      },
    });
  }

  /**
   * Marcos 2026-06-10: tag a FLEX row with the actual courier that
   * picked up the box (3 logistics rotate through Marcos's flex
   * orders). Stored on LogisticaArmado so the trace stays put across
   * day boundaries — if the package gets lost we know who had it.
   * Accepts the bulk variant by rowKey list so the picker can mark
   * a whole group at once.
   */
  async setFlexCourier(args: {
    rowKey: string;
    dayDate: string;
    courier: string | null;
    stampedById: string | null;
  }): Promise<LogisticaArmado> {
    const now = new Date();
    const cleaned = args.courier?.trim();
    const value = cleaned && cleaned.length > 0 ? cleaned.slice(0, 120) : null;
    const existing = await this.prisma.logisticaArmado.findUnique({
      where: { rowKey: args.rowKey },
    });
    // Marcos 2026-06-25: cuando se asigna courier (value !== null) y la
    // fila todavía no está LISTO, auto-promoveer a LISTO en el mismo
    // call. Comprime los 2 pasos que hacía el operador hoy (click
    // "Enviar a Listas para despachar" + después asignar courier).
    // Asignar courier en sí mismo es señal de que el paquete está
    // listo para que el courier se lo lleve. Si está clearing (null),
    // NO tocamos state — limpiar el courier no debe regresar a
    // PENDIENTE ni promover a LISTO.
    const shouldPromoteToListo =
      value !== null &&
      existing != null &&
      existing.state !== LogisticaArmadoState.LISTO;
    // Marcos 2026-06-25: si vamos a promover a LISTO, aplicamos el
    // mismo guard que advance()/setState — no se permite LISTO con
    // items pendientes. Esto evita que asignar courier desde Pendientes
    // saltee la verificación de contenido del pack.
    if (shouldPromoteToListo) {
      this.guardItemsCompleteForListo(existing);
    }
    if (existing) {
      return this.prisma.logisticaArmado.update({
        where: { rowKey: args.rowKey },
        data: {
          flexCourier: value,
          stampedAt: now,
          stampedById: args.stampedById ?? existing.stampedById,
          dayDate: args.dayDate || existing.dayDate,
          ...(shouldPromoteToListo
            ? {
                state: LogisticaArmadoState.LISTO,
                listoAt: existing.listoAt ?? now,
                armadoAt: existing.armadoAt ?? now,
              }
            : {}),
        },
      });
    }
    // Sin LogisticaArmado row previo: si se asigna courier, creamos
    // la fila en ARMADO (no LISTO). Marcos 2026-06-27 (audit fix):
    // antes auto-promovíamos a LISTO acá también, pero sin existing
    // no tenemos itemsExpected/itemsChecked para correr el guard del
    // contenido. Para packs multi-item esto dejaba el pack como
    // LISTO sin que el operador haya verificado items — exactamente
    // el caso que Marcos reportó el 06-25 ("aparece en despachados
    // con items sin marcar"). Si el operador quiere mandarlo a
    // Listas, hace click "Enviar a Listas" después y ahí corre el
    // guard. Para packs de 1 item el "extra click" es trivial.
    return this.prisma.logisticaArmado.create({
      data: {
        rowKey: args.rowKey,
        dayDate: args.dayDate,
        state: value !== null
          ? LogisticaArmadoState.ARMADO
          : LogisticaArmadoState.PENDIENTE,
        flexCourier: value,
        ...(value !== null ? { armadoAt: now } : {}),
        stampedById: args.stampedById ?? null,
      },
    });
  }
  /**
   * Marcos 2026-06-10: archive cancelled rows so they leave the
   * panel. The picker confirms the cancellation, hits "Eliminar
   * cancelada(s)", and the rows get an `archivedAt` stamp. The
   * aggregator skips any row with a non-null archivedAt — those
   * "moved to the cancelled-orders module" (a separate view we
   * surface later). Idempotent: re-archiving updates the timestamp.
   * Bulk variant by rowKey list.
   */
  async archiveCancelled(args: {
    rowKeys: string[];
    dayDate: string;
    stampedById: string | null;
  }): Promise<{ archived: number; failed: string[] }> {
    const result = { archived: 0, failed: [] as string[] };
    const now = new Date();
    for (const rowKey of args.rowKeys) {
      try {
        const existing = await this.prisma.logisticaArmado.findUnique({
          where: { rowKey },
        });
        if (existing) {
          await this.prisma.logisticaArmado.update({
            where: { rowKey },
            data: {
              archivedAt: now,
              stampedAt: now,
              stampedById: args.stampedById ?? existing.stampedById,
              dayDate: args.dayDate || existing.dayDate,
            },
          });
        } else {
          await this.prisma.logisticaArmado.create({
            data: {
              rowKey,
              dayDate: args.dayDate,
              // Marcos 2026-06-11: archiving a cancelled row is
              // terminal — it leaves the panel. Stamp PENDIENTE so
              // the lifecycle doesn't get a phantom ARMADO.
              state: LogisticaArmadoState.PENDIENTE,
              archivedAt: now,
              stampedById: args.stampedById ?? null,
            },
          });
        }
        result.archived++;
      } catch (err: any) {
        this.logger.warn(`archiveCancelled: ${rowKey} failed: ${err.message}`);
        result.failed.push(rowKey);
      }
    }
    this.logger.log(
      `archive cancelled: ${result.archived} rows by ${args.stampedById?.slice(0, 8) ?? 'unknown'} (failed=${result.failed.length})`,
    );
    return result;
  }
  /**
   * Marcos 2026-06-10: undo archive — used when the picker hits the
   * wrong button. Restores rows to their pre-archive state by
   * clearing archivedAt; the row reappears in the panel on next
   * refresh.
   */
  async unarchive(rowKeys: string[]): Promise<{ updated: number }> {
    let updated = 0;
    for (const rowKey of rowKeys) {
      try {
        await this.prisma.logisticaArmado.update({
          where: { rowKey },
          data: { archivedAt: null, stampedAt: new Date() },
        });
        updated++;
      } catch { /* tolerate missing rows */ }
    }
    return { updated };
  }

  /**
   * Marcos 2026-06-10: manual dispatch flag. The picker stamps a
   * row as dispatched when a courier physically took the boxes OR a
   * buyer picked up at the Caseros store — ML/TN can't auto-detect
   * those cases. Pass `dispatched=false` to clear and let the row
   * fall back to the source-side dispatch flag. Bulk variant below.
   */
  async setManualDispatch(args: {
    rowKey: string;
    dayDate: string;
    dispatched: boolean;
    stampedById: string | null;
  }): Promise<LogisticaArmado> {
    const now = new Date();
    const value = args.dispatched ? now : null;
    // Marcos 2026-06-25: regla "si o si" — para marcar despachado
    // necesitamos saber qué courier se llevó el paquete, para poder
    // rastrearlo si después no se entrega. Sin flexCourier rechazamos
    // el dispatch con un mensaje que el frontend muestra como toast.
    // Solo aplica al dispatch (no al clear), y solo a rows existentes
    // (los nuevos directos vienen desde un row sin courier y ya están
    // bloqueados por la misma regla aplicada al setManualDispatch que
    // no pasa por el row existente — el bulk handler los crea con
    // state=LISTO sin courier, lo cual no debería pasar; mantenemos
    // el guard también para esos para defender el invariante).
    if (args.dispatched && !args.rowKey.startsWith('prfv:')) {
      const cur = await this.prisma.logisticaArmado.findUnique({
        where: { rowKey: args.rowKey },
        select: { flexCourier: true },
      });
      const courier = cur?.flexCourier?.trim();
      if (!courier) {
        throw new BadRequestException(
          'Asigná un courier antes de marcar como despachada — no podemos rastrear el paquete si no sabemos quién se lo llevó.',
        );
      }
    }
    // Marcos 2026-06-12: PRFV laminado rows in the daily panel are
    // backed by a `PrfvPlaca` row, not an Order. When the operator
    // marks the row dispatched here we must also flip the underlying
    // placa to DESPACHADA_RETIRADA so the PRFV admin page stays in
    // sync — otherwise the placa lives on as LISTA_CORTADA forever.
    await this.maybeCascadePrfvDispatch(args.rowKey, args.dispatched).catch(() => {});
    const existing = await this.prisma.logisticaArmado.findUnique({
      where: { rowKey: args.rowKey },
    });
    if (existing) {
      return this.prisma.logisticaArmado.update({
        where: { rowKey: args.rowKey },
        data: {
          manuallyDispatchedAt: value,
          stampedAt: now,
          stampedById: args.stampedById ?? existing.stampedById,
          dayDate: args.dayDate || existing.dayDate,
        },
      });
    }
    return this.prisma.logisticaArmado.create({
      data: {
        rowKey: args.rowKey,
        dayDate: args.dayDate,
        state: LogisticaArmadoState.LISTO,
        manuallyDispatchedAt: value,
        listoAt: value,
        stampedById: args.stampedById ?? null,
      },
    });
  }

  /**
   * Marcos 2026-06-12: when a PRFV row is marked dispatched in the
   * daily panel, flip the underlying PrfvPlaca to
   * DESPACHADA_RETIRADA. When the operator clears the dispatch flag
   * we walk it back to LISTA_CORTADA. rowKey shape is `prfv:<id>`.
   */
  private async maybeCascadePrfvDispatch(rowKey: string, dispatched: boolean): Promise<void> {
    if (!rowKey.startsWith('prfv:')) return;
    const placaId = rowKey.slice('prfv:'.length);
    if (!placaId) return;
    await this.prisma.prfvPlaca.update({
      where: { id: placaId },
      data: {
        state: dispatched ? 'DESPACHADA_RETIRADA' : 'LISTA_CORTADA',
        stateChangedAt: new Date(),
      },
    });
  }
  async bulkSetManualDispatch(args: {
    rowKeys: string[];
    dayDate: string;
    dispatched: boolean;
    stampedById: string | null;
  }): Promise<{
    updated: number;
    failed: string[];
    // Marcos 2026-06-25: failures per row, así el frontend puede
    // mostrar el motivo concreto (ej. "sin courier") en el toast.
    failedReasons?: Array<{ rowKey: string; reason: string }>;
  }> {
    const result = {
      updated: 0,
      failed: [] as string[],
      failedReasons: [] as Array<{ rowKey: string; reason: string }>,
    };
    for (const rowKey of args.rowKeys) {
      try {
        await this.setManualDispatch({
          rowKey,
          dayDate: args.dayDate,
          dispatched: args.dispatched,
          stampedById: args.stampedById,
        });
        result.updated++;
      } catch (err: any) {
        this.logger.warn(`bulkSetManualDispatch: ${rowKey} failed: ${err.message}`);
        result.failed.push(rowKey);
        result.failedReasons.push({ rowKey, reason: err?.message ?? 'error' });
      }
    }
    this.logger.log(
      `manual dispatch: ${result.updated} rows → ${args.dispatched ? 'dispatched' : 'cleared'} (failed=${result.failed.length})`,
    );
    return result;
  }

  /**
   * Marcos 2026-06-10: set the manual section override for one or
   * many rows. Used by the per-row "Mover a Retira Caseros" action
   * (and any future re-bucket flows). Pass `section=null` to clear
   * the override and let the row drop back to its computed section.
   */
  async setSectionOverride(args: {
    rowKey: string;
    dayDate: string;
    section: string | null;
    stampedById: string | null;
  }): Promise<LogisticaArmado> {
    const now = new Date();
    const value = args.section?.trim() || null;
    const existing = await this.prisma.logisticaArmado.findUnique({
      where: { rowKey: args.rowKey },
    });
    if (existing) {
      return this.prisma.logisticaArmado.update({
        where: { rowKey: args.rowKey },
        data: {
          sectionOverride: value,
          stampedAt: now,
          stampedById: args.stampedById ?? existing.stampedById,
          dayDate: args.dayDate || existing.dayDate,
        },
      });
    }
    return this.prisma.logisticaArmado.create({
      data: {
        rowKey: args.rowKey,
        dayDate: args.dayDate,
        // Marcos 2026-06-11: moving a row between sections is just
        // a re-bucket; the picker hasn't touched the box. Stay at
        // PENDIENTE so the state pill on the panel keeps working
        // (PENDIENTE → ARMADO → LISTO) and so the row doesn't
        // appear armado before anyone touched it.
        state: LogisticaArmadoState.PENDIENTE,
        sectionOverride: value,
        stampedById: args.stampedById ?? null,
      },
    });
  }
  async bulkSetSectionOverride(args: {
    rowKeys: string[];
    dayDate: string;
    section: string | null;
    stampedById: string | null;
  }): Promise<{ updated: number; failed: string[] }> {
    const result = { updated: 0, failed: [] as string[] };
    for (const rowKey of args.rowKeys) {
      try {
        await this.setSectionOverride({
          rowKey,
          dayDate: args.dayDate,
          section: args.section,
          stampedById: args.stampedById,
        });
        result.updated++;
      } catch (err: any) {
        this.logger.warn(`bulkSetSectionOverride: ${rowKey} failed: ${err.message}`);
        result.failed.push(rowKey);
      }
    }
    return result;
  }

  async bulkSetFlexCourier(args: {
    rowKeys: string[];
    dayDate: string;
    courier: string | null;
    stampedById: string | null;
  }): Promise<{
    updated: number;
    failed: string[];
    failedReasons?: Array<{ rowKey: string; reason: string }>;
  }> {
    const result = {
      updated: 0,
      failed: [] as string[],
      failedReasons: [] as Array<{ rowKey: string; reason: string }>,
    };
    for (const rowKey of args.rowKeys) {
      try {
        await this.setFlexCourier({
          rowKey,
          dayDate: args.dayDate,
          courier: args.courier,
          stampedById: args.stampedById,
        });
        result.updated++;
      } catch (err: any) {
        this.logger.warn(`bulkSetFlexCourier: ${rowKey} failed: ${err.message}`);
        result.failed.push(rowKey);
        result.failedReasons.push({ rowKey, reason: err?.message ?? 'error' });
      }
    }
    return result;
  }

  /**
   * Revert a row to PENDIENTE. Marcos 2026-06-11: previously this
   * just deleted the LogisticaArmado row — which also wiped any
   * sectionOverride / flexCourier / note / itemsChecked the picker
   * had attached. Marcos hit this when reverting an ARMADO row that
   * had been moved to MICROS via "Mover a…": the revert sent it
   * back to MOTOS because the override died with the row. Now we
   * KEEP the row and only roll the lifecycle fields back to a
   * pristine state. Anything purely administrative (section
   * override, courier stamp, note, archived flag) stays put. If the
   * resulting row carries no metadata at all, we delete it to keep
   * the table tidy.
   *
   * Returns true if a row was touched (deleted or updated).
   */
  async unmark(rowKey: string): Promise<boolean> {
    const existing = await this.prisma.logisticaArmado.findUnique({ where: { rowKey } });
    if (!existing) return false;
    const hasAdminFields =
      existing.sectionOverride != null
      || existing.flexCourier != null
      || (typeof existing.notes === 'string' && existing.notes.length > 0)
      || existing.archivedAt != null;
    if (!hasAdminFields) {
      // No metadata to preserve — original behaviour.
      try {
        await this.prisma.logisticaArmado.delete({ where: { rowKey } });
        this.logger.log(`lifecycle: ${rowKey} → PENDIENTE (deleted, no metadata to keep)`);
        return true;
      } catch (err: any) {
        if (err?.code === 'P2025') return false;
        throw err;
      }
    }
    // Keep the row, clear lifecycle fields.
    await this.prisma.logisticaArmado.update({
      where: { rowKey },
      data: {
        state: LogisticaArmadoState.PENDIENTE,
        armadoAt: null,
        listoAt: null,
        itemsChecked: [] as any,
        manuallyDispatchedAt: null,
        stampedAt: new Date(),
      },
    });
    this.logger.log(`lifecycle: ${rowKey} → PENDIENTE (preserved sectionOverride/courier/note)`);
    return true;
  }

  /**
   * Bulk lookup for the aggregator. Returns a map keyed by rowKey
   * with the full lifecycle data. Keys not in the result are
   * implicitly PENDIENTE.
   */
  async lookupMany(rowKeys: string[]): Promise<Map<string, RowLifecycleLookup>> {
    const map = new Map<string, RowLifecycleLookup>();
    if (rowKeys.length === 0) return map;
    const rows = await this.prisma.logisticaArmado.findMany({
      where: { rowKey: { in: rowKeys } },
      select: {
        rowKey: true,
        state: true,
        armadoAt: true,
        listoAt: true,
        stampedAt: true,
        stampedById: true,
        // Marcos 2026-06-25: include para resolver el nombre del
        // armador en un solo round-trip; sin esto el panel mostraba
        // el id opaco.
        stampedBy: { select: { name: true, username: true, email: true } },
        itemsChecked: true,
        itemsExpected: true,
        notes: true,
        flexCourier: true,
        archivedAt: true,
        sectionOverride: true,
        manuallyDispatchedAt: true,
      },
    });
    for (const r of rows) {
      const itemsChecked = Array.isArray(r.itemsChecked as any)
        ? ((r.itemsChecked as any) as string[])
        : [];
      const sb = (r as any).stampedBy as
        | { name: string | null; username: string | null; email: string | null }
        | null;
      const stampedByName = sb
        ? (sb.name?.trim() || sb.username?.trim() || sb.email?.trim() || null)
        : null;
      map.set(r.rowKey, {
        state: r.state as RowLifecycleState,
        armadoAt: r.armadoAt,
        listoAt: r.listoAt,
        stampedAt: r.stampedAt,
        stampedById: r.stampedById,
        stampedByName,
        itemsChecked,
        itemsExpected: r.itemsExpected,
        notes: r.notes,
        flexCourier: r.flexCourier,
        archivedAt: r.archivedAt,
        sectionOverride: r.sectionOverride,
        manuallyDispatchedAt: r.manuallyDispatchedAt,
      });
    }
    return map;
  }
}
