import 'reflect-metadata';
import { AuditAction } from '@bookorbit/types';

import { AUDITABLE_KEY } from '../../common/decorators/auditable.decorator';
import { CrosspointDeviceController } from './crosspoint-device.controller';

describe('CrosspointDeviceController', () => {
  const service = {
    listDevices: vi.fn(),
    createDevice: vi.fn(),
    updateDevice: vi.fn(),
    deleteDevice: vi.fn(),
    rotateSyncToken: vi.fn(),
    probeAddress: vi.fn(),
    probeDevice: vi.fn(),
  };
  const controller = new CrosspointDeviceController(service as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates device operations with the current user id', async () => {
    service.listDevices.mockResolvedValue([{ id: 1 }]);
    service.createDevice.mockResolvedValue({ id: 2, name: 'Reader' });
    service.updateDevice.mockResolvedValue({ id: 2, name: 'Den' });
    service.deleteDevice.mockResolvedValue(undefined);
    service.rotateSyncToken.mockResolvedValue({ syncToken: 'a'.repeat(32) });
    service.probeAddress.mockResolvedValue({ reachable: true });
    service.probeDevice.mockResolvedValue({ reachable: true });

    await expect(controller.listDevices({ id: 7 } as never)).resolves.toEqual([{ id: 1 }]);
    await expect(controller.createDevice({ name: 'Reader', host: '192.168.1.50' } as never, { id: 7 } as never)).resolves.toEqual({
      id: 2,
      name: 'Reader',
    });
    await expect(controller.updateDevice(2, { name: 'Den' } as never, { id: 7 } as never)).resolves.toEqual({ id: 2, name: 'Den' });
    await expect(controller.deleteDevice(2, { id: 7 } as never)).resolves.toBeUndefined();
    await expect(controller.rotateSyncToken(2, { id: 7 } as never)).resolves.toEqual({ syncToken: 'a'.repeat(32) });
    await expect(controller.probe({ host: '192.168.1.50' } as never)).resolves.toEqual({ reachable: true });
    await expect(controller.probeDevice(2, { id: 7 } as never)).resolves.toEqual({ reachable: true });

    expect(service.listDevices).toHaveBeenCalledWith(7);
    expect(service.createDevice).toHaveBeenCalledWith(7, { name: 'Reader', host: '192.168.1.50' });
    expect(service.updateDevice).toHaveBeenCalledWith(7, 2, { name: 'Den' });
    expect(service.deleteDevice).toHaveBeenCalledWith(7, 2);
    expect(service.rotateSyncToken).toHaveBeenCalledWith(7, 2);
    expect(service.probeAddress).toHaveBeenCalledWith({ host: '192.168.1.50' });
    expect(service.probeDevice).toHaveBeenCalledWith(7, 2);
  });

  it('registers auditable metadata for register, update and remove actions', () => {
    const createAudit = Reflect.getMetadata(AUDITABLE_KEY, CrosspointDeviceController.prototype.createDevice) as {
      action: AuditAction;
      getResourceId: (_: unknown, response: { id?: number }) => number | undefined;
      description: (req: { body: { name?: string } }) => string;
    };
    const updateAudit = Reflect.getMetadata(AUDITABLE_KEY, CrosspointDeviceController.prototype.updateDevice) as {
      action: AuditAction;
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }) => string;
    };
    const deleteAudit = Reflect.getMetadata(AUDITABLE_KEY, CrosspointDeviceController.prototype.deleteDevice) as {
      action: AuditAction;
      getResourceId: (req: { params: Record<string, string> }) => number;
    };

    expect(createAudit.action).toBe(AuditAction.CrosspointDeviceRegister);
    expect(createAudit.getResourceId({}, { id: 22 })).toBe(22);
    expect(createAudit.description({ body: { name: 'Bedroom' } })).toContain('Bedroom');

    expect(updateAudit.action).toBe(AuditAction.CrosspointDeviceUpdate);
    expect(updateAudit.getResourceId({ params: { id: '9' } })).toBe(9);
    expect(updateAudit.description({ params: { id: '9' } })).toContain('#9');

    expect(deleteAudit.action).toBe(AuditAction.CrosspointDeviceRemove);
    expect(deleteAudit.getResourceId({ params: { id: '44' } })).toBe(44);
  });
});
