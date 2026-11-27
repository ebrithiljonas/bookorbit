import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import type { CrosspointDeviceRow } from '../../../db/schema';
import { CrosspointDeviceService } from './crosspoint-device.service';

const NOW = new Date('2026-01-01T00:00:00.000Z');

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

function makeProbe(overrides: Record<string, unknown> = {}) {
  return {
    reachable: true,
    isCrosspoint: true,
    deviceId: 'a'.repeat(64),
    deviceModel: 'X4',
    firmwareVersion: '1.0.0',
    mode: 'STA',
    ip: '192.168.1.50',
    error: null,
    ...overrides,
  };
}

describe('CrosspointDeviceService', () => {
  const repository = {
    listDevices: vi.fn(),
    listSelections: vi.fn(),
    findDevice: vi.fn(),
    findDeviceByStableId: vi.fn(),
    findDeviceByAddress: vi.fn(),
    createDevice: vi.fn(),
    updateDevice: vi.fn(),
    updateDeviceFields: vi.fn(),
    deleteDevice: vi.fn(),
    findExistingLibraryIds: vi.fn(),
    findOwnedCollectionIds: vi.fn(),
    findVisibleSmartScopeIds: vi.fn(),
  };
  const client = { probe: vi.fn() };
  const libraryScope = { visibleIdsOrAllForUserId: vi.fn() };
  const service = new CrosspointDeviceService(repository as never, client as never, libraryScope as never);

  beforeEach(() => {
    vi.clearAllMocks();
    repository.listSelections.mockResolvedValue({
      libraryIdsByDevice: new Map(),
      collectionIdsByDevice: new Map(),
      smartScopeIdsByDevice: new Map(),
    });
    repository.findExistingLibraryIds.mockResolvedValue([]);
    libraryScope.visibleIdsOrAllForUserId.mockResolvedValue(null);
    repository.findDeviceByStableId.mockResolvedValue(undefined);
    repository.findDeviceByAddress.mockResolvedValue(undefined);
    repository.findOwnedCollectionIds.mockResolvedValue([]);
    repository.findVisibleSmartScopeIds.mockResolvedValue([]);
  });

  it('lists devices with their saved selection', async () => {
    repository.listDevices.mockResolvedValue([makeDevice()]);
    repository.listSelections.mockResolvedValue({
      libraryIdsByDevice: new Map([[1, [33]]]),
      collectionIdsByDevice: new Map([[1, [11]]]),
      smartScopeIdsByDevice: new Map([[1, [22]]]),
    });

    const [device] = await service.listDevices(7);

    expect(device).toMatchObject({
      id: 1,
      host: '192.168.1.50',
      selection: { mode: 'all', libraryIds: [33], collectionIds: [11], smartScopeIds: [22] },
      lastSeenAt: NOW.toISOString(),
    });
  });

  it('probes and registers a reader with its selection', async () => {
    client.probe.mockResolvedValue(makeProbe());
    repository.findOwnedCollectionIds.mockResolvedValue([3]);
    repository.findVisibleSmartScopeIds.mockResolvedValue([4]);
    repository.createDevice.mockImplementation((values: Partial<CrosspointDeviceRow>) => makeDevice(values));

    const device = await service.createDevice(7, {
      name: '  Bedroom reader  ',
      host: '192.168.1.50',
      removeMissing: true,
      selection: { mode: 'selected', libraryIds: [], collectionIds: [3], smartScopeIds: [4] },
    });

    expect(client.probe).toHaveBeenCalledWith('192.168.1.50', 81, 80);
    expect(repository.createDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        name: 'Bedroom reader',
        host: '192.168.1.50',
        wsPort: 81,
        httpPort: 80,
        deviceId: 'a'.repeat(64),
        deviceModel: 'X4',
        firmwareVersion: '1.0.0',
        rootFolder: '/BookOrbit',
        selectionMode: 'selected',
        removeMissing: true,
      }),
      { mode: 'selected', libraryIds: [], collectionIds: [3], smartScopeIds: [4] },
    );
    expect(device).toMatchObject({ id: 1, name: 'Bedroom reader', selection: { mode: 'selected' } });
  });

  it('registers a reader limited to selected libraries', async () => {
    client.probe.mockResolvedValue(makeProbe());
    repository.findExistingLibraryIds.mockResolvedValue([3]);
    libraryScope.visibleIdsOrAllForUserId.mockResolvedValue([2, 3]);
    repository.createDevice.mockImplementation((values: Partial<CrosspointDeviceRow>) => makeDevice(values));

    const device = await service.createDevice(7, {
      name: 'Library reader',
      host: '192.168.1.50',
      selection: { mode: 'libraries', libraryIds: [3], collectionIds: [], smartScopeIds: [] },
    });

    expect(repository.createDevice).toHaveBeenCalledWith(expect.objectContaining({ selectionMode: 'libraries' }), {
      mode: 'libraries',
      libraryIds: [3],
      collectionIds: [],
      smartScopeIds: [],
    });
    expect(device).toMatchObject({ selection: { mode: 'libraries', libraryIds: [3] } });
  });

  it('refuses a reader that is already registered under its stable id', async () => {
    client.probe.mockResolvedValue(makeProbe());
    repository.findDeviceByStableId.mockResolvedValue(makeDevice({ name: 'Already here' }));

    await expect(service.createDevice(7, { name: 'Reader', host: '192.168.1.50' })).rejects.toThrow(ConflictException);
    expect(repository.createDevice).not.toHaveBeenCalled();
  });

  it('refuses an unreachable address before writing anything', async () => {
    client.probe.mockResolvedValue(makeProbe({ reachable: false, isCrosspoint: false, error: 'connect ECONNREFUSED' }));

    await expect(service.createDevice(7, { name: 'Reader', host: '192.168.1.50' })).rejects.toThrow(BadRequestException);
    expect(repository.createDevice).not.toHaveBeenCalled();
  });

  it('updates settings and replaces the selection as one unit', async () => {
    const existing = makeDevice();
    repository.findDevice.mockResolvedValue(existing);
    repository.findOwnedCollectionIds.mockResolvedValue([5]);
    repository.updateDevice.mockImplementation((_userId: number, _id: number, values: Partial<CrosspointDeviceRow>) => makeDevice({ ...values }));

    const device = await service.updateDevice(7, 1, {
      name: 'Den reader',
      rootFolder: '/Shelf',
      selection: { mode: 'selected', libraryIds: [], collectionIds: [5], smartScopeIds: [] },
    });

    expect(repository.updateDevice).toHaveBeenCalledWith(
      7,
      1,
      expect.objectContaining({ name: 'Den reader', rootFolder: '/Shelf', selectionMode: 'selected' }),
      { mode: 'selected', libraryIds: [], collectionIds: [5], smartScopeIds: [] },
    );
    expect(device).toMatchObject({ name: 'Den reader', rootFolder: '/Shelf', selection: { mode: 'selected' } });
  });

  it('re-probes when the address changes and stores the new identity', async () => {
    repository.findDevice.mockResolvedValue(makeDevice());
    client.probe.mockResolvedValue(makeProbe({ deviceId: 'b'.repeat(64), deviceModel: 'X3' }));
    repository.updateDevice.mockImplementation((_userId: number, _id: number, values: Partial<CrosspointDeviceRow>) => makeDevice({ ...values }));

    await service.updateDevice(7, 1, { host: '192.168.1.60', httpPort: 8080 });

    expect(client.probe).toHaveBeenCalledWith('192.168.1.60', 81, 8080);
    expect(repository.updateDevice).toHaveBeenCalledWith(
      7,
      1,
      expect.objectContaining({
        host: '192.168.1.60',
        httpPort: 8080,
        deviceId: 'b'.repeat(64),
        deviceModel: 'X3',
        lastSeenAt: expect.any(Date),
      }),
      undefined,
    );
  });

  it('reports a missing reader on update and delete', async () => {
    repository.findDevice.mockResolvedValue(undefined);
    repository.deleteDevice.mockResolvedValue(false);

    await expect(service.updateDevice(7, 99, { name: 'Gone' })).rejects.toThrow(NotFoundException);
    await expect(service.deleteDevice(7, 99)).rejects.toThrow(NotFoundException);
  });

  it('records the probe when an existing reader answers', async () => {
    repository.findDevice.mockResolvedValue(makeDevice());
    client.probe.mockResolvedValue(makeProbe());

    await expect(service.probeDevice(7, 1)).resolves.toMatchObject({ reachable: true, isCrosspoint: true });
    expect(repository.updateDeviceFields).toHaveBeenCalledWith(7, 1, {
      deviceId: 'a'.repeat(64),
      deviceModel: 'X4',
      firmwareVersion: '1.0.0',
      lastSeenAt: expect.any(Date),
    });
  });
});
