import { Controller, DefaultValuePipe, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { AuditAction, AuditResource, Permission } from '@bookorbit/types';

import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CrosspointSyncService } from './services/crosspoint-sync.service';

@Controller('crosspoint/devices/:id')
@RequirePermission(Permission.CrosspointSync)
export class CrosspointSyncController {
  constructor(private readonly sync: CrosspointSyncService) {}

  @Get('sync/preview')
  preview(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.sync.preview(user.id, id);
  }

  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @Auditable({
    action: AuditAction.CrosspointDeviceSync,
    resource: AuditResource.CrosspointDevice,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Started CrossPoint sync on reader #${req.params['id']}`,
  })
  start(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.sync.start(user.id, id);
  }

  @Get('sync')
  status(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.sync.status(user.id, id);
  }

  @Post('sync/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.sync.cancel(user.id, id);
  }

  @Get('runs')
  runs(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sync.listRuns(user.id, id, limit);
  }
}
