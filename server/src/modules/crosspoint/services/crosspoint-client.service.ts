import { Injectable, Logger } from '@nestjs/common';
import type { CrosspointProbeResult } from '@bookorbit/types';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { ensureSafeRemoteHost } from '../../../common/utils/ssrf.utils';
import { crosspointHttpUrl } from '../crosspoint-path.utils';

const PROBE_TIMEOUT_MS = 4_000;

@Injectable()
export class CrosspointClientService {
  private readonly logger = new Logger(CrosspointClientService.name);

  /**
   * Asks the reader for its status. A reachable non-CrossPoint service is reported as such rather
   * than thrown, so the add form can explain the difference between offline and wrong address.
   */
  async probe(host: string, wsPort: number, httpPort: number): Promise<CrosspointProbeResult> {
    const startedAt = Date.now();
    const safeHost = sanitizeLogValue(host);
    this.logger.log(`[crosspoint.probe] [start] host="${safeHost}" wsPort=${wsPort} httpPort=${httpPort} - reader probe started`);

    try {
      await ensureSafeRemoteHost(host, { allowPrivate: true, allowLocal: true, blockLinkLocal: true });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `[crosspoint.probe] [fail] host="${safeHost}" durationMs=${Date.now() - startedAt} errorClass=${err.name} error="${sanitizeLogValue(err.message)}" - reader address rejected`,
      );
      throw error;
    }

    let response: Response;
    try {
      response = await fetch(`${crosspointHttpUrl(host, httpPort)}/api/status?plugin=bookorbit`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `[crosspoint.probe] [fail] host="${safeHost}" durationMs=${Date.now() - startedAt} errorClass=${err.name} error="${sanitizeLogValue(err.message)}" - reader unreachable`,
      );
      return this.unreachable(`Could not reach the reader: ${err.message}`);
    }

    if (!response.ok) {
      this.logger.warn(
        `[crosspoint.probe] [fail] host="${safeHost}" durationMs=${Date.now() - startedAt} errorClass=HttpError error="HTTP ${response.status}" - reader status request failed`,
      );
      return this.unreachable(`The reader answered with HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return this.unreachable('The reader returned an invalid status response');
    }

    if (!body || typeof body !== 'object') {
      return this.unreachable('The reader returned an invalid status response');
    }

    const data = body as Record<string, unknown>;
    const deviceModel = data.device === 'X3' || data.device === 'X4' ? data.device : null;
    const firmwareFamily = typeof data.firmwareFamily === 'string' ? data.firmwareFamily : null;
    const isCrosspoint = firmwareFamily === 'crosspoint' || deviceModel !== null;
    const deviceId = typeof data.deviceId === 'string' && /^[0-9a-f]{64}$/i.test(data.deviceId) ? data.deviceId : null;
    const firmwareVersion = typeof data.version === 'string' ? data.version : null;
    const mode = typeof data.mode === 'string' ? data.mode : null;
    const ip = typeof data.ip === 'string' ? data.ip : null;

    this.logger.log(
      `[crosspoint.probe] [end] host="${safeHost}" durationMs=${Date.now() - startedAt} reachable=true crosspoint=${isCrosspoint} model=${deviceModel ?? 'none'} - reader probe completed`,
    );

    return {
      reachable: true,
      isCrosspoint,
      deviceId,
      deviceModel,
      firmwareVersion,
      mode,
      ip,
      error: isCrosspoint ? null : 'The address answered, but it is not a CrossPoint reader',
    };
  }

  private unreachable(error: string): CrosspointProbeResult {
    return {
      reachable: false,
      isCrosspoint: false,
      deviceId: null,
      deviceModel: null,
      firmwareVersion: null,
      mode: null,
      ip: null,
      error,
    };
  }
}
