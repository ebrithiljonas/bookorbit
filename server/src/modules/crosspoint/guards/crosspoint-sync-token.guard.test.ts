import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { Permission } from '@bookorbit/types';
import { CrosspointSyncTokenGuard } from './crosspoint-sync-token.guard';

describe('CrosspointSyncTokenGuard', () => {
  const repository = { findDeviceBySyncToken: vi.fn(), updateDeviceFields: vi.fn() };
  const userService = { findByIdWithPermissions: vi.fn() };
  const permissionService = { userHas: vi.fn() };
  const guard = new CrosspointSyncTokenGuard(repository as never, userService as never, permissionService as never);
  const token = 'a'.repeat(32);

  function context(deviceToken: string) {
    const request = { params: { deviceToken } } as Record<string, unknown>;
    return {
      request,
      context: {
        switchToHttp: () => ({ getRequest: () => request }),
      } as never,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    repository.updateDeviceFields.mockResolvedValue(undefined);
    userService.findByIdWithPermissions.mockResolvedValue({ id: 7, active: true });
    permissionService.userHas.mockReturnValue(true);
  });

  it('resolves the token to its owner and sets the device context', async () => {
    repository.findDeviceBySyncToken.mockResolvedValue({ id: 3, userId: 7, name: 'Bedroom', syncToken: token });
    const { context: execution, request } = context(token);

    await expect(guard.canActivate(execution)).resolves.toBe(true);

    expect(repository.findDeviceBySyncToken).toHaveBeenCalledWith(token);
    expect(request.user).toEqual({ id: 7, active: true });
    expect(request.crosspointDevice).toEqual({ deviceId: 3, userId: 7, name: 'Bedroom', syncToken: token });
    expect(repository.updateDeviceFields).toHaveBeenCalledWith(7, 3, { lastSeenAt: expect.any(Date) });
  });

  it('rejects malformed, unknown, disabled and permission-revoked readers', async () => {
    await expect(guard.canActivate(context('short').context)).rejects.toThrow(UnauthorizedException);

    repository.findDeviceBySyncToken.mockResolvedValue(undefined);
    await expect(guard.canActivate(context(token).context)).rejects.toThrow(UnauthorizedException);

    repository.findDeviceBySyncToken.mockResolvedValue({ id: 3, userId: 7, name: 'Bedroom', syncToken: token });
    userService.findByIdWithPermissions.mockResolvedValue({ id: 7, active: false });
    await expect(guard.canActivate(context(token).context)).rejects.toThrow(UnauthorizedException);

    userService.findByIdWithPermissions.mockResolvedValue({ id: 7, active: true });
    permissionService.userHas.mockReturnValue(false);
    await expect(guard.canActivate(context(token).context)).rejects.toThrow(ForbiddenException);
    expect(permissionService.userHas).toHaveBeenLastCalledWith(expect.objectContaining({ id: 7 }), Permission.CrosspointSync);
  });
});
