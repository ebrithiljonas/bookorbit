import { Module } from '@nestjs/common';

import { CrosspointDeviceController } from './crosspoint-device.controller';
import { CrosspointRepository } from './crosspoint.repository';
import { CrosspointClientService } from './services/crosspoint-client.service';
import { CrosspointDeviceService } from './services/crosspoint-device.service';
import { CrosspointDiscoveryService } from './services/crosspoint-discovery.service';

@Module({
  controllers: [CrosspointDeviceController],
  providers: [CrosspointRepository, CrosspointClientService, CrosspointDeviceService, CrosspointDiscoveryService],
})
export class CrosspointModule {}
