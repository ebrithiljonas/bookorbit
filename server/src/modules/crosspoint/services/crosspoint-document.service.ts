import { Injectable, Logger } from '@nestjs/common';

import { LibraryScopeService } from '../../../common/library-scope/library-scope.service';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { CrosspointRepository, type CrosspointBookFile } from '../crosspoint.repository';
import { KoreaderRepository } from '../../koreader/koreader.repository';

const RESOLVE_EVENT = 'crosspoint.document_resolve';

export interface CrosspointDocumentMetadata {
  bookorbit_file_id?: unknown;
  filename?: unknown;
  title?: unknown;
  authors?: unknown;
}

export interface CrosspointResolvedDocument extends CrosspointBookFile {
  progressCompatible: true;
}

@Injectable()
export class CrosspointDocumentService {
  private readonly logger = new Logger(CrosspointDocumentService.name);

  constructor(
    private readonly repository: CrosspointRepository,
    private readonly koreaderRepository: KoreaderRepository,
    private readonly libraryScope: LibraryScopeService,
  ) {}

  async resolve(
    userId: number,
    deviceId: number,
    document: string,
    metadata?: CrosspointDocumentMetadata | null,
  ): Promise<CrosspointResolvedDocument | null> {
    const startedAt = Date.now();
    const accessibleLibraryIds = await this.libraryScope.visibleIdsOrAllForUserId(userId);
    const hash = document.toLowerCase();

    const sidecarFileId = this.parseFileId(metadata?.bookorbit_file_id);
    if (sidecarFileId !== null) {
      const file = await this.repository.findAccessibleBookFileById(userId, sidecarFileId, accessibleLibraryIds);
      if (file) {
        await this.learn(userId, deviceId, hash, file.id);
        return this.resolved(file);
      }
    }

    const mapped = await this.repository.findDeviceDocument(userId, deviceId, hash, accessibleLibraryIds);
    if (mapped) return this.resolved(mapped);

    const ledgerFilename = await this.repository.findLedgerBookFileByRemoteFilenameHash(userId, deviceId, hash, accessibleLibraryIds);
    if (ledgerFilename) {
      await this.learn(userId, deviceId, hash, ledgerFilename.id);
      return this.resolved(ledgerFilename);
    }

    const ledgerBinary = await this.repository.findLedgerBookFileByFileHash(userId, deviceId, hash, accessibleLibraryIds);
    if (ledgerBinary) {
      await this.learn(userId, deviceId, hash, ledgerBinary.id);
      return this.resolved(ledgerBinary);
    }

    const globalBinary = await this.koreaderRepository.resolveBookFileByHash(hash, accessibleLibraryIds, userId);
    if (globalBinary) {
      await this.learn(userId, deviceId, hash, globalBinary.id);
      return this.resolved(globalBinary);
    }

    this.logger.warn(
      `[${RESOLVE_EVENT}] [fail] userId=${userId} deviceId=${deviceId} document=${document.slice(0, 16)} durationMs=${Date.now() - startedAt} metadata="${sanitizeLogValue(this.describeMetadata(metadata))}" - document could not be matched to a book`,
    );
    return null;
  }

  async learn(userId: number, deviceId: number, document: string, bookFileId: number): Promise<void> {
    if (!/^[0-9a-f]{32,64}$/i.test(document)) return;
    await this.repository.upsertDeviceDocument({ userId, deviceId, documentHash: document.toLowerCase(), bookFileId });
  }

  private resolved(file: CrosspointBookFile): CrosspointResolvedDocument {
    return { ...file, progressCompatible: true };
  }

  private parseFileId(value: unknown): number | null {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
  }

  private describeMetadata(metadata?: CrosspointDocumentMetadata | null): string {
    if (!metadata) return '';
    return [metadata.filename, metadata.title, metadata.authors]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' | ')
      .slice(0, 200);
  }
}
