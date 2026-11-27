import 'reflect-metadata';

import { CrosspointReadingSessionService } from './crosspoint-reading-session.service';

describe('CrosspointReadingSessionService', () => {
  const documents = { resolve: vi.fn() };
  const sessions = { save: vi.fn() };
  const service = new CrosspointReadingSessionService(documents as never, sessions as never);
  const user = { id: 7 };
  const device = { id: 3 };
  const file = { id: 9, bookId: 4, libraryId: 2, format: 'epub', progressCompatible: true };

  beforeEach(() => {
    vi.clearAllMocks();
    documents.resolve.mockResolvedValue(file);
    sessions.save.mockResolvedValue(undefined);
  });

  it('stores matched sessions and acknowledges every valid id', async () => {
    await expect(
      service.upload(user as never, device, {
        device_id: 'crosspoint-reader',
        items: [
          {
            session_id: '1712345678-aabbccddeeff',
            document: 'a'.repeat(32),
            started_at: 1_712_345_678,
            ended_at: 1_712_345_978,
            seconds: 300,
            utc_offset_minutes: 60,
          },
        ],
      }),
    ).resolves.toEqual({ until: expect.any(Number), accepted_session_ids: ['1712345678-aabbccddeeff'] });

    expect(sessions.save).toHaveBeenCalledWith(
      9,
      {
        sessionId: '1712345678-aabbccddeeff',
        startedAt: new Date(1_712_345_678_000).toISOString(),
        endedAt: new Date(1_712_345_978_000).toISOString(),
        durationSeconds: 300,
        sessionType: 'read',
      },
      user,
      'koreader',
      { sourceDeviceKey: 'crosspoint-3' },
    );
  });

  it('acknowledges unmatched sessions without storing them', async () => {
    documents.resolve.mockResolvedValue(null);

    await expect(
      service.upload(user as never, device, {
        items: [{ session_id: 's1', document: 'b'.repeat(32), started_at: 100, ended_at: 200, seconds: 100 }],
      }),
    ).resolves.toEqual({ until: expect.any(Number), accepted_session_ids: ['s1'] });
    expect(sessions.save).not.toHaveBeenCalled();
  });

  it('drops invalid items from the acknowledgement', async () => {
    await expect(
      service.upload(user as never, device, {
        items: [{ session_id: '', document: 'bad', started_at: 0, ended_at: 0, seconds: 0 }],
      }),
    ).resolves.toEqual({ until: expect.any(Number), accepted_session_ids: [] });
  });

  it('rejects an empty or oversized batch', async () => {
    await expect(service.upload(user as never, device, { items: [] })).rejects.toThrow();
    await expect(service.upload(user as never, device, { items: Array(21).fill({}) })).rejects.toThrow();
  });
});
