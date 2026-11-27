import { Inject, Injectable } from '@nestjs/common';
import type { ContentFilterRules, CrosspointSelection, GroupRule, MetadataSeriesMembership } from '@bookorbit/types';
import { and, asc, eq, exists, gt, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { basename, extname } from 'node:path';

import { LibraryScopeService } from '../../../common/library-scope/library-scope.service';
import { buildContentFilterClauses } from '../../../common/utils/content-filter-sql.utils';
import { resolveTimeZone } from '../../../common/utils/timezone.utils';
import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';
import { BookQueryBuilder } from '../../book/book-query-builder.service';
import { ContentFilterRepository } from '../../user/content-filter.repository';
import { CrosspointSyncRepository } from '../crosspoint-sync.repository';

type Db = NodePgDatabase<typeof schema>;

export interface CrosspointSyncBook {
  bookId: number;
  libraryId: number;
  libraryName: string;
  title: string | null;
  subtitle: string | null;
  publisher: string | null;
  language: string | null;
  isbn10: string | null;
  isbn13: string | null;
  publishedYear: number | null;
  originalPublishedYear: number | null;
  seriesName: string | null;
  seriesIndex: string | null;
  seriesMemberships: MetadataSeriesMembership[];
  authors: string[];
  narrators: string[];
  fileId: number;
  filePath: string;
  fileSize: number | null;
  fileHash: string | null;
  fileMtime: Date | null;
  mediaOverlayAvailable: boolean;
  originalStem: string;
}

export interface CrosspointSelectionContext {
  where: SQL;
  accessibleLibraryIds: number[] | null;
  contentFilters: ContentFilterRules;
  timeZone: string;
}

export interface CrosspointEligibleTotals {
  books: number;
  bytes: number;
}

function primaryEpubFileOrder(): SQL {
  return sql`(bf.id = ${schema.books.primaryFileId}) desc nulls last, bf.sort_order asc nulls last, bf.id asc`;
}

@Injectable()
export class CrosspointBookSelectionService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly libraryScope: LibraryScopeService,
    private readonly contentFilters: ContentFilterRepository,
    private readonly queryBuilder: BookQueryBuilder,
    private readonly syncRepository: CrosspointSyncRepository,
  ) {}

  async buildContext(userId: number, selection: CrosspointSelection): Promise<CrosspointSelectionContext> {
    const [accessibleLibraryIds, contentFilters, rawTimeZone] = await Promise.all([
      this.libraryScope.visibleIdsOrAllForUserId(userId),
      this.contentFilters.findByUserId(userId),
      this.syncRepository.getUserTimeZone(userId),
    ]);
    const timeZone = resolveTimeZone(rawTimeZone, 'UTC');
    const libraryIds = accessibleLibraryIds ?? (await this.syncRepository.listLibraryIds());

    const membership = await this.membershipClause(userId, selection, libraryIds, timeZone);
    const libraryFilter =
      accessibleLibraryIds === null
        ? undefined
        : accessibleLibraryIds.length === 0
          ? sql`false`
          : inArray(schema.books.libraryId, accessibleLibraryIds);
    const contentFilterClauses = accessibleLibraryIds !== null ? buildContentFilterClauses(contentFilters, this.db) : [];

    return {
      where: and(eq(schema.books.status, 'present'), libraryFilter, membership, ...contentFilterClauses) ?? sql`false`,
      accessibleLibraryIds,
      contentFilters,
      timeZone,
    };
  }

  async countAndBytes(context: CrosspointSelectionContext): Promise<CrosspointEligibleTotals> {
    const [row] = await this.db
      .select({
        books: sql<number>`count(*)::int`,
        bytes: sql<number>`coalesce(sum(${this.primaryEpubFileSizeSql()}), 0)::float8`,
      })
      .from(schema.books)
      .where(context.where);

    return {
      books: Number(row?.books ?? 0),
      bytes: Math.max(0, Math.round(Number(row?.bytes ?? 0))),
    };
  }

  async page(context: CrosspointSelectionContext, afterBookId: number, limit: number): Promise<CrosspointSyncBook[]> {
    const rows = await this.db
      .select({
        bookId: schema.books.id,
        libraryId: schema.books.libraryId,
        libraryName: schema.libraries.name,
        title: schema.bookMetadata.title,
        subtitle: schema.bookMetadata.subtitle,
        publisher: schema.bookMetadata.publisher,
        language: schema.bookMetadata.language,
        isbn10: schema.bookMetadata.isbn10,
        isbn13: schema.bookMetadata.isbn13,
        publishedYear: schema.bookMetadata.publishedYear,
        originalPublishedYear: schema.bookMetadata.originalPublishedYear,
        seriesName: schema.bookMetadata.seriesName,
        seriesIndex: schema.bookMetadata.seriesIndex,
        fileId: schema.bookFiles.id,
        filePath: schema.bookFiles.absolutePath,
        fileSize: schema.bookFiles.sizeBytes,
        fileHash: schema.bookFiles.fileHash,
        fileMtime: schema.bookFiles.mtime,
        mediaOverlayAvailable: schema.bookFiles.mediaOverlayAvailable,
      })
      .from(schema.books)
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.books.libraryId))
      .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
      .innerJoin(schema.bookFiles, and(eq(schema.bookFiles.id, this.primaryEpubFileIdSql()), eq(schema.bookFiles.bookId, schema.books.id)))
      .where(and(context.where, gt(schema.books.id, afterBookId)))
      .orderBy(asc(schema.books.id))
      .limit(limit);

    if (rows.length === 0) return [];
    const bookIds = rows.map((row) => row.bookId);

    const [authorRows, narratorRows, membershipRows] = await Promise.all([
      this.db
        .select({ bookId: schema.bookAuthors.bookId, name: schema.authors.name })
        .from(schema.bookAuthors)
        .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
        .where(inArray(schema.bookAuthors.bookId, bookIds))
        .orderBy(asc(schema.bookAuthors.displayOrder), asc(schema.bookAuthors.authorId)),
      this.db
        .select({ bookId: schema.bookNarrators.bookId, name: schema.narrators.name })
        .from(schema.bookNarrators)
        .innerJoin(schema.narrators, eq(schema.narrators.id, schema.bookNarrators.narratorId))
        .where(inArray(schema.bookNarrators.bookId, bookIds))
        .orderBy(asc(schema.bookNarrators.displayOrder), asc(schema.bookNarrators.narratorId)),
      this.db
        .select({
          bookId: schema.bookSeriesMemberships.bookId,
          seriesName: schema.bookSeries.name,
          seriesIndex: schema.bookSeriesMemberships.seriesIndex,
          displayOrder: schema.bookSeriesMemberships.displayOrder,
        })
        .from(schema.bookSeriesMemberships)
        .innerJoin(schema.bookSeries, eq(schema.bookSeries.id, schema.bookSeriesMemberships.seriesId))
        .where(inArray(schema.bookSeriesMemberships.bookId, bookIds))
        .orderBy(
          asc(schema.bookSeriesMemberships.bookId),
          asc(schema.bookSeriesMemberships.displayOrder),
          asc(schema.bookSeriesMemberships.seriesId),
        ),
    ]);

    const authorsByBook = new Map<number, string[]>();
    for (const row of authorRows) {
      const names = authorsByBook.get(row.bookId) ?? [];
      names.push(row.name);
      authorsByBook.set(row.bookId, names);
    }

    const narratorsByBook = new Map<number, string[]>();
    for (const row of narratorRows) {
      const names = narratorsByBook.get(row.bookId) ?? [];
      names.push(row.name);
      narratorsByBook.set(row.bookId, names);
    }

    const membershipsByBook = new Map<number, MetadataSeriesMembership[]>();
    for (const row of membershipRows) {
      const memberships = membershipsByBook.get(row.bookId) ?? [];
      memberships.push({ seriesName: row.seriesName, seriesIndex: row.seriesIndex });
      membershipsByBook.set(row.bookId, memberships);
    }

    return rows.map((row) => ({
      bookId: row.bookId,
      libraryId: row.libraryId,
      libraryName: row.libraryName,
      title: row.title,
      subtitle: row.subtitle,
      publisher: row.publisher,
      language: row.language,
      isbn10: row.isbn10,
      isbn13: row.isbn13,
      publishedYear: row.publishedYear,
      originalPublishedYear: row.originalPublishedYear,
      seriesName: row.seriesName,
      seriesIndex: row.seriesIndex,
      seriesMemberships: membershipsByBook.get(row.bookId) ?? [],
      authors: authorsByBook.get(row.bookId) ?? [],
      narrators: narratorsByBook.get(row.bookId) ?? [],
      fileId: row.fileId,
      filePath: row.filePath,
      fileSize: row.fileSize,
      fileHash: row.fileHash,
      fileMtime: row.fileMtime,
      mediaOverlayAvailable: row.mediaOverlayAvailable,
      originalStem: basename(row.filePath, extname(row.filePath)),
    }));
  }

  async listEligibleBookIds(context: CrosspointSelectionContext): Promise<number[]> {
    const rows = await this.db.select({ id: schema.books.id }).from(schema.books).where(context.where);
    return rows.map((row) => row.id);
  }

  private async membershipClause(userId: number, selection: CrosspointSelection, libraryIds: number[], timeZone: string): Promise<SQL | undefined> {
    if (selection.mode === 'all') return undefined;

    const clauses: SQL[] = [];
    if (selection.collectionIds.length > 0) {
      clauses.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(schema.collectionBooks)
            .where(and(eq(schema.collectionBooks.bookId, schema.books.id), inArray(schema.collectionBooks.collectionId, selection.collectionIds))),
        ),
      );
    }

    if (selection.smartScopeIds.length > 0) {
      const scopes = await this.syncRepository.findSmartScopesForSelection(userId, selection.smartScopeIds);
      for (const scope of scopes) {
        if (!scope.filter) continue;
        const where = this.queryBuilder.buildWhere(scope.filter as GroupRule, {
          accessibleLibraryIds: libraryIds,
          userId,
          timeZone,
        });
        if (where) clauses.push(where);
      }
    }

    if (clauses.length === 0) return sql`false`;
    return or(...clauses) ?? sql`false`;
  }

  /** Scalar id of the file the reader receives: the primary EPUB, else the first EPUB by sort order. */
  private primaryEpubFileIdSql(): SQL<number | null> {
    return sql<number | null>`(
      select bf.id
      from ${schema.bookFiles} bf
      where bf.book_id = ${schema.books.id}
        and bf.format = 'epub'
      order by ${primaryEpubFileOrder()}
      limit 1
    )`;
  }

  private primaryEpubFileSizeSql(): SQL<number | null> {
    return sql<number | null>`(
      select bf.size_bytes
      from ${schema.bookFiles} bf
      where bf.book_id = ${schema.books.id}
        and bf.format = 'epub'
      order by ${primaryEpubFileOrder()}
      limit 1
    )`;
  }
}
