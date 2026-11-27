import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db/db.module';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface CrosspointBookmarkLinkInput {
  userId: number;
  deviceId: number;
  crosspointId: string;
  bookmarkId: number;
  xpath: string;
}

@Injectable()
export class CrosspointBookmarkRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findByCrosspointId(userId: number, deviceId: number, crosspointId: string) {
    return this.db.query.crosspointBookmarkLinks.findFirst({
      where: and(
        eq(schema.crosspointBookmarkLinks.userId, userId),
        eq(schema.crosspointBookmarkLinks.deviceId, deviceId),
        eq(schema.crosspointBookmarkLinks.crosspointId, crosspointId),
      ),
    });
  }

  async upsert(link: CrosspointBookmarkLinkInput): Promise<void> {
    await this.db
      .insert(schema.crosspointBookmarkLinks)
      .values(link)
      .onConflictDoUpdate({
        target: [schema.crosspointBookmarkLinks.deviceId, schema.crosspointBookmarkLinks.crosspointId],
        set: { bookmarkId: link.bookmarkId, xpath: link.xpath, updatedAt: new Date() },
      });
  }
}
