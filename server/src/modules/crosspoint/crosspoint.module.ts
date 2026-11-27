import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { UserModule } from '../user/user.module';
import { CrosspointDeviceController } from './crosspoint-device.controller';
import { CrosspointSyncController } from './crosspoint-sync.controller';
import { CrosspointRepository } from './crosspoint.repository';
import { CrosspointSyncRepository } from './crosspoint-sync.repository';
import { CrosspointBookSelectionService } from './services/crosspoint-book-selection.service';
import { CrosspointClientService } from './services/crosspoint-client.service';
import { CrosspointDeviceService } from './services/crosspoint-device.service';
import { CrosspointSyncRunner } from './services/crosspoint-sync-runner.service';
import { CrosspointSyncService } from './services/crosspoint-sync.service';

@Module({
  imports: [BookModule, UserModule],
  controllers: [CrosspointDeviceController, CrosspointSyncController],
  providers: [
    CrosspointRepository,
    CrosspointSyncRepository,
    CrosspointClientService,
    CrosspointDeviceService,
    CrosspointBookSelectionService,
    CrosspointSyncRunner,
    CrosspointSyncService,
  ],
})
export class CrosspointModule {}
