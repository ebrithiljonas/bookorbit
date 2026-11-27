import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import type { CrosspointDeviceBookRow, CrosspointDeviceRow, CrosspointSyncRunRow } from '../../../db/schema';
import type { CrosspointSyncBook } from './crosspoint-book-selection.service';
import { CrosspointSyncService } from './crosspoint-sync.service';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const HASH = 'a'.repeat(32);

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
    selectionMode: 'all',
    removeMissing: false,
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
    bookId: 999,
    fileId: 5,
    remotePath: '/BookOrbit/Old.epub',
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
    id: 5,
    userId: 7,
    deviceId: 1,
    status: 'completed',
    totalBooks: 1,
    uploaded: 1,
    skipped: 0,
    deleted: 0,
    failed: 0,
    totalBytes: 11,
    transferredBytes: 11,
    errorClass: null,
    error: null,
    failures: [],
    startedAt: NOW,
    finishedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

describe('CrosspointSyncService', () => {
  const devices = { findDevice: vi.fn(), listSelections: vi.fn() };
  const repository = {
    listLedger: vi.fn(),
    findRunningRun: vi.fn(),
    createRun: vi.fn(),
    updateRun: vi.fn(),
    findLatestRun: vi.fn(),
    listRuns: vi.fn(),
  };
  const selection = { buildContext: vi.fn(), countAndBytes: vi.fn(), page: vi.fn() };
  const client = { probe: vi.fn(), listFilesRecursive: vi.fn() };
  const runner = {
    isRunning: vi.fn(),
    reserve: vi.fn(),
    releaseReservation: vi.fn(),
    start: vi.fn(),
    getCurrent: vi.fn(),
    cancel: vi.fn(),
  };
  const service = new CrosspointSyncService(devices as never, repository as never, selection as never, client as never, runner as never);

  beforeEach(() => {
    vi.clearAllMocks();
    devices.findDevice.mockResolvedValue(makeDevice());
    devices.listSelections.mockResolvedValue({ libraryIdsByDevice: new Map(), collectionIdsByDevice: new Map(), smartScopeIdsByDevice: new Map() });
    repository.listLedger.mockResolvedValue([]);
    repository.findRunningRun.mockResolvedValue(undefined);
    repository.createRun.mockResolvedValue(makeRun({ status: 'running', finishedAt: null }));
    repository.updateRun.mockResolvedValue(makeRun());
    repository.findLatestRun.mockResolvedValue(makeRun());
    repository.listRuns.mockResolvedValue([makeRun()]);
    selection.buildContext.mockResolvedValue({ where: {} });
    selection.countAndBytes.mockResolvedValue({ books: 1, bytes: 11 });
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
    runner.isRunning.mockReturnValue(false);
    runner.getCurrent.mockReturnValue(null);
    runner.cancel.mockReturnValue(true);
  });

  it('previews a new book without mutating the ledger', async () => {
    selection.page.mockResolvedValueOnce([makeBook()]).mockResolvedValueOnce([]);

    await expect(service.preview(7, 1)).resolves.toEqual({
      totalBooks: 1,
      totalBytes: 11,
      newBooks: 1,
      changedBooks: 0,
      unchangedBooks: 0,
      removedBooks: 0,
      uploadBytes: 11,
    });
    expect(repository.listLedger).toHaveBeenCalledWith(7, 1);
    expect(repository.createRun).not.toHaveBeenCalled();
  });

  it('counts tracked books that are no longer selected', async () => {
    repository.listLedger.mockResolvedValue([makeLedger()]);
    selection.page.mockResolvedValue([]);

    await expect(service.preview(7, 1)).resolves.toMatchObject({ removedBooks: 1, totalBooks: 1 });
  });

  it('starts a run and reserves the reader', async () => {
    await expect(service.start(7, 1)).resolves.toEqual({ runId: 5 });

    expect(runner.reserve).toHaveBeenCalledWith(1);
    expect(repository.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, deviceId: 1, status: 'running', totalBooks: 1, totalBytes: 11 }),
    );
    expect(runner.start).toHaveBeenCalledWith(7, expect.objectContaining({ id: 1 }), expect.anything(), 5);
  });

  it('refuses a second run for the same reader', async () => {
    runner.isRunning.mockReturnValue(true);
    await expect(service.start(7, 1)).rejects.toThrow(ConflictException);
    expect(runner.reserve).not.toHaveBeenCalled();

    runner.isRunning.mockReturnValue(false);
    repository.findRunningRun.mockResolvedValue(makeRun({ status: 'running' }));
    await expect(service.start(7, 1)).rejects.toThrow(ConflictException);
  });

  it('releases the reservation when the reader cannot be reached', async () => {
    client.probe.mockResolvedValue({
      reachable: false,
      isCrosspoint: false,
      error: 'connect ECONNREFUSED',
    });

    await expect(service.start(7, 1)).rejects.toThrow(BadRequestException);
    expect(runner.releaseReservation).toHaveBeenCalledWith(1);
    expect(repository.createRun).not.toHaveBeenCalled();
  });

  it('returns the latest run and live current book', async () => {
    const current = { id: 123, title: 'Dune', bytes: 11, transferred: 4 };
    runner.getCurrent.mockReturnValue(current);

    await expect(service.status(7, 1)).resolves.toEqual({
      run: expect.objectContaining({ id: 5, status: 'completed', startedAt: NOW.toISOString() }),
      currentBook: current,
    });
    expect(runner.getCurrent).toHaveBeenCalledWith(1, 5);
  });

  it('returns an empty status before the first run', async () => {
    repository.findLatestRun.mockResolvedValue(undefined);
    await expect(service.status(7, 1)).resolves.toEqual({ run: null, currentBook: null });
  });

  it('cancels an active run and refuses when none is active', async () => {
    await expect(service.cancel(7, 1)).resolves.toBeUndefined();
    expect(runner.cancel).toHaveBeenCalledWith(1);

    runner.cancel.mockReturnValue(false);
    await expect(service.cancel(7, 1)).rejects.toThrow(ConflictException);
  });

  it('clamps the run history limit and maps rows', async () => {
    await service.listRuns(7, 1, 0);
    expect(repository.listRuns).toHaveBeenCalledWith(7, 1, 1);

    await service.listRuns(7, 1, 500);
    expect(repository.listRuns).toHaveBeenCalledWith(7, 1, 100);
  });

  it('rejects unknown readers on every entry point', async () => {
    devices.findDevice.mockResolvedValue(undefined);

    await expect(service.preview(7, 99)).rejects.toThrow(NotFoundException);
    await expect(service.start(7, 99)).rejects.toThrow(NotFoundException);
    await expect(service.status(7, 99)).rejects.toThrow(NotFoundException);
    await expect(service.cancel(7, 99)).rejects.toThrow(NotFoundException);
    await expect(service.listRuns(7, 99, 20)).rejects.toThrow(NotFoundException);
  });

  it('uses the saved selection when previewing', async () => {
    devices.listSelections.mockResolvedValue({
      libraryIdsByDevice: new Map([[1, [3]]]),
      collectionIdsByDevice: new Map([[1, [4]]]),
      smartScopeIdsByDevice: new Map([[1, [9]]]),
    });
    devices.findDevice.mockResolvedValue(makeDevice({ selectionMode: 'selected' }));

    await service.preview(7, 1);

    expect(selection.buildContext).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ mode: 'selected', libraryIds: [3], collectionIds: [4], smartScopeIds: [9] }),
    );
  });
});
