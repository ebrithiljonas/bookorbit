import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CrosspointFileEntry,
  CrosspointSelection,
  CrosspointSyncPreview,
  CrosspointSyncRun,
  CrosspointSyncStartResponse,
  CrosspointSyncStatus,
} from '@bookorbit/types';

import type { CrosspointDeviceRow, CrosspointSyncRunRow } from '../../../db/schema';
import { CrosspointRepository } from '../crosspoint.repository';
import { CrosspointSyncRepository } from '../crosspoint-sync.repository';
import { CrosspointBookSelectionService } from './crosspoint-book-selection.service';
import { CrosspointClientService } from './crosspoint-client.service';
import { buildOccupiedPaths, planBookSync } from './crosspoint-sync-planner';
import { CrosspointSyncRunner } from './crosspoint-sync-runner.service';

const PREVIEW_PAGE_SIZE = 200;
const RUN_LIST_MAX = 100;

@Injectable()
export class CrosspointSyncService {
  constructor(
    private readonly devices: CrosspointRepository,
    private readonly repository: CrosspointSyncRepository,
    private readonly selection: CrosspointBookSelectionService,
    private readonly client: CrosspointClientService,
    private readonly runner: CrosspointSyncRunner,
  ) {}

  async preview(userId: number, deviceId: number): Promise<CrosspointSyncPreview> {
    const { device, selection } = await this.loadDevice(userId, deviceId);
    await this.assertReaderReachable(device);

    const context = await this.selection.buildContext(userId, selection);
    const totals = await this.selection.countAndBytes(context);

    let remoteFiles: CrosspointFileEntry[];
    try {
      remoteFiles = await this.client.listFilesRecursive(device.host, device.httpPort, device.rootFolder);
    } catch {
      throw new BadRequestException({
        message: "The reader's managed folder could not be read. Check that it exists and that the reader is in File Transfer mode.",
        errorCode: 'CROSSPOINT_FOLDER_READ_FAILED',
      });
    }

    const remoteFilesByPath = new Map(remoteFiles.map((file) => [file.path, file]));
    const occupiedPaths = buildOccupiedPaths(device.rootFolder, remoteFiles);
    const claimedPaths = new Set<string>();
    const ledgerRows = await this.repository.listLedger(userId, device.id);
    const ledgerByBookId = new Map<number, (typeof ledgerRows)[number]>();
    for (const row of ledgerRows) {
      if (row.bookId !== null) ledgerByBookId.set(row.bookId, row);
    }

    const eligibleIds = new Set<number>();
    let newBooks = 0;
    let changedBooks = 0;
    let unchangedBooks = 0;
    let uploadBytes = 0;
    let afterBookId = 0;

    while (true) {
      const page = await this.selection.page(context, afterBookId, PREVIEW_PAGE_SIZE);
      if (page.length === 0) break;

      for (const book of page) {
        eligibleIds.add(book.bookId);
        const plan = planBookSync({
          rootFolder: device.rootFolder,
          fileNamingPattern: device.fileNamingPattern,
          book,
          fileHash: book.fileHash,
          fileSize: book.fileSize,
          ledger: ledgerByBookId.get(book.bookId),
          remoteFilesByPath,
          occupiedPaths,
          claimedPaths,
        });

        if (plan.classification === 'new') {
          newBooks += 1;
          uploadBytes += book.fileSize ?? 0;
        } else if (plan.classification === 'changed') {
          changedBooks += 1;
          uploadBytes += book.fileSize ?? 0;
        } else {
          unchangedBooks += 1;
        }
      }

      afterBookId = page[page.length - 1]!.bookId;
      if (page.length < PREVIEW_PAGE_SIZE) break;
    }

    const removedBooks = ledgerRows.filter((row) => row.bookId === null || !eligibleIds.has(row.bookId)).length;

    return {
      totalBooks: totals.books,
      totalBytes: totals.bytes,
      newBooks,
      changedBooks,
      unchangedBooks,
      removedBooks,
      uploadBytes,
    };
  }

  async start(userId: number, deviceId: number): Promise<CrosspointSyncStartResponse> {
    const { device, selection } = await this.loadDevice(userId, deviceId);
    if (this.runner.isRunning(device.id)) {
      throw new ConflictException({ message: 'A sync is already running for this reader.', errorCode: 'CROSSPOINT_SYNC_RUNNING' });
    }
    const running = await this.repository.findRunningRun(userId, device.id);
    if (running) throw new ConflictException({ message: 'A sync is already running for this reader.', errorCode: 'CROSSPOINT_SYNC_RUNNING' });

    this.runner.reserve(device.id);
    let runId: number | null = null;
    try {
      await this.assertReaderReachable(device);
      const context = await this.selection.buildContext(userId, selection);
      const totals = await this.selection.countAndBytes(context);
      const run = await this.repository.createRun({
        userId,
        deviceId: device.id,
        status: 'running',
        totalBooks: totals.books,
        totalBytes: totals.bytes,
      });
      runId = run.id;
      this.runner.start(userId, device, selection, run.id);
      return { runId: run.id };
    } catch (error) {
      this.runner.releaseReservation(device.id);
      if (runId !== null) {
        await this.repository
          .updateRun(userId, runId, {
            status: 'failed',
            finishedAt: new Date(),
            errorClass: error instanceof Error ? error.name : 'Error',
            error: error instanceof Error ? error.message.slice(0, 1000) : String(error),
          })
          .catch(() => undefined);
      }
      throw error;
    }
  }

  async status(userId: number, deviceId: number): Promise<CrosspointSyncStatus> {
    const device = await this.requireDevice(userId, deviceId);
    const run = await this.repository.findLatestRun(userId, device.id);
    if (!run) return { run: null, currentBook: null };

    return {
      run: this.toRun(run),
      currentBook: this.runner.getCurrent(device.id, run.id),
    };
  }

  async cancel(userId: number, deviceId: number): Promise<void> {
    const device = await this.requireDevice(userId, deviceId);
    if (!this.runner.cancel(device.id)) {
      throw new ConflictException({ message: 'No sync is running for this reader.', errorCode: 'CROSSPOINT_NO_ACTIVE_SYNC' });
    }
  }

  async listRuns(userId: number, deviceId: number, limit: number): Promise<CrosspointSyncRun[]> {
    const device = await this.requireDevice(userId, deviceId);
    const rows = await this.repository.listRuns(userId, device.id, Math.min(Math.max(limit, 1), RUN_LIST_MAX));
    return rows.map((row) => this.toRun(row));
  }

  private async loadDevice(userId: number, deviceId: number): Promise<{ device: CrosspointDeviceRow; selection: CrosspointSelection }> {
    const device = await this.requireDevice(userId, deviceId);
    const selections = await this.devices.listSelections(userId, [device.id]);
    return {
      device,
      selection: {
        mode: device.selectionMode,
        libraryIds: selections.libraryIdsByDevice.get(device.id) ?? [],
        collectionIds: selections.collectionIdsByDevice.get(device.id) ?? [],
        smartScopeIds: selections.smartScopeIdsByDevice.get(device.id) ?? [],
      },
    };
  }

  private async requireDevice(userId: number, deviceId: number): Promise<CrosspointDeviceRow> {
    const device = await this.devices.findDevice(userId, deviceId);
    if (!device) throw new NotFoundException('Reader not found');
    return device;
  }

  private async assertReaderReachable(device: CrosspointDeviceRow): Promise<void> {
    const probe = await this.client.probe(device.host, device.wsPort, device.httpPort);
    if (!probe.reachable) {
      throw new BadRequestException({
        message: 'The reader could not be reached. Put it into File Transfer mode and check its address and network.',
        errorCode: 'CROSSPOINT_READER_UNREACHABLE',
      });
    }
    if (!probe.isCrosspoint) {
      throw new BadRequestException({
        message: 'That address answered, but it is not a CrossPoint reader.',
        errorCode: 'CROSSPOINT_NOT_A_READER',
      });
    }
  }

  private toRun(row: CrosspointSyncRunRow): CrosspointSyncRun {
    return {
      id: row.id,
      deviceId: row.deviceId,
      status: row.status,
      totalBooks: row.totalBooks,
      uploaded: row.uploaded,
      skipped: row.skipped,
      deleted: row.deleted,
      failed: row.failed,
      totalBytes: row.totalBytes,
      transferredBytes: row.transferredBytes,
      errorClass: row.errorClass,
      error: row.error,
      failures: row.failures ?? [],
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
