import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { CrosspointRichPosition } from '@bookorbit/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CrosspointDevice } from './decorators/crosspoint-device.decorator';
import { CrosspointProgressDto } from './dto/crosspoint-progress.dto';
import { CrosspointSyncTokenGuard, type CrosspointDeviceContext } from './guards/crosspoint-sync-token.guard';
import { CrosspointBookmarkService } from './services/crosspoint-bookmark.service';
import { CrosspointClippingService } from './services/crosspoint-clipping.service';
import { CrosspointProgressService } from './services/crosspoint-progress.service';
import { CrosspointReadingSessionService } from './services/crosspoint-reading-session.service';

function integerQuery(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

@Controller('crosspoint/sync/:deviceToken')
@Public()
@UseGuards(CrosspointSyncTokenGuard)
export class CrosspointReaderSyncController {
  constructor(
    private readonly progress: CrosspointProgressService,
    private readonly bookmarks: CrosspointBookmarkService,
    private readonly clippings: CrosspointClippingService,
    private readonly sessions: CrosspointReadingSessionService,
  ) {}

  @Get('users/auth')
  authenticate(@Headers('x-auth-user') username?: string) {
    return { authorized: 'OK', username: username ?? 'bookorbit' };
  }

  @Post('users/create')
  @HttpCode(HttpStatus.CREATED)
  createUser(@Headers('x-auth-user') username?: string) {
    return { username: username ?? 'bookorbit' };
  }

  @Put('syncs/progress')
  saveProgress(@CurrentUser() user: RequestUser, @CrosspointDevice() device: CrosspointDeviceContext, @Body() dto: CrosspointProgressDto) {
    return this.progress.save(
      user,
      { id: device.deviceId, name: device.name },
      {
        document: dto.document,
        percentage: dto.percentage,
        progress: dto.progress,
        metadata: dto.metadata,
        position: dto.position as CrosspointRichPosition | undefined,
      },
    );
  }

  @Get('syncs/progress/:document')
  async getProgress(@CurrentUser() user: RequestUser, @CrosspointDevice() device: CrosspointDeviceContext, @Param('document') document: string) {
    const progress = await this.progress.get(user.id, device.deviceId, document);
    if (!progress) throw new NotFoundException();
    return progress;
  }

  @Get('api/v1/bookmarks/:document')
  listBookmarks(
    @CurrentUser() user: RequestUser,
    @CrosspointDevice() device: CrosspointDeviceContext,
    @Param('document') document: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.bookmarks.list(user.id, device.deviceId, document, integerQuery(cursor, 0), integerQuery(limit, 50));
  }

  @Put('api/v1/bookmarks/:document')
  saveBookmarks(
    @CurrentUser() user: RequestUser,
    @CrosspointDevice() device: CrosspointDeviceContext,
    @Param('document') document: string,
    @Body() body: unknown,
  ) {
    const items = body && typeof body === 'object' ? (body as { items?: unknown }).items : undefined;
    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      throw new BadRequestException('Invalid bookmark batch');
    }
    return this.bookmarks.save(user.id, device.deviceId, document, items);
  }

  @Get('api/v1/clippings/:document')
  listClippings(@Param('document') document: string) {
    return this.clippings.list(document);
  }

  @Put('api/v1/clippings/:document')
  saveClippings(
    @CurrentUser() user: RequestUser,
    @CrosspointDevice() device: CrosspointDeviceContext,
    @Param('document') document: string,
    @Body() body: unknown,
  ) {
    const items = body && typeof body === 'object' ? (body as { items?: unknown }).items : undefined;
    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      throw new BadRequestException('Invalid clipping batch');
    }
    return this.clippings.save(user.id, device.deviceId, document, items);
  }

  @Put('api/v1/stats/sessions')
  saveSessions(@CurrentUser() user: RequestUser, @CrosspointDevice() device: CrosspointDeviceContext, @Body() body: unknown) {
    return this.sessions.upload(user, { id: device.deviceId }, body);
  }
}
