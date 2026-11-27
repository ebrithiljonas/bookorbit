import 'reflect-metadata';

import { CrosspointDocumentService } from './crosspoint-document.service';

describe('CrosspointDocumentService', () => {
  const repository = {
    findAccessibleBookFileById: vi.fn(),
    findDeviceDocument: vi.fn(),
    findLedgerBookFileByRemoteFilenameHash: vi.fn(),
    findLedgerBookFileByFileHash: vi.fn(),
    upsertDeviceDocument: vi.fn(),
  };
  const koreaderRepository = { resolveBookFileByHash: vi.fn() };
  const libraryScope = { visibleIdsOrAllForUserId: vi.fn() };
  const service = new CrosspointDocumentService(repository as never, koreaderRepository as never, libraryScope as never);

  const file = { id: 9, bookId: 4, libraryId: 2, format: 'epub' };

  beforeEach(() => {
    vi.clearAllMocks();
    libraryScope.visibleIdsOrAllForUserId.mockResolvedValue([2]);
    repository.upsertDeviceDocument.mockResolvedValue(undefined);
  });

  it('uses the sidecar file id before every hash lookup', async () => {
    repository.findAccessibleBookFileById.mockResolvedValue(file);

    await expect(service.resolve(7, 3, 'a'.repeat(32), { bookorbit_file_id: '9' })).resolves.toMatchObject({
      id: 9,
      bookId: 4,
      progressCompatible: true,
    });
    expect(repository.findAccessibleBookFileById).toHaveBeenCalledWith(7, 9, [2]);
    expect(repository.upsertDeviceDocument).toHaveBeenCalledWith({
      userId: 7,
      deviceId: 3,
      documentHash: 'a'.repeat(32),
      bookFileId: 9,
    });
    expect(repository.findDeviceDocument).not.toHaveBeenCalled();
  });

  it('falls back through learned, ledger filename, ledger binary and global hashes', async () => {
    repository.findAccessibleBookFileById.mockResolvedValue(null);
    repository.findDeviceDocument.mockResolvedValueOnce(null);
    repository.findLedgerBookFileByRemoteFilenameHash.mockResolvedValueOnce(null);
    repository.findLedgerBookFileByFileHash.mockResolvedValueOnce(null);
    koreaderRepository.resolveBookFileByHash.mockResolvedValueOnce(file);

    await expect(service.resolve(7, 3, 'b'.repeat(32), { bookorbit_file_id: '404' })).resolves.toMatchObject({ id: 9 });
    expect(koreaderRepository.resolveBookFileByHash).toHaveBeenCalledWith('b'.repeat(32), [2], 7);
  });

  it('returns null when nothing matches', async () => {
    repository.findAccessibleBookFileById.mockResolvedValue(null);
    repository.findDeviceDocument.mockResolvedValue(null);
    repository.findLedgerBookFileByRemoteFilenameHash.mockResolvedValue(null);
    repository.findLedgerBookFileByFileHash.mockResolvedValue(null);
    koreaderRepository.resolveBookFileByHash.mockResolvedValue(null);

    await expect(service.resolve(7, 3, 'c'.repeat(32))).resolves.toBeNull();
  });
});
