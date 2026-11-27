import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';

import { CrosspointReaderSyncController } from './crosspoint-reader-sync.controller';

describe('CrosspointReaderSyncController', () => {
  const progress = { save: vi.fn(), get: vi.fn() };
  const bookmarks = { list: vi.fn(), save: vi.fn() };
  const sessions = { upload: vi.fn() };
  const controller = new CrosspointReaderSyncController(progress as never, bookmarks as never, sessions as never);
  const user = { id: 7 };
  const device = { deviceId: 3, userId: 7, name: 'Bedroom', syncToken: 'a'.repeat(32) };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('serves koReader-compatible auth, progress and extension routes', async () => {
    progress.save.mockResolvedValue({ document: 'a'.repeat(32), timestamp: 1 });
    progress.get.mockResolvedValue({ document: 'a'.repeat(32), percentage: 0.4 });
    bookmarks.list.mockResolvedValue({ document: 'a'.repeat(32), sync_version: 2, cursor: 0, until: 0, more: false, items: [] });
    bookmarks.save.mockResolvedValue({ until: 1, accepted: 1 });
    sessions.upload.mockResolvedValue({ until: 1, accepted_session_ids: ['s1'] });

    expect(controller.authenticate('bookorbit')).toEqual({ authorized: 'OK', username: 'bookorbit' });
    expect(controller.createUser('bookorbit')).toEqual({ username: 'bookorbit' });

    await expect(
      controller.saveProgress(user as never, device, {
        document: 'a'.repeat(32),
        percentage: 0.4,
        progress: '/body/DocFragment[2]',
        position: { spine: 2 },
      }),
    ).resolves.toEqual({ document: 'a'.repeat(32), timestamp: 1 });
    expect(progress.save).toHaveBeenCalledWith(
      user,
      { id: 3, name: 'Bedroom' },
      {
        document: 'a'.repeat(32),
        percentage: 0.4,
        progress: '/body/DocFragment[2]',
        metadata: undefined,
        position: { spine: 2 },
      },
    );

    await expect(controller.getProgress(user as never, device, 'a'.repeat(32))).resolves.toMatchObject({ percentage: 0.4 });
    await expect(controller.listBookmarks(user as never, device, 'a'.repeat(32), '0', '10')).resolves.toMatchObject({
      sync_version: 2,
    });
    await expect(controller.saveBookmarks(user as never, device, 'a'.repeat(32), { items: [{ id: 'a'.repeat(16) }] })).resolves.toEqual({
      until: 1,
      accepted: 1,
    });
    await expect(controller.saveSessions(user as never, device, { items: [{}] })).resolves.toEqual({
      until: 1,
      accepted_session_ids: ['s1'],
    });
  });

  it('returns not found when a reader has no stored progress', async () => {
    progress.get.mockResolvedValue(null);
    await expect(controller.getProgress(user as never, device, 'b'.repeat(32))).rejects.toThrow(NotFoundException);
  });

  it('rejects a missing bookmark batch', () => {
    expect(() => controller.saveBookmarks(user as never, device, 'a'.repeat(32), {})).toThrow();
  });
});
