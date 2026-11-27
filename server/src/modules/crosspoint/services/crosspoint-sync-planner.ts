import type { CrosspointFileEntry } from '@bookorbit/types';
import { appendToPathStem, resolveUploadPath, sanitizePathSegment } from '@bookorbit/types';

import { buildPatternTokens } from '../../../common/utils/pattern-tokens.utils';
import type { CrosspointDeviceBookRow } from '../../../db/schema';
import { deviceDirname, joinDevicePath, normalizeDevicePath } from '../crosspoint-path.utils';
import type { CrosspointSyncBook } from './crosspoint-book-selection.service';

export type CrosspointSyncBookAction = 'upload' | 'skip' | 'adopt';
export type CrosspointSyncBookClassification = 'new' | 'changed' | 'unchanged';

export interface CrosspointSyncPlan {
  action: CrosspointSyncBookAction;
  classification: CrosspointSyncBookClassification;
  remotePath: string;
  previousPath: string | null;
  deleteBeforeUpload: boolean;
}

export interface CrosspointBookPlanInput {
  rootFolder: string;
  fileNamingPattern: string;
  book: CrosspointSyncBook;
  fileHash: string | null;
  fileSize: number | null;
  ledger: CrosspointDeviceBookRow | null | undefined;
  remoteFilesByPath: ReadonlyMap<string, CrosspointFileEntry>;
  occupiedPaths: ReadonlySet<string>;
  claimedPaths: Set<string>;
}

function patternMetadata(book: CrosspointSyncBook) {
  return {
    title: book.title,
    subtitle: book.subtitle,
    publisher: book.publisher,
    language: book.language,
    isbn10: book.isbn10,
    isbn13: book.isbn13,
    publishedYear: book.publishedYear,
    originalPublishedYear: book.originalPublishedYear,
    seriesName: book.seriesName,
    seriesIndex: book.seriesIndex,
    seriesMemberships: book.seriesMemberships,
  };
}

export function resolveBookRemotePath(input: Pick<CrosspointBookPlanInput, 'rootFolder' | 'fileNamingPattern' | 'book'>): string {
  const { book, fileNamingPattern, rootFolder } = input;
  const tokens = buildPatternTokens({
    metadata: patternMetadata(book),
    authors: book.authors,
    narrators: book.narrators,
    originalStem: book.originalStem,
    format: 'epub',
    libraryName: book.libraryName,
    mediaOverlayAvailable: book.mediaOverlayAvailable,
  });
  const resolved = resolveUploadPath(fileNamingPattern, tokens, 'epub', { sanitizeForCrossPlatform: true });
  if (resolved) return joinDevicePath(rootFolder, resolved);

  const fallbackStem = sanitizePathSegment(book.title || `Book ${book.bookId}`, '_');
  return joinDevicePath(rootFolder, `${fallbackStem}.epub`);
}

/** Remote file and folder paths that a new upload must not collide with. */
export function buildOccupiedPaths(rootFolder: string, remoteFiles: readonly CrosspointFileEntry[]): Set<string> {
  const root = normalizeDevicePath(rootFolder);
  const occupied = new Set<string>();
  for (const file of remoteFiles) {
    occupied.add(file.path);
    let directory = deviceDirname(file.path);
    while (directory !== root && directory !== '/') {
      occupied.add(directory);
      const parent = deviceDirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return occupied;
}

/**
 * Decides whether a book needs an upload, can be skipped, or matches an untracked file left after
 * a database reset. Collisions are resolved by a book-id suffix before anything is deleted, and
 * files owned by another book are never overwritten.
 */
export function planBookSync(input: CrosspointBookPlanInput): CrosspointSyncPlan {
  const { book, fileHash, fileSize, ledger, remoteFilesByPath, occupiedPaths, claimedPaths } = input;
  const basePath = resolveBookRemotePath(input);
  const existingPath = ledger?.remotePath ?? null;

  if (!ledger) {
    const existingRemote = remoteFilesByPath.get(basePath);
    if (existingRemote && !existingRemote.isDirectory && fileSize !== null && existingRemote.size === fileSize) {
      claimedPaths.add(basePath);
      return { action: 'adopt', classification: 'unchanged', remotePath: basePath, previousPath: null, deleteBeforeUpload: false };
    }
  }

  let remotePath = basePath;
  if (remotePath !== existingPath && (occupiedPaths.has(remotePath) || claimedPaths.has(remotePath))) {
    let attempt = 0;
    do {
      const suffix = attempt === 0 ? ` (${book.bookId})` : ` (${book.bookId}-${attempt + 1})`;
      remotePath = appendToPathStem(basePath, suffix, 'epub');
      attempt += 1;
    } while ((occupiedPaths.has(remotePath) || claimedPaths.has(remotePath)) && remotePath !== existingPath);
  }

  const remoteFile = remoteFilesByPath.get(remotePath);
  const remoteFileExists = Boolean(remoteFile && !remoteFile.isDirectory);
  const hashMatches = Boolean(fileHash && ledger?.fileHash && ledger.fileHash === fileHash);
  const sizeMatches = fileSize === null ? ledger?.fileSize == null : ledger?.fileSize === fileSize;
  const remoteSizeMatches = fileSize !== null && remoteFileExists && remoteFile!.size === fileSize;

  claimedPaths.add(remotePath);

  if (ledger && ledger.remotePath === remotePath && hashMatches && sizeMatches && remoteSizeMatches) {
    return { action: 'skip', classification: 'unchanged', remotePath, previousPath: null, deleteBeforeUpload: false };
  }
  if (ledger && ledger.remotePath === remotePath && fileHash === null && sizeMatches && remoteSizeMatches) {
    return { action: 'skip', classification: 'unchanged', remotePath, previousPath: null, deleteBeforeUpload: false };
  }

  const previousPath = ledger?.remotePath && ledger.remotePath !== remotePath ? ledger.remotePath : null;
  return {
    action: 'upload',
    classification: ledger ? 'changed' : 'new',
    remotePath,
    previousPath,
    deleteBeforeUpload: Boolean(ledger && ledger.remotePath === remotePath && remoteFileExists),
  };
}
