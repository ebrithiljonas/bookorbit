import { Injectable, Logger } from '@nestjs/common';

const EVENT = 'crosspoint.clipping_sync';

export interface CrosspointClippingList {
  document: string;
  sync_version: 2;
  cursor: number;
  until: number;
  more: false;
  items: never[];
}

@Injectable()
export class CrosspointClippingService {
  private readonly logger = new Logger(CrosspointClippingService.name);

  list(document: string): CrosspointClippingList {
    return {
      document,
      sync_version: 2,
      cursor: 0,
      until: Math.floor(Date.now() / 1000),
      more: false,
      items: [],
    };
  }

  save(userId: number, deviceId: number, document: string, items: unknown[]): { until: number; accepted: number } {
    this.logger.debug(
      `[${EVENT}] [end] userId=${userId} deviceId=${deviceId} document=${document.slice(0, 16)} accepted=${items.length} stored=false - clippings accepted and discarded`,
    );
    return { until: Math.floor(Date.now() / 1000), accepted: items.length };
  }
}
