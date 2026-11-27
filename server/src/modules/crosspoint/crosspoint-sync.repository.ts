import { Inject, Injectable } from '@nestjs/common';
import type { GroupRule } from '@bookorbit/types';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type RunValues = Partial<typeof schema.crosspointSyncRuns.$inferInsert>;
type LedgerValues = Partial<typeof schema.crosspointDeviceBooks.$inferInsert>;

export interface CrosspointSmartScopeFilter {
  id: number;
  filter: GroupRule | null;
}

@Injectable()
export class CrosspointSyncRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async createRun(values: typeof schema.crosspointSyncRuns.$inferInsert) {
    const [run] = await this.db.insert(schema.crosspointSyncRuns).values(values).returning();
    return run;
  }

  async updateRun(userId: number, runId: number, values: RunValues) {
    const [run] = await this.db
      .update(schema.crosspointSyncRuns)
      .set(values)
      .where(and(eq(schema.crosspointSyncRuns.id, runId), eq(schema.crosspointSyncRuns.userId, userId)))
      .returning();
    return run;
  }

  async findRun(userId: number, runId: number) {
    return this.db.query.crosspointSyncRuns.findFirst({
      where: and(eq(schema.crosspointSyncRuns.id, runId), eq(schema.crosspointSyncRuns.userId, userId)),
    });
  }

  async findLatestRun(userId: number, deviceId: number) {
    return this.db.query.crosspointSyncRuns.findFirst({
      where: and(eq(schema.crosspointSyncRuns.userId, userId), eq(schema.crosspointSyncRuns.deviceId, deviceId)),
      orderBy: [desc(schema.crosspointSyncRuns.startedAt), desc(schema.crosspointSyncRuns.id)],
    });
  }

  async findRunningRun(userId: number, deviceId: number) {
    return this.db.query.crosspointSyncRuns.findFirst({
      where: and(
        eq(schema.crosspointSyncRuns.userId, userId),
        eq(schema.crosspointSyncRuns.deviceId, deviceId),
        eq(schema.crosspointSyncRuns.status, 'running'),
      ),
    });
  }

  async listRuns(userId: number, deviceId: number, limit: number) {
    return this.db
      .select()
      .from(schema.crosspointSyncRuns)
      .where(and(eq(schema.crosspointSyncRuns.userId, userId), eq(schema.crosspointSyncRuns.deviceId, deviceId)))
      .orderBy(desc(schema.crosspointSyncRuns.startedAt), desc(schema.crosspointSyncRuns.id))
      .limit(limit);
  }

  async markRunningRunsInterrupted() {
    const interrupted = await this.db
      .update(schema.crosspointSyncRuns)
      .set({
        status: 'interrupted',
        finishedAt: sql`now()`,
        errorClass: 'Interrupted',
        error: 'Server restarted before the sync finished',
      })
      .where(eq(schema.crosspointSyncRuns.status, 'running'))
      .returning({ id: schema.crosspointSyncRuns.id });
    return interrupted.map((row) => row.id);
  }

  listLedger(userId: number, deviceId: number) {
    return this.db
      .select()
      .from(schema.crosspointDeviceBooks)
      .where(and(eq(schema.crosspointDeviceBooks.userId, userId), eq(schema.crosspointDeviceBooks.deviceId, deviceId)))
      .orderBy(asc(schema.crosspointDeviceBooks.id));
  }

  async insertLedgerBook(values: typeof schema.crosspointDeviceBooks.$inferInsert) {
    const [row] = await this.db.insert(schema.crosspointDeviceBooks).values(values).returning();
    return row;
  }

  async updateLedgerBook(userId: number, ledgerId: number, values: LedgerValues) {
    const [row] = await this.db
      .update(schema.crosspointDeviceBooks)
      .set(values)
      .where(and(eq(schema.crosspointDeviceBooks.id, ledgerId), eq(schema.crosspointDeviceBooks.userId, userId)))
      .returning();
    return row;
  }

  async deleteLedgerBook(userId: number, ledgerId: number): Promise<void> {
    await this.db
      .delete(schema.crosspointDeviceBooks)
      .where(and(eq(schema.crosspointDeviceBooks.id, ledgerId), eq(schema.crosspointDeviceBooks.userId, userId)));
  }

  async findStaleLedgerRows(userId: number, deviceId: number, runId: number) {
    return this.db
      .select()
      .from(schema.crosspointDeviceBooks)
      .where(
        and(
          eq(schema.crosspointDeviceBooks.userId, userId),
          eq(schema.crosspointDeviceBooks.deviceId, deviceId),
          or(isNull(schema.crosspointDeviceBooks.lastSeenRunId), ne(schema.crosspointDeviceBooks.lastSeenRunId, runId)),
        ),
      )
      .orderBy(asc(schema.crosspointDeviceBooks.id));
  }

  async listLibraryIds(): Promise<number[]> {
    const rows = await this.db.select({ id: schema.libraries.id }).from(schema.libraries);
    return rows.map((row) => row.id);
  }

  async findSmartScopesForSelection(userId: number, smartScopeIds: number[]): Promise<CrosspointSmartScopeFilter[]> {
    if (smartScopeIds.length === 0) return [];
    return this.db
      .select({ id: schema.smartScopes.id, filter: schema.smartScopes.filter })
      .from(schema.smartScopes)
      .where(and(inArray(schema.smartScopes.id, smartScopeIds), or(eq(schema.smartScopes.userId, userId), eq(schema.smartScopes.isPublic, true))));
  }

  async getUserTimeZone(userId: number): Promise<string> {
    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: { settings: true },
    });
    return typeof (user?.settings as { timezone?: unknown } | undefined)?.timezone === 'string'
      ? ((user?.settings as { timezone?: string }).timezone ?? 'UTC')
      : 'UTC';
  }
}
