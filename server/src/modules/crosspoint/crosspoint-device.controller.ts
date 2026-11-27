import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { AuditAction, AuditResource, Permission } from '@bookorbit/types';

import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateCrosspointDeviceDto } from './dto/create-device.dto';
import { ProbeCrosspointDeviceDto } from './dto/probe-device.dto';
import { UpdateCrosspointDeviceDto } from './dto/update-device.dto';
import { CrosspointDeviceService } from './services/crosspoint-device.service';

@Controller('crosspoint')
@RequirePermission(Permission.CrosspointSync)
export class CrosspointDeviceController {
  constructor(private readonly devices: CrosspointDeviceService) {}

  @Get('devices')
  listDevices(@CurrentUser() user: RequestUser) {
    return this.devices.listDevices(user.id);
  }

  @Post('devices')
  @Auditable({
    action: AuditAction.CrosspointDeviceRegister,
    resource: AuditResource.CrosspointDevice,
    getResourceId: (_, res: unknown) => (res as { id?: number })?.id,
    description: (req) => `Registered CrossPoint reader '${(req.body as { name?: string })?.name ?? 'unknown'}'`,
  })
  createDevice(@Body() dto: CreateCrosspointDeviceDto, @CurrentUser() user: RequestUser) {
    return this.devices.createDevice(user.id, dto);
  }

  @Patch('devices/:id')
  @Auditable({
    action: AuditAction.CrosspointDeviceUpdate,
    resource: AuditResource.CrosspointDevice,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Updated CrossPoint reader #${req.params['id']}`,
  })
  updateDevice(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCrosspointDeviceDto, @CurrentUser() user: RequestUser) {
    return this.devices.updateDevice(user.id, id, dto);
  }

  @Delete('devices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.CrosspointDeviceRemove,
    resource: AuditResource.CrosspointDevice,
    getResourceId: (req) => parseInt(req.params['id'], 10),
    description: (req) => `Removed CrossPoint reader #${req.params['id']}`,
  })
  deleteDevice(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.devices.deleteDevice(user.id, id);
  }

  @Post('probe')
  probe(@Body() dto: ProbeCrosspointDeviceDto) {
    return this.devices.probeAddress(dto);
  }

  @Post('devices/:id/probe')
  probeDevice(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.devices.probeDevice(user.id, id);
  }
}
