import 'reflect-metadata';
import { AuditAction } from '@bookorbit/types';

import { AUDITABLE_KEY } from '../../common/decorators/auditable.decorator';
import { CrosspointSyncController } from './crosspoint-sync.controller';

describe('CrosspointSyncController', () => {
  const service = {
    preview: vi.fn(),
    start: vi.fn(),
    status: vi.fn(),
    cancel: vi.fn(),
    listRuns: vi.fn(),
  };
  const controller = new CrosspointSyncController(service as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates every sync route with the current user id', async () => {
    service.preview.mockResolvedValue({ totalBooks: 1 });
    service.start.mockResolvedValue({ runId: 5 });
    service.status.mockResolvedValue({ run: null, currentBook: null });
    service.cancel.mockResolvedValue(undefined);
    service.listRuns.mockResolvedValue([{ id: 5 }]);

    await expect(controller.preview(1, { id: 7 } as never)).resolves.toEqual({ totalBooks: 1 });
    await expect(controller.start(1, { id: 7 } as never)).resolves.toEqual({ runId: 5 });
    await expect(controller.status(1, { id: 7 } as never)).resolves.toEqual({ run: null, currentBook: null });
    await expect(controller.cancel(1, { id: 7 } as never)).resolves.toBeUndefined();
    await expect(controller.runs(1, 25, { id: 7 } as never)).resolves.toEqual([{ id: 5 }]);

    expect(service.preview).toHaveBeenCalledWith(7, 1);
    expect(service.start).toHaveBeenCalledWith(7, 1);
    expect(service.status).toHaveBeenCalledWith(7, 1);
    expect(service.cancel).toHaveBeenCalledWith(7, 1);
    expect(service.listRuns).toHaveBeenCalledWith(7, 1, 25);
  });

  it('audits the start action against the reader id', () => {
    const audit = Reflect.getMetadata(AUDITABLE_KEY, CrosspointSyncController.prototype.start) as {
      action: AuditAction;
      getResourceId: (req: { params: Record<string, string> }) => number;
      description: (req: { params: Record<string, string> }) => string;
    };

    expect(audit.action).toBe(AuditAction.CrosspointDeviceSync);
    expect(audit.getResourceId({ params: { id: '9' } })).toBe(9);
    expect(audit.description({ params: { id: '9' } })).toContain('#9');
  });
});
