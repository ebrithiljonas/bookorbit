import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { RequestUser } from '../../../common/types/request-user';
import type { SaveReadingSessionDto } from '../../reading-session/dto/save-reading-session.dto';
import { ReadingSessionService } from '../../reading-session/reading-session.service';
import { CrosspointDocumentService } from './crosspoint-document.service';

const EVENT = 'crosspoint.reading_session';
const MAX_BATCH = 20;

interface SessionItem {
  session_id: string;
  document: string;
  started_at: number;
  ended_at: number;
  seconds: number;
}

@Injectable()
export class CrosspointReadingSessionService {
  private readonly logger = new Logger(CrosspointReadingSessionService.name);

  constructor(
    private readonly documents: CrosspointDocumentService,
    private readonly sessions: ReadingSessionService,
  ) {}

  async upload(user: RequestUser, device: { id: number }, body: unknown): Promise<{ until: number; accepted_session_ids: string[] }> {
    const until = Math.floor(Date.now() / 1000);
    const rawItems = body && typeof body === 'object' ? (body as { items?: unknown }).items : undefined;
    if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_BATCH) {
      throw new BadRequestException('Invalid reading session batch');
    }

    const accepted: string[] = [];
    for (const raw of rawItems) {
      const item = this.parseItem(raw);
      if (!item) continue;

      const bookFile = await this.documents.resolve(user.id, device.id, item.document);
      accepted.push(item.session_id);
      if (!bookFile) {
        this.logger.warn(
          `[${EVENT}] [fail] userId=${user.id} deviceId=${device.id} document=${item.document.slice(0, 16)} sessionId=${item.session_id} - session accepted but ignored because the book was not matched`,
        );
        continue;
      }

      const startedAt = new Date(item.started_at * 1000);
      const endedAt = new Date(item.ended_at * 1000);
      const wallClockSeconds = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));
      const dto: SaveReadingSessionDto = {
        sessionId: item.session_id,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationSeconds: Math.min(item.seconds, wallClockSeconds),
        sessionType: 'read',
      };

      try {
        await this.sessions.save(bookFile.id, dto, user, 'koreader', {
          sourceDeviceKey: `crosspoint-${device.id}`,
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `[${EVENT}] [fail] userId=${user.id} deviceId=${device.id} bookFileId=${bookFile.id} sessionId=${item.session_id} errorClass=${err.name} error="${sanitizeLogValue(err.message)}" - session accepted but could not be stored`,
        );
      }
    }

    return { until, accepted_session_ids: accepted };
  }

  private parseItem(raw: unknown): SessionItem | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const sessionId = typeof item.session_id === 'string' ? item.session_id.trim() : '';
    const document = typeof item.document === 'string' ? item.document.trim().toLowerCase() : '';
    const startedAt = item.started_at;
    const endedAt = item.ended_at;
    const seconds = item.seconds;
    if (!sessionId || sessionId.length > 64 || !/^[0-9a-f]{32,64}$/.test(document)) return null;
    if (typeof startedAt !== 'number' || !Number.isInteger(startedAt) || startedAt <= 0) return null;
    if (typeof endedAt !== 'number' || !Number.isInteger(endedAt) || endedAt < startedAt) return null;
    if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds <= 0) return null;
    return { session_id: sessionId, document, started_at: startedAt, ended_at: endedAt, seconds };
  }
}
