import { Inject, Injectable } from '@nestjs/common';
import type { CrosspointSelection } from '@bookorbit/types';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type DeviceValues = Partial<typeof schema.crosspointDevices.$inferInsert>;

export interface DeviceSelectionRows {
  collectionIdsByDevice: Map<number, number[]>;
  smartScopeIdsByDevice: Map<number, number[]>;
}

@Injectable()
export class CrosspointRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  listDevices(userId: number) {
    return this.db
      .select()
      .from(schema.crosspointDevices)
      .where(eq(schema.crosspointDevices.userId, userId))
      .orderBy(asc(schema.crosspointDevices.createdAt));
  }

  async findDevice(userId: number, deviceId: number) {
    return this.db.query.crosspointDevices.findFirst({
      where: and(eq(schema.crosspointDevices.id, deviceId), eq(schema.crosspointDevices.userId, userId)),
    });
  }

  async findDeviceByStableId(userId: number, stableDeviceId: string) {
    return this.db.query.crosspointDevices.findFirst({
      where: and(eq(schema.crosspointDevices.userId, userId), eq(schema.crosspointDevices.deviceId, stableDeviceId)),
    });
  }

  async findDeviceByAddress(userId: number, host: string, wsPort: number) {
    return this.db.query.crosspointDevices.findFirst({
      where: and(eq(schema.crosspointDevices.userId, userId), eq(schema.crosspointDevices.host, host), eq(schema.crosspointDevices.wsPort, wsPort)),
    });
  }

  async createDevice(values: typeof schema.crosspointDevices.$inferInsert, selection: CrosspointSelection) {
    return this.db.transaction(async (tx) => {
      const [device] = await tx.insert(schema.crosspointDevices).values(values).returning();
      await this.replaceSelection(tx, device.userId, device.id, selection);
      return device;
    });
  }

  async updateDevice(userId: number, deviceId: number, values: DeviceValues, selection?: CrosspointSelection) {
    return this.db.transaction(async (tx) => {
      let device: typeof schema.crosspointDevices.$inferSelect | undefined;
      if (Object.keys(values).length > 0) {
        [device] = await tx
          .update(schema.crosspointDevices)
          .set(values)
          .where(and(eq(schema.crosspointDevices.id, deviceId), eq(schema.crosspointDevices.userId, userId)))
          .returning();
      } else {
        [device] = await tx
          .select()
          .from(schema.crosspointDevices)
          .where(and(eq(schema.crosspointDevices.id, deviceId), eq(schema.crosspointDevices.userId, userId)))
          .limit(1);
      }

      if (!device) return undefined;
      if (selection) await this.replaceSelection(tx, userId, deviceId, selection);
      return device;
    });
  }

  async updateDeviceFields(userId: number, deviceId: number, values: DeviceValues) {
    const [device] = await this.db
      .update(schema.crosspointDevices)
      .set(values)
      .where(and(eq(schema.crosspointDevices.id, deviceId), eq(schema.crosspointDevices.userId, userId)))
      .returning();
    return device;
  }

  async deleteDevice(userId: number, deviceId: number): Promise<boolean> {
    const deleted = await this.db
      .delete(schema.crosspointDevices)
      .where(and(eq(schema.crosspointDevices.id, deviceId), eq(schema.crosspointDevices.userId, userId)))
      .returning({ id: schema.crosspointDevices.id });
    return deleted.length > 0;
  }

  async listSelections(userId: number, deviceIds: number[]): Promise<DeviceSelectionRows> {
    const collectionIdsByDevice = new Map<number, number[]>();
    const smartScopeIdsByDevice = new Map<number, number[]>();
    if (deviceIds.length === 0) return { collectionIdsByDevice, smartScopeIdsByDevice };

    const [collectionRows, smartScopeRows] = await Promise.all([
      this.db
        .select({ deviceId: schema.crosspointDeviceCollections.deviceId, collectionId: schema.crosspointDeviceCollections.collectionId })
        .from(schema.crosspointDeviceCollections)
        .where(and(eq(schema.crosspointDeviceCollections.userId, userId), inArray(schema.crosspointDeviceCollections.deviceId, deviceIds))),
      this.db
        .select({ deviceId: schema.crosspointDeviceSmartScopes.deviceId, smartScopeId: schema.crosspointDeviceSmartScopes.smartScopeId })
        .from(schema.crosspointDeviceSmartScopes)
        .where(and(eq(schema.crosspointDeviceSmartScopes.userId, userId), inArray(schema.crosspointDeviceSmartScopes.deviceId, deviceIds))),
    ]);

    for (const row of collectionRows) {
      const ids = collectionIdsByDevice.get(row.deviceId) ?? [];
      ids.push(row.collectionId);
      collectionIdsByDevice.set(row.deviceId, ids);
    }
    for (const row of smartScopeRows) {
      const ids = smartScopeIdsByDevice.get(row.deviceId) ?? [];
      ids.push(row.smartScopeId);
      smartScopeIdsByDevice.set(row.deviceId, ids);
    }
    return { collectionIdsByDevice, smartScopeIdsByDevice };
  }

  async findOwnedCollectionIds(userId: number, collectionIds: number[]): Promise<number[]> {
    if (collectionIds.length === 0) return [];
    const rows = await this.db
      .select({ id: schema.collections.id })
      .from(schema.collections)
      .where(and(eq(schema.collections.userId, userId), inArray(schema.collections.id, collectionIds)));
    return rows.map((row) => row.id);
  }

  async findVisibleSmartScopeIds(userId: number, smartScopeIds: number[]): Promise<number[]> {
    if (smartScopeIds.length === 0) return [];
    const rows = await this.db
      .select({ id: schema.smartScopes.id })
      .from(schema.smartScopes)
      .where(and(inArray(schema.smartScopes.id, smartScopeIds), or(eq(schema.smartScopes.userId, userId), eq(schema.smartScopes.isPublic, true))));
    return rows.map((row) => row.id);
  }

  private async replaceSelection(tx: Transaction, userId: number, deviceId: number, selection: CrosspointSelection): Promise<void> {
    await tx
      .delete(schema.crosspointDeviceCollections)
      .where(and(eq(schema.crosspointDeviceCollections.userId, userId), eq(schema.crosspointDeviceCollections.deviceId, deviceId)));
    await tx
      .delete(schema.crosspointDeviceSmartScopes)
      .where(and(eq(schema.crosspointDeviceSmartScopes.userId, userId), eq(schema.crosspointDeviceSmartScopes.deviceId, deviceId)));

    if (selection.collectionIds.length > 0) {
      await tx
        .insert(schema.crosspointDeviceCollections)
        .values(selection.collectionIds.map((collectionId) => ({ userId, deviceId, collectionId })))
        .onConflictDoNothing();
    }
    if (selection.smartScopeIds.length > 0) {
      await tx
        .insert(schema.crosspointDeviceSmartScopes)
        .values(selection.smartScopeIds.map((smartScopeId) => ({ userId, deviceId, smartScopeId })))
        .onConflictDoNothing();
    }
  }
}
