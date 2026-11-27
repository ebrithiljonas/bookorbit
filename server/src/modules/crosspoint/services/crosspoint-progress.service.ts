import { Injectable, Logger } from '@nestjs/common';
import type { CrosspointRichPosition } from '@bookorbit/types';

import type { RequestUser } from '../../../common/types/request-user';
import { resolveTimeZone } from '../../../common/utils/timezone.utils';
import { KoreaderService } from '../../koreader/koreader.service';
import { CrosspointDocumentService } from './crosspoint-document.service';

const SYNC_EVENT = 'crosspoint.progress_sync';

export interface CrosspointProgressInput {
  document: string;
  percentage: number;
  progress?: string;
  metadata?: Record<string, unknown> | null;
  position?: CrosspointRichPosition | null;
}

@Injectable()
export class CrosspointProgressService {
  private readonly logger = new Logger(CrosspointProgressService.name);

  constructor(
    private readonly documents: CrosspointDocumentService,
    private readonly koreader: KoreaderService,
  ) {}

  async save(user: RequestUser, device: { id: number; name: string }, input: CrosspointProgressInput) {
    const startedAt = Date.now();
    const bookFile = await this.documents.resolve(user.id, device.id, input.document, input.metadata);
    const timestamp = Math.floor(Date.now() / 1000);

    if (!bookFile) {
      this.logger.warn(
        `[${SYNC_EVENT}] [fail] userId=${user.id} deviceId=${device.id} document=${input.document.slice(0, 16)} durationMs=${Date.now() - startedAt} - progress ignored because the book was not matched`,
      );
      return { document: input.document, timestamp };
    }

    await this.koreader.applyProgressForResolvedFile(
      user.id,
      bookFile,
      {
        percentage: Math.min(1, Math.max(0, input.percentage)),
        progress: typeof input.progress === 'string' ? input.progress : undefined,
        device: device.name,
        deviceId: `crosspoint-${device.id}`,
        position: this.sanitizePosition(input.position),
      },
      { timeZone: resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC') },
    );

    this.logger.log(
      `[${SYNC_EVENT}] [end] userId=${user.id} deviceId=${device.id} bookFileId=${bookFile.id} durationMs=${Date.now() - startedAt} percentage=${input.percentage} - progress applied`,
    );
    return { document: input.document, timestamp };
  }

  async get(userId: number, deviceId: number, document: string) {
    const bookFile = await this.documents.resolve(userId, deviceId, document);
    if (!bookFile) return null;
    return this.koreader.getProgressForBookFile(userId, bookFile, document);
  }

  private sanitizePosition(position?: CrosspointRichPosition | null): CrosspointRichPosition | null {
    if (!position || typeof position !== 'object') return null;
    const result: CrosspointRichPosition = {};
    for (const key of ['pctQ', 'spine', 'page', 'pages', 'para', 'li'] as const) {
      const value = position[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) result[key] = Math.trunc(value);
    }
    if (typeof position.anchor === 'string' && position.anchor.length <= 64) result.anchor = position.anchor;
    if (typeof position.xpath === 'string' && position.xpath.length <= 512) result.xpath = position.xpath;
    return Object.keys(result).length > 0 ? result : null;
  }
}
