import { ConflictException, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { CrosspointFileEntry, CrosspointSelection, CrosspointSyncFailure } from '@bookorbit/types';
import { stat } from 'node:fs/promises';

import { computeFileHash } from '../../../common/utils/file-hash.utils';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import type { CrosspointDeviceBookRow, CrosspointDeviceRow } from '../../../db/schema';
import { deviceBasename, deviceDirname, normalizeDevicePath } from '../crosspoint-path.utils';
import { CrosspointRepository } from '../crosspoint.repository';
import { CrosspointSyncRepository } from '../crosspoint-sync.repository';
import { CrosspointBookSelectionService, type CrosspointSyncBook } from './crosspoint-book-selection.service';
import { CrosspointAbortError, CrosspointClientService, CrosspointDeviceError } from './crosspoint-client.service';
import { buildOccupiedPaths, planBookSync } from './crosspoint-sync-planner';

const PAGE_SIZE = 100;
const UPLOAD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2_000;
const PROGRESS_PERSIST_INTERVAL_MS = 1_000;
const FAILURE_LIMIT = 100;

interface SyncCounters {
  uploaded: number;
  skipped: number;
  deleted: number;
  failed: number;
  transferredBytes: number;
}

interface ActiveRun {
  runId: number;
  controller: AbortController;
  current: { id: number; title: string | null; bytes: number; transferred: number } | null;
}

interface ProcessBookParams {
  userId: number;
  device: CrosspointDeviceRow;
  runId: number;
  book: CrosspointSyncBook;
  ledger: CrosspointDeviceBookRow | undefined;
  ledgerByBookId: Map<number, CrosspointDeviceBookRow>;
  remoteFilesByPath: Map<string, CrosspointFileEntry>;
  occupiedPaths: Set<string>;
  claimedPaths: Set<string>;
  ensuredDirectories: Set<string>;
  deletedPaths: string[];
  failures: CrosspointSyncFailure[];
  counters: SyncCounters;
  signal: AbortSignal;
}

class CrosspointFatalSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrosspointFatalSyncError';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof CrosspointDeviceError && /file already exists/i.test(error.deviceMessage);
}

function isDiskFullError(error: unknown): boolean {
  return error instanceof CrosspointDeviceError && /disk full/i.test(error.deviceMessage);
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

@Injectable()
export class CrosspointSyncRunner implements OnModuleInit {
  private readonly logger = new Logger(CrosspointSyncRunner.name);
  private readonly active = new Map<number, ActiveRun>();
  private readonly reserved = new Set<number>();

  constructor(
    private readonly devices: CrosspointRepository,
    private readonly repository: CrosspointSyncRepository,
    private readonly selection: CrosspointBookSelectionService,
    private readonly client: CrosspointClientService,
  ) {}

  async onModuleInit(): Promise<void> {
    const interrupted = await this.repository.markRunningRunsInterrupted();
    if (interrupted.length > 0) {
      this.logger.warn(`[crosspoint.sync] [end] interrupted=${interrupted.length} - marked running syncs interrupted after restart`);
    }
  }

  isRunning(deviceId: number): boolean {
    return this.active.has(deviceId) || this.reserved.has(deviceId);
  }

  reserve(deviceId: number): void {
    if (this.isRunning(deviceId)) {
      throw new ConflictException({ message: 'A sync is already running for this reader.', errorCode: 'CROSSPOINT_SYNC_RUNNING' });
    }
    this.reserved.add(deviceId);
  }

  releaseReservation(deviceId: number): void {
    this.reserved.delete(deviceId);
  }

  start(userId: number, device: CrosspointDeviceRow, selection: CrosspointSelection, runId: number): void {
    if (this.active.has(device.id)) {
      throw new ConflictException({ message: 'A sync is already running for this reader.', errorCode: 'CROSSPOINT_SYNC_RUNNING' });
    }
    this.reserved.delete(device.id);
    const controller = new AbortController();
    this.active.set(device.id, { runId, controller, current: null });
    void this.execute(userId, device, selection, runId, controller.signal).catch((error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `[crosspoint.sync] [fail] userId=${userId} deviceId=${device.id} runId=${runId} errorClass=${err.name} error="${sanitizeLogValue(err.message)}" - sync runner crashed`,
      );
      this.active.delete(device.id);
    });
  }

  cancel(deviceId: number): boolean {
    const active = this.active.get(deviceId);
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  getCurrent(deviceId: number, runId: number): ActiveRun['current'] {
    const active = this.active.get(deviceId);
    return active && active.runId === runId ? active.current : null;
  }

  private async execute(
    userId: number,
    device: CrosspointDeviceRow,
    selection: CrosspointSelection,
    runId: number,
    signal: AbortSignal,
  ): Promise<void> {
    const startedAt = Date.now();
    const counters: SyncCounters = { uploaded: 0, skipped: 0, deleted: 0, failed: 0, transferredBytes: 0 };
    const failures: CrosspointSyncFailure[] = [];
    const deletedPaths: string[] = [];
    let lastPersist = 0;

    this.logger.log(`[crosspoint.sync] [start] userId=${userId} deviceId=${device.id} runId=${runId} - sync started`);

    try {
      const run = await this.repository.findRun(userId, runId);
      if (!run) throw new Error('Sync run not found');

      const probe = await this.client.probe(device.host, device.wsPort, device.httpPort);
      if (!probe.reachable || !probe.isCrosspoint) throw new Error(probe.error ?? 'Reader is not reachable');

      const rootFolder = normalizeDevicePath(device.rootFolder);
      const ensuredDirectories = new Set<string>();
      await this.ensureDirectory(device, rootFolder, ensuredDirectories);

      const remoteFiles = await this.client.listFilesRecursive(device.host, device.httpPort, rootFolder);
      const remoteFilesByPath = new Map(remoteFiles.map((file) => [file.path, file]));
      const occupiedPaths = buildOccupiedPaths(rootFolder, remoteFiles);
      const claimedPaths = new Set<string>();

      const ledgerRows = await this.repository.listLedger(userId, device.id);
      const ledgerByBookId = new Map<number, CrosspointDeviceBookRow>();
      for (const row of ledgerRows) {
        if (row.bookId !== null) ledgerByBookId.set(row.bookId, row);
      }

      const context = await this.selection.buildContext(userId, selection);
      let afterBookId = 0;

      while (true) {
        if (signal.aborted) throw new CrosspointAbortError('Sync cancelled');
        const page = await this.selection.page(context, afterBookId, PAGE_SIZE);
        if (page.length === 0) break;

        for (const book of page) {
          if (signal.aborted) throw new CrosspointAbortError('Sync cancelled');
          await this.processBook({
            userId,
            device,
            runId,
            book,
            ledger: ledgerByBookId.get(book.bookId),
            ledgerByBookId,
            remoteFilesByPath,
            occupiedPaths,
            claimedPaths,
            ensuredDirectories,
            deletedPaths,
            failures,
            counters,
            signal,
          });

          if (Date.now() - lastPersist >= PROGRESS_PERSIST_INTERVAL_MS) {
            lastPersist = Date.now();
            await this.persistProgress(userId, runId, counters);
          }
        }

        afterBookId = page[page.length - 1]!.bookId;
        await this.persistProgress(userId, runId, counters);
        if (page.length < PAGE_SIZE) break;
      }

      const selectionIsEmpty = selection.mode === 'selected' && selection.collectionIds.length === 0 && selection.smartScopeIds.length === 0;

      if (device.removeMissing && !selectionIsEmpty) {
        const stale = await this.repository.findStaleLedgerRows(userId, device.id, runId);
        for (const row of stale) {
          if (signal.aborted) throw new CrosspointAbortError('Sync cancelled');
          try {
            const paths = [row.remotePath, this.sidecarPath(row.remotePath)];
            if (paths.some((path) => remoteFilesByPath.has(path))) {
              await this.client.deletePaths(
                device.host,
                device.httpPort,
                paths.filter((path) => remoteFilesByPath.has(path)),
              );
              for (const path of paths) remoteFilesByPath.delete(path);
            }
            await this.repository.deleteLedgerBook(userId, row.id);
            counters.deleted += 1;
            deletedPaths.push(row.remotePath);
          } catch (error) {
            failures.push({
              bookId: row.bookId ?? 0,
              title: null,
              remotePath: row.remotePath,
              errorClass: error instanceof Error ? error.name : 'Error',
              error: errorMessage(error),
            });
            counters.failed += 1;
          }
        }
      }

      if (deletedPaths.length > 0) {
        try {
          await this.client.pruneEmptyDirectories(device.host, device.httpPort, rootFolder, deletedPaths);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.debug(
            `[crosspoint.sync] [fail] deviceId=${device.id} runId=${runId} errorClass=${err.name} error="${sanitizeLogValue(err.message)}" - empty folder cleanup skipped`,
          );
        }
      }

      await this.repository.updateRun(userId, runId, {
        status: 'completed',
        finishedAt: new Date(),
        ...counters,
        failures: failures.slice(0, FAILURE_LIMIT),
        errorClass: null,
        error: null,
      });
      await this.devices.updateDeviceFields(userId, device.id, { lastSyncAt: new Date() });

      this.logger.log(
        `[crosspoint.sync] [end] userId=${userId} deviceId=${device.id} runId=${runId} durationMs=${Date.now() - startedAt} uploaded=${counters.uploaded} skipped=${counters.skipped} deleted=${counters.deleted} failed=${counters.failed} - sync completed`,
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const cancelled = signal.aborted || err instanceof CrosspointAbortError;
      if (cancelled) {
        await this.repository
          .updateRun(userId, runId, {
            status: 'cancelled',
            finishedAt: new Date(),
            ...counters,
            failures: failures.slice(0, FAILURE_LIMIT),
            errorClass: 'Cancelled',
            error: 'Sync cancelled',
          })
          .catch(() => undefined);
        this.logger.log(
          `[crosspoint.sync] [end] userId=${userId} deviceId=${device.id} runId=${runId} durationMs=${Date.now() - startedAt} cancelled=true uploaded=${counters.uploaded} skipped=${counters.skipped} deleted=${counters.deleted} failed=${counters.failed} - sync cancelled`,
        );
      } else {
        await this.repository
          .updateRun(userId, runId, {
            status: 'failed',
            finishedAt: new Date(),
            ...counters,
            failures: failures.slice(0, FAILURE_LIMIT),
            errorClass: err.name,
            error: err.message.slice(0, 1000),
          })
          .catch(() => undefined);
        this.logger.warn(
          `[crosspoint.sync] [fail] userId=${userId} deviceId=${device.id} runId=${runId} durationMs=${Date.now() - startedAt} errorClass=${err.name} error="${sanitizeLogValue(err.message)}" uploaded=${counters.uploaded} skipped=${counters.skipped} deleted=${counters.deleted} failed=${counters.failed} - sync failed`,
        );
      }
    } finally {
      this.active.delete(device.id);
    }
  }

  private async processBook(params: ProcessBookParams): Promise<void> {
    const {
      userId,
      device,
      runId,
      book,
      ledger,
      ledgerByBookId,
      remoteFilesByPath,
      occupiedPaths,
      claimedPaths,
      ensuredDirectories,
      deletedPaths,
      failures,
      counters,
      signal,
    } = params;

    let fileSize: number;
    let fileHash = book.fileHash;
    try {
      const stats = await stat(book.filePath);
      fileSize = stats.size;
      if (!fileHash) fileHash = await computeFileHash(book.filePath);
    } catch (error) {
      const fallback = planBookSync({
        rootFolder: device.rootFolder,
        fileNamingPattern: device.fileNamingPattern,
        book,
        fileHash: null,
        fileSize: null,
        ledger,
        remoteFilesByPath,
        occupiedPaths,
        claimedPaths,
      });
      await this.recordSeen(userId, device.id, runId, ledger, ledgerByBookId, book, fallback.remotePath);
      failures.push({
        bookId: book.bookId,
        title: book.title,
        remotePath: fallback.remotePath,
        errorClass: error instanceof Error ? error.name : 'Error',
        error: errorMessage(error),
      });
      counters.failed += 1;
      return;
    }

    const plan = planBookSync({
      rootFolder: device.rootFolder,
      fileNamingPattern: device.fileNamingPattern,
      book,
      fileHash,
      fileSize,
      ledger,
      remoteFilesByPath,
      occupiedPaths,
      claimedPaths,
    });

    if (plan.action === 'skip') {
      await this.recordSeen(userId, device.id, runId, ledger, ledgerByBookId, book, plan.remotePath);
      await this.ensureSidecar(device, book, plan.remotePath, remoteFilesByPath, ensuredDirectories, signal);
      counters.skipped += 1;
      return;
    }

    if (plan.action === 'adopt') {
      await this.recordSuccess(userId, device.id, runId, ledger, ledgerByBookId, book, {
        remotePath: plan.remotePath,
        fileHash,
        fileSize,
      });
      await this.ensureSidecar(device, book, plan.remotePath, remoteFilesByPath, ensuredDirectories, signal);
      counters.skipped += 1;
      return;
    }

    this.setCurrent(device.id, runId, book, fileSize);

    try {
      if (plan.deleteBeforeUpload) {
        await this.client.deletePaths(device.host, device.httpPort, [plan.remotePath]);
        remoteFilesByPath.delete(plan.remotePath);
      }

      const directory = deviceDirname(plan.remotePath);
      await this.ensureDirectory(device, directory, ensuredDirectories);

      await this.uploadWithRetries(device, plan.remotePath, book.filePath, signal, (transferred) =>
        this.updateCurrent(device.id, runId, transferred),
      );

      if (plan.previousPath) {
        try {
          const oldSidecar = this.sidecarPath(plan.previousPath);
          const oldPaths = [plan.previousPath, oldSidecar].filter((path) => remoteFilesByPath.has(path));
          if (oldPaths.length > 0) await this.client.deletePaths(device.host, device.httpPort, oldPaths);
          remoteFilesByPath.delete(plan.previousPath);
          remoteFilesByPath.delete(oldSidecar);
          deletedPaths.push(plan.previousPath);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.warn(
            `[crosspoint.sync] [fail] deviceId=${device.id} runId=${runId} path="${sanitizeLogValue(plan.previousPath)}" errorClass=${err.name} error="${sanitizeLogValue(err.message)}" - old book path could not be removed`,
          );
        }
      }

      await this.recordSuccess(userId, device.id, runId, ledger, ledgerByBookId, book, {
        remotePath: plan.remotePath,
        fileHash,
        fileSize,
      });
      await this.ensureSidecar(device, book, plan.remotePath, remoteFilesByPath, ensuredDirectories, signal);
      remoteFilesByPath.set(plan.remotePath, {
        path: plan.remotePath,
        name: deviceBasename(plan.remotePath),
        size: fileSize,
        isDirectory: false,
        isEpub: true,
      });
      for (const ancestor of this.ancestorPaths(plan.remotePath, device.rootFolder)) occupiedPaths.add(ancestor);
      counters.uploaded += 1;
      counters.transferredBytes += fileSize;
    } catch (error) {
      if (error instanceof CrosspointAbortError || signal.aborted) throw new CrosspointAbortError('Sync cancelled');
      if (isDiskFullError(error)) {
        failures.push({
          bookId: book.bookId,
          title: book.title,
          remotePath: plan.remotePath,
          errorClass: error instanceof Error ? error.name : 'Error',
          error: errorMessage(error),
        });
        counters.failed += 1;
        throw new CrosspointFatalSyncError('The reader ran out of storage space');
      }

      await this.recordSeen(userId, device.id, runId, ledger, ledgerByBookId, book, plan.remotePath);
      failures.push({
        bookId: book.bookId,
        title: book.title,
        remotePath: plan.remotePath,
        errorClass: error instanceof Error ? error.name : 'Error',
        error: errorMessage(error),
      });
      counters.failed += 1;
    } finally {
      this.clearCurrent(device.id, runId);
    }
  }

  private sidecarPath(remotePath: string): string {
    return `${remotePath}.meta.json`;
  }

  private async ensureSidecar(
    device: CrosspointDeviceRow,
    book: CrosspointSyncBook,
    remotePath: string,
    remoteFilesByPath: Map<string, CrosspointFileEntry>,
    ensuredDirectories: Set<string>,
    signal: AbortSignal,
  ): Promise<void> {
    const sidecarPath = this.sidecarPath(remotePath);
    if (remoteFilesByPath.has(sidecarPath)) return;

    const contents = Buffer.from(JSON.stringify({ bookorbit_file_id: String(book.fileId), bookorbit_book_id: String(book.bookId) }), 'utf8');
    const directory = deviceDirname(sidecarPath);
    await this.ensureDirectory(device, directory, ensuredDirectories);

    for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
      try {
        await this.client.uploadFile({
          host: device.host,
          wsPort: device.wsPort,
          directory,
          filename: deviceBasename(sidecarPath),
          contents,
          signal,
        });
        remoteFilesByPath.set(sidecarPath, {
          path: sidecarPath,
          name: deviceBasename(sidecarPath),
          size: contents.length,
          isDirectory: false,
          isEpub: false,
        });
        return;
      } catch (error) {
        if (signal.aborted || error instanceof CrosspointAbortError) throw new CrosspointAbortError('Sync cancelled');
        if (attempt >= UPLOAD_ATTEMPTS) {
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.warn(
            `[crosspoint.sync] [fail] deviceId=${device.id} path="${sanitizeLogValue(sidecarPath)}" errorClass=${err.name} error="${sanitizeLogValue(err.message)}" - sidecar metadata upload skipped`,
          );
          return;
        }
        await delay(RETRY_DELAY_MS);
      }
    }
  }

  private async uploadWithRetries(
    device: CrosspointDeviceRow,
    remotePath: string,
    filePath: string,
    signal: AbortSignal,
    onProgress: (transferred: number) => void,
  ): Promise<void> {
    const directory = deviceDirname(remotePath);
    const filename = deviceBasename(remotePath);
    let lastError: unknown;

    for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
      try {
        await this.client.uploadFile({
          host: device.host,
          wsPort: device.wsPort,
          directory,
          filename,
          filePath,
          signal,
          onProgress: (progress) => onProgress(progress.sent),
        });
        return;
      } catch (error) {
        lastError = error;
        if (signal.aborted || error instanceof CrosspointAbortError) throw new CrosspointAbortError('Sync cancelled');
        if (attempt >= UPLOAD_ATTEMPTS) break;
        if (isFileExistsError(error)) {
          try {
            await this.client.deletePaths(device.host, device.httpPort, [remotePath]);
          } catch {
            // The next attempt reports the same device error if the file remains.
          }
        }
        await delay(RETRY_DELAY_MS);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async recordSuccess(
    userId: number,
    deviceId: number,
    runId: number,
    ledger: CrosspointDeviceBookRow | undefined,
    ledgerByBookId: Map<number, CrosspointDeviceBookRow>,
    book: CrosspointSyncBook,
    values: { remotePath: string; fileHash: string | null; fileSize: number },
  ): Promise<void> {
    if (ledger) {
      await this.repository.updateLedgerBook(userId, ledger.id, {
        bookId: book.bookId,
        fileId: book.fileId,
        remotePath: values.remotePath,
        fileHash: values.fileHash,
        fileSize: values.fileSize,
        lastSeenRunId: runId,
        syncedAt: new Date(),
      });
      return;
    }

    const row = await this.repository.insertLedgerBook({
      userId,
      deviceId,
      bookId: book.bookId,
      fileId: book.fileId,
      remotePath: values.remotePath,
      fileHash: values.fileHash,
      fileSize: values.fileSize,
      lastSeenRunId: runId,
      syncedAt: new Date(),
    });
    ledgerByBookId.set(book.bookId, row);
  }

  private async recordSeen(
    userId: number,
    deviceId: number,
    runId: number,
    ledger: CrosspointDeviceBookRow | undefined,
    ledgerByBookId: Map<number, CrosspointDeviceBookRow>,
    book: CrosspointSyncBook,
    remotePath: string,
  ): Promise<void> {
    if (ledger) {
      await this.repository.updateLedgerBook(userId, ledger.id, { lastSeenRunId: runId });
      return;
    }

    const row = await this.repository.insertLedgerBook({
      userId,
      deviceId,
      bookId: book.bookId,
      fileId: book.fileId,
      remotePath,
      fileHash: null,
      fileSize: null,
      lastSeenRunId: runId,
      syncedAt: null,
    });
    ledgerByBookId.set(book.bookId, row);
  }

  private async ensureDirectory(device: CrosspointDeviceRow, directory: string, ensured: Set<string>): Promise<void> {
    const normalized = normalizeDevicePath(directory);
    if (ensured.has(normalized)) return;
    await this.client.ensureDirectory(device.host, device.httpPort, normalized);
    ensured.add(normalized);
  }

  private async persistProgress(userId: number, runId: number, counters: SyncCounters): Promise<void> {
    await this.repository.updateRun(userId, runId, {
      uploaded: counters.uploaded,
      skipped: counters.skipped,
      deleted: counters.deleted,
      failed: counters.failed,
      transferredBytes: counters.transferredBytes,
    });
  }

  private setCurrent(deviceId: number, runId: number, book: CrosspointSyncBook, bytes: number): void {
    const active = this.active.get(deviceId);
    if (!active || active.runId !== runId) return;
    active.current = { id: book.bookId, title: book.title, bytes, transferred: 0 };
  }

  private updateCurrent(deviceId: number, runId: number, transferred: number): void {
    const active = this.active.get(deviceId);
    if (!active || active.runId !== runId || !active.current) return;
    active.current.transferred = Math.min(Math.max(0, transferred), active.current.bytes);
  }

  private clearCurrent(deviceId: number, runId: number): void {
    const active = this.active.get(deviceId);
    if (active && active.runId === runId) active.current = null;
  }

  private ancestorPaths(path: string, root: string): string[] {
    const normalizedRoot = normalizeDevicePath(root);
    const ancestors: string[] = [];
    let current = deviceDirname(path);
    while (current !== '/' && current !== normalizedRoot) {
      ancestors.push(current);
      const parent = deviceDirname(current);
      if (parent === current) break;
      current = parent;
    }
    return ancestors;
  }
}
