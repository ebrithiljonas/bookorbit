import 'reflect-metadata';

import { CrosspointClippingService } from './crosspoint-clipping.service';

describe('CrosspointClippingService', () => {
  const service = new CrosspointClippingService();
  const document = 'a'.repeat(32);

  it('answers the clipping probe with an empty v2 snapshot', () => {
    expect(service.list(document)).toEqual({
      document,
      sync_version: 2,
      cursor: 0,
      until: expect.any(Number),
      more: false,
      items: [],
    });
  });

  it('accepts and discards clipping uploads', () => {
    expect(service.save(7, 3, document, [{ id: 'clip-1' }, { id: 'clip-2' }])).toEqual({
      until: expect.any(Number),
      accepted: 2,
    });
  });
});
