import 'reflect-metadata';
import type { CrosspointFileEntry } from '@bookorbit/types';

import type { CrosspointDeviceBookRow } from '../../../db/schema';
import type { CrosspointSyncBook } from './crosspoint-book-selection.service';
import { buildOccupiedPaths, planBookSync, resolveBookRemotePath } from './crosspoint-sync-planner';

const HASH = 'a'.repeat(32);

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
    fileSize: 1000,
    fileHash: HASH,
    fileMtime: new Date('2026-01-01T00:00:00.000Z'),
    mediaOverlayAvailable: false,
    originalStem: 'dune',
    ...overrides,
  };
}

function makeLedger(overrides: Partial<CrosspointDeviceBookRow> = {}): CrosspointDeviceBookRow {
  return {
    id: 1,
    userId: 7,
    deviceId: 1,
    bookId: 123,
    fileId: 5,
    remotePath: '/BookOrbit/Frank Herbert - Dune.epub',
    fileHash: HASH,
    fileSize: 1000,
    lastSeenRunId: 1,
    syncedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function remote(path: string, size: number): CrosspointFileEntry {
  return { path, name: path.slice(path.lastIndexOf('/') + 1), size, isDirectory: false, isEpub: true };
}

function planInput(book: CrosspointSyncBook = makeBook()) {
  return {
    rootFolder: '/BookOrbit',
    fileNamingPattern: '<{authors:first} - >{title}',
    book,
    fileHash: book.fileHash,
    fileSize: book.fileSize,
    ledger: undefined as CrosspointDeviceBookRow | undefined,
    remoteFilesByPath: new Map<string, CrosspointFileEntry>(),
    occupiedPaths: new Set<string>(),
    claimedPaths: new Set<string>(),
  };
}

describe('CrossPoint sync planner', () => {
  it('resolves the naming pattern under the managed folder', () => {
    expect(resolveBookRemotePath({ rootFolder: '/BookOrbit', fileNamingPattern: '<{authors:first} - >{title}', book: makeBook() })).toBe(
      '/BookOrbit/Frank Herbert - Dune.epub',
    );
    expect(resolveBookRemotePath({ rootFolder: '/Shelf', fileNamingPattern: '{authors:sort}/{title}', book: makeBook() })).toBe(
      '/Shelf/Herbert, Frank/Dune.epub',
    );
  });

  it('uploads a new book', () => {
    const plan = planBookSync(planInput());
    expect(plan).toMatchObject({ action: 'upload', classification: 'new', remotePath: '/BookOrbit/Frank Herbert - Dune.epub' });
  });

  it('adopts an untracked file with the same size', () => {
    const input = planInput();
    input.remoteFilesByPath.set('/BookOrbit/Frank Herbert - Dune.epub', remote('/BookOrbit/Frank Herbert - Dune.epub', 1000));
    input.occupiedPaths.add('/BookOrbit/Frank Herbert - Dune.epub');

    expect(planBookSync(input)).toMatchObject({ action: 'adopt', classification: 'unchanged' });
  });

  it('skips an unchanged tracked file', () => {
    const input = planInput();
    input.ledger = makeLedger();
    input.remoteFilesByPath.set('/BookOrbit/Frank Herbert - Dune.epub', remote('/BookOrbit/Frank Herbert - Dune.epub', 1000));
    input.occupiedPaths.add('/BookOrbit/Frank Herbert - Dune.epub');

    expect(planBookSync(input)).toMatchObject({ action: 'skip', classification: 'unchanged' });
  });

  it('replaces a changed file and deletes the old copy first', () => {
    const input = planInput();
    input.ledger = makeLedger({ fileHash: 'b'.repeat(32) });
    input.remoteFilesByPath.set('/BookOrbit/Frank Herbert - Dune.epub', remote('/BookOrbit/Frank Herbert - Dune.epub', 900));
    input.occupiedPaths.add('/BookOrbit/Frank Herbert - Dune.epub');

    expect(planBookSync(input)).toMatchObject({
      action: 'upload',
      classification: 'changed',
      remotePath: '/BookOrbit/Frank Herbert - Dune.epub',
      previousPath: null,
      deleteBeforeUpload: true,
    });
  });

  it('moves a book when the pattern changes', () => {
    const input = planInput();
    input.ledger = makeLedger({ remotePath: '/BookOrbit/Old/Dune.epub' });
    input.occupiedPaths.add('/BookOrbit/Old/Dune.epub');

    expect(planBookSync(input)).toMatchObject({
      action: 'upload',
      classification: 'changed',
      remotePath: '/BookOrbit/Frank Herbert - Dune.epub',
      previousPath: '/BookOrbit/Old/Dune.epub',
      deleteBeforeUpload: false,
    });
  });

  it('suffixes a colliding path with the book id', () => {
    const input = planInput();
    input.occupiedPaths.add('/BookOrbit/Frank Herbert - Dune.epub');
    input.remoteFilesByPath.set('/BookOrbit/Frank Herbert - Dune.epub', remote('/BookOrbit/Frank Herbert - Dune.epub', 1234));

    expect(planBookSync(input)).toMatchObject({
      action: 'upload',
      classification: 'new',
      remotePath: '/BookOrbit/Frank Herbert - Dune (123).epub',
    });
  });

  it('keeps using a path this book already owns', () => {
    const input = planInput();
    input.ledger = makeLedger({ remotePath: '/BookOrbit/Frank Herbert - Dune (123).epub' });
    input.occupiedPaths.add('/BookOrbit/Frank Herbert - Dune.epub');
    input.remoteFilesByPath.set('/BookOrbit/Frank Herbert - Dune.epub', remote('/BookOrbit/Frank Herbert - Dune.epub', 1234));
    input.remoteFilesByPath.set('/BookOrbit/Frank Herbert - Dune (123).epub', remote('/BookOrbit/Frank Herbert - Dune (123).epub', 1000));

    expect(planBookSync(input)).toMatchObject({
      action: 'skip',
      classification: 'unchanged',
      remotePath: '/BookOrbit/Frank Herbert - Dune (123).epub',
    });
  });

  it('collects remote files and folders as occupied paths', () => {
    const occupied = buildOccupiedPaths('/BookOrbit', [remote('/BookOrbit/Author/Series/Title.epub', 1)]);
    expect(occupied).toEqual(new Set(['/BookOrbit/Author/Series/Title.epub', '/BookOrbit/Author/Series', '/BookOrbit/Author']));
  });
});
