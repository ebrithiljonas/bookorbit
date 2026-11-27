import 'reflect-metadata';

import { CrosspointProgressService } from './crosspoint-progress.service';

describe('CrosspointProgressService', () => {
  const documents = { resolve: vi.fn() };
  const koreader = { applyProgressForResolvedFile: vi.fn(), getProgressForBookFile: vi.fn() };
  const service = new CrosspointProgressService(documents as never, koreader as never);
  const user = { id: 7, settings: { timezone: 'Europe/Berlin' } };
  const file = { id: 9, bookId: 4, libraryId: 2, format: 'epub', progressCompatible: true };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies progress with a per-reader device identity and rich position', async () => {
    documents.resolve.mockResolvedValue(file);

    await expect(
      service.save(
        user as never,
        { id: 3, name: 'Bedroom' },
        {
          document: 'a'.repeat(32),
          percentage: 0.42,
          progress: '/body/DocFragment[2]',
          position: { pctQ: 420000, spine: 2, page: 10, pages: 50, para: 4, xpath: '/body/DocFragment[2]' },
        },
      ),
    ).resolves.toEqual({ document: 'a'.repeat(32), timestamp: expect.any(Number) });

    expect(koreader.applyProgressForResolvedFile).toHaveBeenCalledWith(
      7,
      file,
      {
        percentage: 0.42,
        progress: '/body/DocFragment[2]',
        device: 'Bedroom',
        deviceId: 'crosspoint-3',
        position: { pctQ: 420000, spine: 2, page: 10, pages: 50, para: 4, xpath: '/body/DocFragment[2]' },
      },
      { timeZone: 'Europe/Berlin' },
    );
  });

  it('accepts but ignores unmatched progress', async () => {
    documents.resolve.mockResolvedValue(null);

    await expect(service.save(user as never, { id: 3, name: 'Bedroom' }, { document: 'b'.repeat(32), percentage: 0.2 })).resolves.toEqual({
      document: 'b'.repeat(32),
      timestamp: expect.any(Number),
    });
    expect(koreader.applyProgressForResolvedFile).not.toHaveBeenCalled();
  });

  it('returns null for an unmatched pull and delegates matched pulls', async () => {
    documents.resolve.mockResolvedValueOnce(null);
    await expect(service.get(7, 3, 'c'.repeat(32))).resolves.toBeNull();

    documents.resolve.mockResolvedValueOnce(file);
    koreader.getProgressForBookFile.mockResolvedValueOnce({ document: 'c'.repeat(32), percentage: 0.4 });
    await expect(service.get(7, 3, 'c'.repeat(32))).resolves.toMatchObject({ percentage: 0.4 });
  });
});
