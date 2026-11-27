import { Module } from '@nestjs/common';

import { CommonModule } from '../../common/common.module';
import { BookModule } from '../book/book.module';
import { BookmarkModule } from '../bookmark/bookmark.module';
import { KoreaderModule } from '../koreader/koreader.module';
import { PositionConverterModule } from '../position-converter/position-converter.module';
import { ReadingSessionModule } from '../reading-session/reading-session.module';
import { UserModule } from '../user/user.module';
import { CrosspointBookmarkRepository } from './crosspoint-bookmark.repository';
import { CrosspointDeviceController } from './crosspoint-device.controller';
import { CrosspointReaderSyncController } from './crosspoint-reader-sync.controller';
import { CrosspointRepository } from './crosspoint.repository';
import { CrosspointSyncController } from './crosspoint-sync.controller';
import { CrosspointSyncRepository } from './crosspoint-sync.repository';
import { CrosspointSyncTokenGuard } from './guards/crosspoint-sync-token.guard';
import { CrosspointBookSelectionService } from './services/crosspoint-book-selection.service';
import { CrosspointBookmarkService } from './services/crosspoint-bookmark.service';
import { CrosspointClientService } from './services/crosspoint-client.service';
import { CrosspointClippingService } from './services/crosspoint-clipping.service';
import { CrosspointDeviceService } from './services/crosspoint-device.service';
import { CrosspointDocumentService } from './services/crosspoint-document.service';
import { CrosspointProgressService } from './services/crosspoint-progress.service';
import { CrosspointReadingSessionService } from './services/crosspoint-reading-session.service';
import { CrosspointSyncRunner } from './services/crosspoint-sync-runner.service';
import { CrosspointSyncService } from './services/crosspoint-sync.service';

@Module({
  imports: [CommonModule, BookModule, BookmarkModule, KoreaderModule, PositionConverterModule, ReadingSessionModule, UserModule],
  controllers: [CrosspointDeviceController, CrosspointReaderSyncController, CrosspointSyncController],
  providers: [
    CrosspointRepository,
    CrosspointSyncRepository,
    CrosspointBookmarkRepository,
    CrosspointSyncTokenGuard,
    CrosspointClientService,
    CrosspointDeviceService,
    CrosspointDocumentService,
    CrosspointProgressService,
    CrosspointBookmarkService,
    CrosspointClippingService,
    CrosspointReadingSessionService,
    CrosspointBookSelectionService,
    CrosspointSyncRunner,
    CrosspointSyncService,
  ],
})
export class CrosspointModule {}
