import 'reflect-metadata';
import type { CrosspointSelection } from '@bookorbit/types';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CrosspointDeviceBookRow, CrosspointDeviceRow, CrosspointSyncRunRow } from '../../../db/schema';
import type { CrosspointSyncBook } from './crosspoint-book-selection.service';
import { CrosspointAbortError } from './crosspoint-client.service';
import { CrosspointSyncRunner } from './crosspoint-sync-runner.service';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const HASH = 'a'.repeat(32);
const SELECTION: CrosspointSelection = { mode: 'all', libraryIds: [], collectionIds: [], smartScopeIds: [] };

function makeDevice(overrides: Partial<CrosspointDeviceRow> = {}): CrosspointDeviceRow {
  return {
    id: 1,
    userId: 7,
    name: 'Reader',
    host: '192.168.1.50',
    wsPort: 81,
    httpPort: 80,
    deviceId: 'a'.repeat(64),
    deviceModel: 'X4',
    firmwareVersion: '1.0.0',
    rootFolder: '/BookOrbit',
    fileNamingPattern: '{library}/<{authors:first}|Unknown Author>/<{series}/>{originalFilename}',
    syncToken: 'b'.repeat(32),
    selectionMode: 'all',
    removeMissing: true,
    lastSeenAt: NOW,
    lastSyncAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeBook(overrides: Partial<CrosspointSyncBook> = {}): CrosspointSyncBook {
  return {
    bookId: 123,
    libraryId: 1,
    libraryName: 'Books',
    title: 'Dune',
    subtitle: null,
    publisher: null,
    language: 'en',
    isbn10: null,
    isbn13: null,
    publishedYear: null,
    originalPublishedYear: null,
    seriesName: null,
    seriesIndex: null,
    seriesMemberships: [],
    authors: ['Frank Herbert'],
    narrators: [],
    fileId: 5,
    filePath: '/books/dune.epub',
    fileSize: 11,
    fileHash: HASH,
    fileMtime: NOW,
    mediaOverlayAvailable: false,
    originalStem: 'dune',
    ...overrides,
  };
}

function makeLedger(overrides: Partial<CrosspointDeviceBookRow> = {}): CrosspointDeviceBookRow {
  return {
    id: 10,
    userId: 7,
    deviceId: 1,
    bookId: 123,
    fileId: 5,
    remotePath: '/BookOrbit/Books/Frank Herbert/dune.epub',
    remoteFilenameHash: 'c'.repeat(32),
    fileHash: HASH,
    fileSize: 11,
    lastSeenRunId: 0,
    syncedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeRun(overrides: Partial<CrosspointSyncRunRow> = {}): CrosspointSyncRunRow {
  return {
    id: 1,
    userId: 7,
    deviceId: 1,
    status: 'running',
    totalBooks: 1,
    uploaded: 0,
    skipped: 0,
    deleted: 0,
    failed: 0,
    totalBytes: 11,
    transferredBytes: 0,
    errorClass: null,
    error: null,
    failures: [],
    startedAt: NOW,
    finishedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

function remoteFile(path: string, size: number) {
  return { path, name: path.slice(path.lastIndexOf('/') + 1), size, isDirectory: false, isEpub: true };
}

describe('CrosspointSyncRunner', () => {
  const devices = { updateDeviceFields: vi.fn() };
  const repository = {
    markRunningRunsInterrupted: vi.fn(),
    findRun: vi.fn(),
    listLedger: vi.fn(),
    findStaleLedgerRows: vi.fn(),
    deleteLedgerBook: vi.fn(),
    updateRun: vi.fn(),
    insertLedgerBook: vi.fn(),
    updateLedgerBook: vi.fn(),
  };
  const selection = { buildContext: vi.fn(), page: vi.fn() };
  const client = {
    probe: vi.fn(),
    listFilesRecursive: vi.fn(),
    ensureDirectory: vi.fn(),
    uploadFile: vi.fn(),
    deletePaths: vi.fn(),
    pruneEmptyDirectories: vi.fn(),
  };
  const runner = new CrosspointSyncRunner(devices as never, repository as never, selection as never, client as never);

  let tempDirectory: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDirectory = await mkdtemp(join(tmpdir(), 'crosspoint-runner-'));
    repository.findRun.mockResolvedValue(makeRun());
    repository.listLedger.mockResolvedValue([]);
    repository.findStaleLedgerRows.mockResolvedValue([]);
    repository.updateRun.mockResolvedValue(makeRun());
    repository.insertLedgerBook.mockImplementation((values: Partial<CrosspointDeviceBookRow>) => Promise.resolve(makeLedger({ id: 99, ...values })));
    repository.updateLedgerBook.mockResolvedValue(makeLedger());
    repository.deleteLedgerBook.mockResolvedValue(undefined);
    selection.buildContext.mockResolvedValue({ where: {} });
    selection.page.mockResolvedValue([]);
    client.probe.mockResolvedValue({
      reachable: true,
      isCrosspoint: true,
      deviceId: 'a'.repeat(64),
      deviceModel: 'X4',
      firmwareVersion: '1.0.0',
      mode: 'STA',
      ip: '192.168.1.50',
      error: null,
    });
    client.listFilesRecursive.mockResolvedValue([]);
    client.ensureDirectory.mockResolvedValue(undefined);
    client.uploadFile.mockResolvedValue(undefined);
    client.deletePaths.mockResolvedValue(undefined);
    client.pruneEmptyDirectories.mockResolvedValue(undefined);
    devices.updateDeviceFields.mockResolvedValue(makeDevice());
  });

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  });

  async function run(device = makeDevice()) {
    const execute = (
      runner as unknown as {
        execute: (userId: number, device: CrosspointDeviceRow, selection: CrosspointSelection, runId: number, signal: AbortSignal) => Promise<void>;
      }
    ).execute.bind(runner);
    await execute(7, device, SELECTION, 1, new AbortController().signal);
  }

  it('uploads a new book and records the file in the ledger', async () => {
    const filePath = join(tempDirectory, 'dune.epub');
    await writeFile(filePath, 'hello world');
    const book = makeBook({ filePath, fileSize: 11 });
    selection.page.mockResolvedValueOnce([book]);

    await run();

    expect(client.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: '/BookOrbit/Books/Frank Herbert',
        filename: 'dune.epub',
        filePath,
      }),
    );
    expect(client.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: '/BookOrbit/Books/Frank Herbert',
        filename: 'dune.epub.meta.json',
        contents: expect.any(Buffer),
      }),
    );
    expect(repository.insertLedgerBook).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: 123,
        remotePath: '/BookOrbit/Books/Frank Herbert/dune.epub',
        fileHash: HASH,
        fileSize: 11,
        lastSeenRunId: 1,
      }),
    );
    expect(repository.updateRun).toHaveBeenLastCalledWith(7, 1, expect.objectContaining({ status: 'completed', uploaded: 1, failed: 0 }));
    expect(devices.updateDeviceFields).toHaveBeenCalledWith(7, 1, { lastSyncAt: expect.any(Date) });
  });

  it('skips an unchanged tracked file', async () => {
    const filePath = join(tempDirectory, 'dune.epub');
    await writeFile(filePath, 'hello world');
    const book = makeBook({ filePath, fileSize: 11 });
    repository.listLedger.mockResolvedValue([makeLedger()]);
    client.listFilesRecursive.mockResolvedValue([
      remoteFile('/BookOrbit/Books/Frank Herbert/dune.epub', 11),
      remoteFile('/BookOrbit/Books/Frank Herbert/dune.epub.meta.json', 60),
    ]);
    selection.page.mockResolvedValueOnce([book]);

    await run();

    expect(client.uploadFile).not.toHaveBeenCalled();
    expect(repository.updateLedgerBook).toHaveBeenCalledWith(7, 10, { lastSeenRunId: 1 });
    expect(repository.updateRun).toHaveBeenLastCalledWith(7, 1, expect.objectContaining({ status: 'completed', uploaded: 0, skipped: 1, failed: 0 }));
  });

  it('removes tracked files that are no longer selected', async () => {
    const stale = makeLedger({ id: 33, remotePath: '/BookOrbit/Old.epub', bookId: 9 });
    repository.findStaleLedgerRows.mockResolvedValue([stale]);
    client.listFilesRecursive.mockResolvedValue([remoteFile('/BookOrbit/Old.epub', 11)]);

    await run();

    expect(client.deletePaths).toHaveBeenCalledWith('192.168.1.50', 80, ['/BookOrbit/Old.epub']);
    expect(repository.deleteLedgerBook).toHaveBeenCalledWith(7, 33);
    expect(client.pruneEmptyDirectories).toHaveBeenCalledWith('192.168.1.50', 80, '/BookOrbit', ['/BookOrbit/Old.epub']);
    expect(repository.updateRun).toHaveBeenLastCalledWith(7, 1, expect.objectContaining({ status: 'completed', deleted: 1 }));
  });

  it('continues after one book fails', async () => {
    const firstPath = join(tempDirectory, 'missing.epub');
    const secondPath = join(tempDirectory, 'second.epub');
    await writeFile(secondPath, 'second');
    const first = makeBook({ bookId: 1, title: 'First', fileId: 1, filePath: firstPath, fileSize: 5, fileHash: 'b'.repeat(32) });
    const second = makeBook({
      bookId: 2,
      title: 'Second',
      fileId: 2,
      filePath: secondPath,
      fileSize: 6,
      fileHash: 'c'.repeat(32),
      originalStem: 'second',
    });
    selection.page.mockResolvedValueOnce([first, second]);

    await run();

    expect(client.uploadFile).toHaveBeenCalledTimes(2);
    expect(client.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ filename: 'second.epub' }));
    expect(repository.updateRun).toHaveBeenLastCalledWith(7, 1, expect.objectContaining({ status: 'completed', uploaded: 1, failed: 1 }));
  });

  it('marks an aborted run cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = (
      runner as unknown as {
        execute: (userId: number, device: CrosspointDeviceRow, selection: CrosspointSelection, runId: number, signal: AbortSignal) => Promise<void>;
      }
    ).execute.bind(runner);

    await execute(7, makeDevice(), SELECTION, 1, controller.signal);

    expect(repository.updateRun).toHaveBeenLastCalledWith(7, 1, expect.objectContaining({ status: 'cancelled', errorClass: 'Cancelled' }));
  });

  it('marks running runs interrupted on startup', async () => {
    repository.markRunningRunsInterrupted.mockResolvedValue([1, 2]);

    await runner.onModuleInit();

    expect(repository.markRunningRunsInterrupted).toHaveBeenCalled();
  });
});

describe('CrosspointSyncRunner cancellation error', () => {
  it('is a named error the runner can distinguish', () => {
    expect(new CrosspointAbortError('Sync cancelled').name).toBe('CrosspointAbortError');
  });
});
