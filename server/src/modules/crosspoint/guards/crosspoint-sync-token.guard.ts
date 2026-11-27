import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { Permission } from '@bookorbit/types';
import { PermissionService } from '../../../common/services/permission.service';
import { UserService } from '../../user/user.service';
import { CrosspointRepository } from '../crosspoint.repository';

const SYNC_TOKEN_RE = /^[0-9a-f]{32}$/i;

export interface CrosspointDeviceContext {
  deviceId: number;
  userId: number;
  name: string;
  syncToken: string;
}

@Injectable()
export class CrosspointSyncTokenGuard implements CanActivate {
  constructor(
    private readonly repository: CrosspointRepository,
    private readonly userService: UserService,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = (request.params as Record<string, string | undefined>).deviceToken;
    if (!token || !SYNC_TOKEN_RE.test(token)) throw new UnauthorizedException('Invalid reader sync token');

    const device = await this.repository.findDeviceBySyncToken(token.toLowerCase());
    if (!device) throw new UnauthorizedException('Invalid reader sync token');

    const user = await this.userService.findByIdWithPermissions(device.userId);
    if (!user || !user.active) throw new UnauthorizedException('Account not found or disabled');
    if (!this.permissionService.userHas(user, Permission.CrosspointSync)) {
      throw new ForbiddenException('CrossPoint sync permission revoked');
    }

    void this.repository.updateDeviceFields(device.userId, device.id, { lastSeenAt: new Date() }).catch(() => undefined);

    const record = request as unknown as Record<string, unknown>;
    record.user = user;
    record.crosspointDevice = {
      deviceId: device.id,
      userId: device.userId,
      name: device.name,
      syncToken: device.syncToken,
    } satisfies CrosspointDeviceContext;
    return true;
  }
}
