import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { BookmarkSyncService } from '../../bookmark/bookmark-sync.service';
import { PositionConverterService } from '../../position-converter/position-converter.service';
import { CrosspointBookmarkRepository } from '../crosspoint-bookmark.repository';
import { CrosspointDocumentService } from './crosspoint-document.service';

const EVENT = 'crosspoint.bookmark_sync';
const MAX_ITEMS = 500;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_XPATH_LENGTH = 512;

interface BookmarkItem {
  id: string;
  revision: number;
  xpath: string;
  percentage: number;
  summary: string;
  si: number | null;
  pc: number | null;
  pp: number | null;
  name: string;
  deleted: number;
  updated_at: number;
}

export interface CrosspointBookmarkList {
  document: string;
  sync_version: 2;
  cursor: number;
  until: number;
  more: boolean;
  items: BookmarkItem[];
}

@Injectable()
export class CrosspointBookmarkService {
  private readonly logger = new Logger(CrosspointBookmarkService.name);

  constructor(
    private readonly documents: CrosspointDocumentService,
    private readonly bookmarks: BookmarkSyncService,
    private readonly positionConverter: PositionConverterService,
    private readonly links: CrosspointBookmarkRepository,
  ) {}

  async list(userId: number, deviceId: number, document: string, cursor: number, limit: number): Promise<CrosspointBookmarkList> {
    const now = Math.floor(Date.now() / 1000);
    const bookFile = await this.documents.resolve(userId, deviceId, document);
    if (!bookFile) return { document, sync_version: 2, cursor, until: now, more: false, items: [] };

    const rows = await this.bookmarks.listForSync(userId, bookFile.bookId, MAX_ITEMS);
    const all: (BookmarkItem & { bookmarkId: number })[] = [];
    for (const row of rows) {
      const xpath = await this.xpathFor(row.devicePos, row.cfi, row.bookFileId ?? bookFile.id);
      if (!xpath) continue;
      const title = row.title || 'Bookmark';
      all.push({
        id: this.crosspointId(xpath),
        bookmarkId: row.id,
        revision: row.id,
        xpath,
        percentage: row.positionPercent != null ? row.positionPercent / 100 : 0,
        summary: this.truncateUtf8(title, 256),
        si: null,
        pc: null,
        pp: row.pageno,
        name: this.truncateUtf8(title, 128),
        deleted: row.deletedAt ? 1 : 0,
        updated_at: Math.floor((row.deletedAt ?? row.updatedAt).getTime() / 1000),
      });
    }

    const safeCursor = Math.max(0, Math.trunc(cursor));
    const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit || DEFAULT_LIMIT)));
    const page = all.slice(safeCursor, safeCursor + safeLimit);
    for (const item of page) {
      await this.links.upsert({
        userId,
        deviceId,
        crosspointId: item.id,
        bookmarkId: item.bookmarkId,
        xpath: item.xpath,
      });
    }

    const items: BookmarkItem[] = page.map((item) => ({
      id: item.id,
      revision: item.revision,
      xpath: item.xpath,
      percentage: item.percentage,
      summary: item.summary,
      si: item.si,
      pc: item.pc,
      pp: item.pp,
      name: item.name,
      deleted: item.deleted,
      updated_at: item.updated_at,
    }));
    const next = safeCursor + items.length;
    return { document, sync_version: 2, cursor: next, until: now, more: next < all.length, items };
  }

  async save(userId: number, deviceId: number, document: string, items: unknown[]): Promise<{ until: number; accepted: number }> {
    const now = Math.floor(Date.now() / 1000);
    const bookFile = await this.documents.resolve(userId, deviceId, document);
    if (!bookFile) {
      this.logger.warn(
        `[${EVENT}] [fail] userId=${userId} deviceId=${deviceId} document=${document.slice(0, 16)} items=${items.length} - bookmarks accepted but ignored because the book was not matched`,
      );
      return { until: now, accepted: items.length };
    }

    for (const raw of items) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const item = raw as Record<string, unknown>;
      const id = typeof item.id === 'string' ? item.id : '';
      if (!/^[0-9a-f]{16}$/i.test(id)) continue;

      if (item.deleted === 1 || item.deleted === true) {
        const link = await this.links.findByCrosspointId(userId, deviceId, id.toLowerCase());
        if (link) await this.bookmarks.tombstone(userId, [link.bookmarkId]);
        continue;
      }

      const xpath = typeof item.xpath === 'string' ? item.xpath : '';
      const percentage = typeof item.percentage === 'number' ? item.percentage : null;
      if (!xpath || xpath.length > MAX_XPATH_LENGTH || percentage === null || percentage < 0 || percentage > 1) {
        this.logger.warn(`[${EVENT}] [fail] userId=${userId} deviceId=${deviceId} id=${id} - invalid bookmark ignored`);
        continue;
      }

      const outcome = await this.positionConverter.xpointerPointToCfi({ bookFileId: bookFile.id, pos: xpath });
      if (outcome.status === 'failed' || !outcome.cfi) {
        this.logger.warn(
          `[${EVENT}] [fail] userId=${userId} deviceId=${deviceId} bookFileId=${bookFile.id} id=${id} - bookmark position could not be converted`,
        );
        continue;
      }

      const name = typeof item.name === 'string' ? item.name.trim() : '';
      const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
      const title = (name || summary || 'Bookmark').slice(0, 500);
      const pp = typeof item.pp === 'number' && Number.isInteger(item.pp) && item.pp >= 0 ? item.pp : null;
      const upserted = await this.bookmarks.upsertFromDevice(userId, bookFile.bookId, {
        bookFileId: bookFile.id,
        cfi: outcome.cfi,
        title,
        devicePos: xpath,
        pageno: pp,
        positionPercent: percentage * 100,
        origin: 'koreader',
      });
      if (!upserted) {
        this.logger.warn(`[${EVENT}] [fail] userId=${userId} deviceId=${deviceId} bookFileId=${bookFile.id} id=${id} - bookmark could not be stored`);
        continue;
      }

      await this.links.upsert({
        userId,
        deviceId,
        crosspointId: id.toLowerCase(),
        bookmarkId: upserted.row.id,
        xpath,
      });
    }

    return { until: now, accepted: items.length };
  }

  private async xpathFor(devicePos: string | null, cfi: string | null, bookFileId: number): Promise<string | null> {
    if (devicePos) return devicePos;
    if (!cfi) return null;
    try {
      const outcome = await this.positionConverter.cfiPointToXpointer({ bookFileId, cfi });
      return outcome.status === 'failed' ? null : (outcome.pos0 ?? null);
    } catch (error) {
      this.logger.warn(
        `[${EVENT}] [fail] bookFileId=${bookFileId} errorClass=${error instanceof Error ? sanitizeLogValue(error.name) : 'unknown'} - bookmark XPointer conversion failed`,
      );
      return null;
    }
  }

  private crosspointId(xpath: string): string {
    return createHash('sha256').update(xpath).digest('hex').slice(0, 16);
  }

  private truncateUtf8(value: string, maxBytes: number): string {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.length <= maxBytes) return value;
    return bytes
      .subarray(0, maxBytes)
      .toString('utf8')
      .replace(/\uFFFD+$/u, '');
  }
}
