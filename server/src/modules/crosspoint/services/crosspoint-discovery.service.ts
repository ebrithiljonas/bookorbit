import { Injectable, Logger } from '@nestjs/common';
import * as dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';

/** Ports used by CrossPoint firmware across releases, newest first. */
export const CROSSPOINT_DISCOVERY_PORTS = [8134, 54982, 48123, 39001, 44044, 59678];
const DISCOVERY_ROUNDS = 3;
const DISCOVERY_ROUND_WAIT_MS = 600;

export interface RawCrosspointDiscoveredDevice {
  host: string;
  wsPort: number;
  hostname: string | null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** IPv4 subnet broadcast for one interface, or null when the pair is not a usable IPv4 address. */
export function computeBroadcastAddress(address: string, netmask: string): string | null {
  const addressParts = address.split('.').map(Number);
  const maskParts = netmask.split('.').map(Number);
  if (addressParts.length !== 4 || maskParts.length !== 4) return null;
  if (addressParts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  if (maskParts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return addressParts.map((part, index) => (part & maskParts[index]!) | (~maskParts[index]! & 0xff)).join('.');
}

/** Parses `crosspoint (on <hostname>);81` without trusting any field beyond the reply itself. */
export function parseDiscoveryResponse(text: string, host: string): RawCrosspointDiscoveredDevice | null {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith('crosspoint')) return null;

  const separator = trimmed.lastIndexOf(';');
  let wsPort = 81;
  if (separator !== -1) {
    const portText = trimmed
      .slice(separator + 1)
      .split(',')[0]
      ?.trim();
    const parsed = Number.parseInt(portText ?? '', 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) wsPort = parsed;
  }

  const hostname = /\(on\s+([^)]+)\)/i.exec(trimmed)?.[1]?.trim() || null;
  return { host, wsPort, hostname };
}

@Injectable()
export class CrosspointDiscoveryService {
  private readonly logger = new Logger(CrosspointDiscoveryService.name);

  async discover(): Promise<RawCrosspointDiscoveredDevice[]> {
    const startedAt = Date.now();
    const targets = this.buildTargets();
    this.logger.log(
      `[crosspoint.discovery] [start] ports=${CROSSPOINT_DISCOVERY_PORTS.length} targets=${targets.length} - network discovery started`,
    );

    const found = new Map<string, RawCrosspointDiscoveredDevice>();
    const socket = dgram.createSocket({ type: 'udp4' });

    const onMessage = (message: Buffer, remote: dgram.RemoteInfo) => {
      const parsed = parseDiscoveryResponse(message.toString('utf8'), remote.address);
      if (!parsed) return;
      found.set(`${parsed.host}:${parsed.wsPort}`, parsed);
    };
    socket.on('message', onMessage);
    socket.on('error', (error) => {
      this.logger.warn(
        `[crosspoint.discovery] [fail] durationMs=${Date.now() - startedAt} errorClass=${error.name} error="${sanitizeLogValue(error.message)}" - discovery socket failed`,
      );
    });

    try {
      await this.bind(socket);
      try {
        socket.setBroadcast(true);
      } catch {
        // Some container networks reject the option. Unicast targets still work.
      }

      for (let round = 0; round < DISCOVERY_ROUNDS; round += 1) {
        for (const target of targets) {
          socket.send(Buffer.from('hello'), target.port, target.host, () => undefined);
        }
        await delay(DISCOVERY_ROUND_WAIT_MS);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `[crosspoint.discovery] [fail] durationMs=${Date.now() - startedAt} errorClass=${err.name} error="${sanitizeLogValue(err.message)}" - network discovery failed`,
      );
    } finally {
      socket.off('message', onMessage);
      try {
        socket.close();
      } catch {
        // Already closed by the bind failure.
      }
    }

    const devices = [...found.values()].sort((a, b) => a.host.localeCompare(b.host) || a.wsPort - b.wsPort);
    this.logger.log(`[crosspoint.discovery] [end] durationMs=${Date.now() - startedAt} devices=${devices.length} - network discovery completed`);
    return devices;
  }

  private bind(socket: dgram.Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        socket.off('error', onError);
        reject(error);
      };
      socket.once('error', onError);
      socket.bind(0, () => {
        socket.off('error', onError);
        resolve();
      });
    });
  }

  private buildTargets(): { host: string; port: number }[] {
    const broadcasts = new Set<string>(['255.255.255.255']);
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family !== 'IPv4' || entry.internal) continue;
        const broadcast = computeBroadcastAddress(entry.address, entry.netmask);
        if (broadcast) broadcasts.add(broadcast);
      }
    }

    const targets: { host: string; port: number }[] = [];
    for (const host of broadcasts) {
      for (const port of CROSSPOINT_DISCOVERY_PORTS) targets.push({ host, port });
    }
    return targets;
  }
}
