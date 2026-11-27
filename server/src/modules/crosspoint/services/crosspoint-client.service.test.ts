import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';

import { CrosspointClientService } from './crosspoint-client.service';

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const DEVICE_ID = 'a'.repeat(64);

describe('CrosspointClientService', () => {
  const service = new CrosspointClientService();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads a current CrossPoint status response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        version: '1.0.0',
        firmwareFamily: 'crosspoint',
        deviceId: DEVICE_ID,
        device: 'X4',
        mode: 'STA',
        ip: '192.168.1.50',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(service.probe('192.168.1.50', 81, 80)).resolves.toEqual({
      reachable: true,
      isCrosspoint: true,
      deviceId: DEVICE_ID,
      deviceModel: 'X4',
      firmwareVersion: '1.0.0',
      mode: 'STA',
      ip: '192.168.1.50',
      error: null,
    });
    expect(fetchMock).toHaveBeenCalledWith('http://192.168.1.50:80/api/status?plugin=bookorbit', expect.objectContaining({ redirect: 'error' }));
  });

  it('recognizes older firmware by its hardware model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ device: 'X3' })));

    await expect(service.probe('192.168.1.50', 81, 80)).resolves.toMatchObject({
      reachable: true,
      isCrosspoint: true,
      deviceModel: 'X3',
      deviceId: null,
      firmwareVersion: null,
    });
  });

  it('reports a reachable service that is not a CrossPoint reader', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ device: 'printer' })));

    await expect(service.probe('192.168.1.50', 81, 80)).resolves.toMatchObject({
      reachable: true,
      isCrosspoint: false,
      error: 'The address answered, but it is not a CrossPoint reader',
    });
  });

  it('reports an HTTP error as unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, 502)));

    await expect(service.probe('192.168.1.50', 81, 80)).resolves.toMatchObject({
      reachable: false,
      isCrosspoint: false,
      error: 'The reader answered with HTTP 502',
    });
  });

  it('reports a connection failure as unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));

    await expect(service.probe('192.168.1.50', 81, 80)).resolves.toMatchObject({
      reachable: false,
      isCrosspoint: false,
      error: 'Could not reach the reader: connect ECONNREFUSED',
    });
  });

  it('refuses link-local and metadata addresses before opening a connection', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(service.probe('169.254.169.254', 81, 80)).rejects.toThrow(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
