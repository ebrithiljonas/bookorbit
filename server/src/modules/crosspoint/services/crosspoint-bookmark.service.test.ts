import 'reflect-metadata';
import { createHash } from 'crypto';

import { CrosspointBookmarkService } from './crosspoint-bookmark.service';

const xpath = '/body/DocFragment[2]/body/p[3]/text().0';
const id = createHash('sha256').update(xpath).digest('hex').slice(0, 16);

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    title: 'Chapter 2',
    cfi: 'epubcfi(/6/2)',
    devicePos: xpath,
    pageno: 12,
    positionPercent: 35,
    deletedAt: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('CrosspointBookmarkService', () => {
  const documents = { resolve: vi.fn() };
  const bookmarks = { listForSync: vi.fn(), upsertFromDevice: vi.fn(), tombstone: vi.fn() };
  const positionConverter = { cfiPointToXpointer: vi.fn(), xpointerPointToCfi: vi.fn() };
  const links = { upsert: vi.fn(), findByCrosspointId: vi.fn() };
  const service = new CrosspointBookmarkService(documents as never, bookmarks as never, positionConverter as never, links as never);
  const file = { id: 9, bookId: 4, libraryId: 2, format: 'epub', progressCompatible: true };

  beforeEach(() => {
    vi.clearAllMocks();
    documents.resolve.mockResolvedValue(file);
    bookmarks.listForSync.mockResolvedValue([makeRow()]);
    links.upsert.mockResolvedValue(undefined);
  });

  it('lists a v2 bookmark snapshot with device ids and tombstones', async () => {
    bookmarks.listForSync.mockResolvedValue([makeRow(), makeRow({ id: 12, deletedAt: new Date('2026-01-02T00:00:00Z') })]);

    const result = await service.list(7, 3, 'a'.repeat(32), 0, 10);

    expect(result).toMatchObject({ document: 'a'.repeat(32), sync_version: 2, cursor: 2, more: false });
    expect(result.items[0]).toMatchObject({ id, xpath, percentage: 0.35, name: 'Chapter 2', deleted: 0 });
    expect(result.items[1]).toMatchObject({ deleted: 1 });
    expect(links.upsert).toHaveBeenCalledWith({ userId: 7, deviceId: 3, crosspointId: id, bookmarkId: 11, xpath });
  });

  it('converts a web bookmark CFI to an XPointer when listing', async () => {
    bookmarks.listForSync.mockResolvedValue([makeRow({ devicePos: null, cfi: 'epubcfi(/6/4)' })]);
    positionConverter.cfiPointToXpointer.mockResolvedValue({ status: 'exact', pos0: xpath });

    const result = await service.list(7, 3, 'a'.repeat(32), 0, 10);

    expect(positionConverter.cfiPointToXpointer).toHaveBeenCalledWith({ bookFileId: 9, cfi: 'epubcfi(/6/4)' });
    expect(result.items[0]?.xpath).toBe(xpath);
  });

  it('upserts a device bookmark and records its link', async () => {
    positionConverter.xpointerPointToCfi.mockResolvedValue({ status: 'exact', cfi: 'epubcfi(/6/2)' });
    bookmarks.upsertFromDevice.mockResolvedValue({ row: { id: 11 }, outcome: 'created' });

    await expect(
      service.save(7, 3, 'a'.repeat(32), [{ id, xpath, percentage: 0.35, summary: 'Quote', name: 'Chapter 2', pp: 12 }]),
    ).resolves.toMatchObject({ accepted: 1 });

    expect(bookmarks.upsertFromDevice).toHaveBeenCalledWith(7, 4, {
      bookFileId: 9,
      cfi: 'epubcfi(/6/2)',
      title: 'Chapter 2',
      devicePos: xpath,
      pageno: 12,
      positionPercent: 35,
      origin: 'koreader',
    });
    expect(links.upsert).toHaveBeenCalledWith({ userId: 7, deviceId: 3, crosspointId: id, bookmarkId: 11, xpath });
  });

  it('tombstones a bookmark from its device id', async () => {
    links.findByCrosspointId.mockResolvedValue({ bookmarkId: 11 });

    await expect(service.save(7, 3, 'a'.repeat(32), [{ id, deleted: 1 }])).resolves.toMatchObject({ accepted: 1 });
    expect(bookmarks.tombstone).toHaveBeenCalledWith(7, [11]);
    expect(bookmarks.upsertFromDevice).not.toHaveBeenCalled();
  });

  it('accepts but ignores bookmarks for an unmatched book', async () => {
    documents.resolve.mockResolvedValue(null);

    await expect(service.save(7, 3, 'a'.repeat(32), [{ id, deleted: 1 }])).resolves.toMatchObject({ accepted: 1 });
    expect(bookmarks.tombstone).not.toHaveBeenCalled();
  });
});
