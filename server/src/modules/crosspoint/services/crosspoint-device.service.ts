import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CROSSPOINT_DEFAULT_FILE_NAMING_PATTERN,
  CROSSPOINT_DEFAULT_HTTP_PORT,
  CROSSPOINT_DEFAULT_ROOT_FOLDER,
  CROSSPOINT_DEFAULT_WS_PORT,
  type CrosspointDeviceInfo,
  type CrosspointProbeResult,
  type CrosspointSelection,
} from '@bookorbit/types';

import { isUniqueViolation } from '../../../common/utils/db-error.utils';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { LibraryScopeService } from '../../../common/library-scope/library-scope.service';
import { ensureSafeRemoteHost } from '../../../common/utils/ssrf.utils';
import type { CrosspointDeviceRow } from '../../../db/schema';
import type { CreateCrosspointDeviceDto } from '../dto/create-device.dto';
import type { ProbeCrosspointDeviceDto } from '../dto/probe-device.dto';
import type { UpdateCrosspointDeviceDto } from '../dto/update-device.dto';
import { normalizeCrosspointFileNamingPattern, normalizeCrosspointRootFolder } from '../crosspoint-path.utils';
import { CrosspointRepository, type DeviceSelectionRows } from '../crosspoint.repository';
import { CrosspointClientService } from './crosspoint-client.service';

interface CrosspointAddress {
  host: string;
  wsPort: number;
  httpPort: number;
}

interface CrosspointSelectionInput {
  mode: CrosspointSelection['mode'];
  libraryIds?: number[];
  collectionIds?: number[];
  smartScopeIds?: number[];
}

@Injectable()
export class CrosspointDeviceService {
  private readonly logger = new Logger(CrosspointDeviceService.name);

  constructor(
    private readonly repository: CrosspointRepository,
    private readonly client: CrosspointClientService,
    private readonly libraryScope: LibraryScopeService,
  ) {}

  async listDevices(userId: number): Promise<CrosspointDeviceInfo[]> {
    const devices = await this.repository.listDevices(userId);
    if (devices.length === 0) return [];
    const selections = await this.repository.listSelections(
      userId,
      devices.map((device) => device.id),
    );
    return devices.map((device) => this.toInfo(device, this.selectionFor(device, selections)));
  }

  async createDevice(userId: number, dto: CreateCrosspointDeviceDto): Promise<CrosspointDeviceInfo> {
    const startedAt = Date.now();
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Reader name is required');
    const address = await this.resolveAddress(dto.host, dto.wsPort, dto.httpPort);
    this.logger.log(`[crosspoint.device.create] [start] userId=${userId} host="${sanitizeLogValue(address.host)}" - reader registration started`);

    try {
      const probe = await this.probeOrThrow(address);
      if (probe.deviceId) {
        const existing = await this.repository.findDeviceByStableId(userId, probe.deviceId);
        if (existing) throw new ConflictException(`This reader is already added as "${existing.name}"`);
      }
      const sameAddress = await this.repository.findDeviceByAddress(userId, address.host, address.wsPort);
      if (sameAddress) throw new ConflictException('A reader is already added at this address');

      const selection = this.normalizeSelection(dto.selection);
      await this.assertSelectionVisible(userId, selection);
      const rootFolder = normalizeCrosspointRootFolder(dto.rootFolder ?? CROSSPOINT_DEFAULT_ROOT_FOLDER);
      const fileNamingPattern = normalizeCrosspointFileNamingPattern(dto.fileNamingPattern ?? CROSSPOINT_DEFAULT_FILE_NAMING_PATTERN);

      const device = await this.repository.createDevice(
        {
          userId,
          name,
          host: address.host,
          wsPort: address.wsPort,
          httpPort: address.httpPort,
          deviceId: probe.deviceId,
          deviceModel: probe.deviceModel,
          firmwareVersion: probe.firmwareVersion,
          rootFolder,
          fileNamingPattern,
          selectionMode: selection.mode,
          removeMissing: dto.removeMissing ?? false,
          lastSeenAt: new Date(),
        },
        selection,
      );

      this.logger.log(
        `[crosspoint.device.create] [end] userId=${userId} deviceId=${device.id} durationMs=${Date.now() - startedAt} model=${device.deviceModel ?? 'unknown'} - reader registration completed`,
      );
      return this.toInfo(device, selection);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (isUniqueViolation(error)) throw new ConflictException('This reader is already added');
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `[crosspoint.device.create] [fail] userId=${userId} host="${sanitizeLogValue(address.host)}" durationMs=${Date.now() - startedAt} errorClass=${err.name} error="${sanitizeLogValue(err.message)}" - reader registration failed`,
      );
      throw error;
    }
  }

  async updateDevice(userId: number, deviceId: number, dto: UpdateCrosspointDeviceDto): Promise<CrosspointDeviceInfo> {
    const startedAt = Date.now();
    const existing = await this.repository.findDevice(userId, deviceId);
    if (!existing) throw new NotFoundException('Reader not found');

    this.logger.log(`[crosspoint.device.update] [start] userId=${userId} deviceId=${deviceId} - reader update started`);
    try {
      const values: Partial<typeof existing> = {};

      if (dto.name !== undefined) {
        const name = dto.name.trim();
        if (!name) throw new BadRequestException('Reader name is required');
        values.name = name;
      }
      if (dto.rootFolder !== undefined) values.rootFolder = normalizeCrosspointRootFolder(dto.rootFolder);
      if (dto.fileNamingPattern !== undefined) {
        values.fileNamingPattern = normalizeCrosspointFileNamingPattern(dto.fileNamingPattern);
      }
      if (dto.removeMissing !== undefined) values.removeMissing = dto.removeMissing;

      const host = dto.host !== undefined ? dto.host.trim().toLowerCase() : existing.host;
      const wsPort = dto.wsPort ?? existing.wsPort;
      const httpPort = dto.httpPort ?? existing.httpPort;
      const addressChanged = host !== existing.host || wsPort !== existing.wsPort || httpPort !== existing.httpPort;

      if (addressChanged) {
        const address = await this.resolveAddress(host, wsPort, httpPort);
        const probe = await this.probeOrThrow(address);
        if (probe.deviceId) {
          const duplicate = await this.repository.findDeviceByStableId(userId, probe.deviceId);
          if (duplicate && duplicate.id !== existing.id) {
            throw new ConflictException(`This reader is already added as "${duplicate.name}"`);
          }
        }
        const duplicateAddress = await this.repository.findDeviceByAddress(userId, address.host, address.wsPort);
        if (duplicateAddress && duplicateAddress.id !== existing.id) {
          throw new ConflictException('A reader is already added at this address');
        }
        values.host = address.host;
        values.wsPort = address.wsPort;
        values.httpPort = address.httpPort;
        values.deviceId = probe.deviceId;
        values.deviceModel = probe.deviceModel;
        values.firmwareVersion = probe.firmwareVersion;
        values.lastSeenAt = new Date();
      }

      let selection: CrosspointSelection | undefined;
      if (dto.selection) {
        selection = this.normalizeSelection(dto.selection);
        await this.assertSelectionVisible(userId, selection);
        values.selectionMode = selection.mode;
      }

      const device = await this.repository.updateDevice(userId, deviceId, values, selection);
      if (!device) throw new NotFoundException('Reader not found');
      const resolvedSelection = selection ?? (await this.loadSelection(userId, deviceId));

      this.logger.log(
        `[crosspoint.device.update] [end] userId=${userId} deviceId=${deviceId} durationMs=${Date.now() - startedAt} addressChanged=${addressChanged} - reader update completed`,
      );
      return this.toInfo(device, resolvedSelection);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (isUniqueViolation(error)) throw new ConflictException('This reader is already added');
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `[crosspoint.device.update] [fail] userId=${userId} deviceId=${deviceId} durationMs=${Date.now() - startedAt} errorClass=${err.name} error="${sanitizeLogValue(err.message)}" - reader update failed`,
      );
      throw error;
    }
  }

  async deleteDevice(userId: number, deviceId: number): Promise<void> {
    const deleted = await this.repository.deleteDevice(userId, deviceId);
    if (!deleted) throw new NotFoundException('Reader not found');
  }

  async probeDevice(userId: number, deviceId: number): Promise<CrosspointProbeResult> {
    const device = await this.repository.findDevice(userId, deviceId);
    if (!device) throw new NotFoundException('Reader not found');

    const probe = await this.client.probe(device.host, device.wsPort, device.httpPort);
    if (!probe.reachable || !probe.isCrosspoint) return probe;

    if (probe.deviceId) {
      const duplicate = await this.repository.findDeviceByStableId(userId, probe.deviceId);
      if (duplicate && duplicate.id !== device.id) {
        throw new ConflictException(`This reader is already added as "${duplicate.name}"`);
      }
    }

    await this.repository.updateDeviceFields(userId, deviceId, {
      deviceId: probe.deviceId,
      deviceModel: probe.deviceModel,
      firmwareVersion: probe.firmwareVersion,
      lastSeenAt: new Date(),
    });
    return probe;
  }

  async probeAddress(dto: ProbeCrosspointDeviceDto): Promise<CrosspointProbeResult> {
    const address = await this.resolveAddress(dto.host, dto.wsPort, dto.httpPort);
    return this.client.probe(address.host, address.wsPort, address.httpPort);
  }

  private async resolveAddress(host: string, wsPort?: number, httpPort?: number): Promise<CrosspointAddress> {
    const trimmed = host.trim().toLowerCase();
    if (!trimmed) throw new BadRequestException('Reader address is required');
    await ensureSafeRemoteHost(trimmed, { allowPrivate: true, allowLocal: true, blockLinkLocal: true });
    return {
      host: trimmed,
      wsPort: wsPort ?? CROSSPOINT_DEFAULT_WS_PORT,
      httpPort: httpPort ?? CROSSPOINT_DEFAULT_HTTP_PORT,
    };
  }

  private async probeOrThrow(address: CrosspointAddress): Promise<CrosspointProbeResult> {
    const probe = await this.client.probe(address.host, address.wsPort, address.httpPort);
    if (!probe.reachable) {
      throw new BadRequestException({
        message: 'The reader could not be reached. Put it into File Transfer mode and check its address and network.',
        errorCode: 'CROSSPOINT_READER_UNREACHABLE',
      });
    }
    if (!probe.isCrosspoint) {
      throw new BadRequestException({
        message: 'That address answered, but it is not a CrossPoint reader.',
        errorCode: 'CROSSPOINT_NOT_A_READER',
      });
    }
    return probe;
  }

  private normalizeSelection(selection?: CrosspointSelectionInput): CrosspointSelection {
    return {
      mode: selection?.mode ?? 'all',
      libraryIds: [...new Set(selection?.libraryIds ?? [])],
      collectionIds: [...new Set(selection?.collectionIds ?? [])],
      smartScopeIds: [...new Set(selection?.smartScopeIds ?? [])],
    };
  }

  private async assertSelectionVisible(userId: number, selection: CrosspointSelection): Promise<void> {
    const [existingLibraries, accessibleLibraryIds, ownedCollections, visibleSmartScopes] = await Promise.all([
      this.repository.findExistingLibraryIds(selection.libraryIds),
      this.libraryScope.visibleIdsOrAllForUserId(userId),
      this.repository.findOwnedCollectionIds(userId, selection.collectionIds),
      this.repository.findVisibleSmartScopeIds(userId, selection.smartScopeIds),
    ]);
    if (existingLibraries.length !== selection.libraryIds.length) {
      throw new BadRequestException('One or more selected libraries no longer exist');
    }
    if (accessibleLibraryIds !== null && selection.libraryIds.some((id) => !accessibleLibraryIds.includes(id))) {
      throw new BadRequestException('One or more selected libraries are not available');
    }
    if (ownedCollections.length !== selection.collectionIds.length) {
      throw new BadRequestException('One or more selected collections no longer exist');
    }
    if (visibleSmartScopes.length !== selection.smartScopeIds.length) {
      throw new BadRequestException('One or more selected smart scopes are not available');
    }
  }

  private async loadSelection(userId: number, deviceId: number): Promise<CrosspointSelection> {
    const selections = await this.repository.listSelections(userId, [deviceId]);
    return {
      mode: (await this.repository.findDevice(userId, deviceId))?.selectionMode ?? 'all',
      libraryIds: selections.libraryIdsByDevice.get(deviceId) ?? [],
      collectionIds: selections.collectionIdsByDevice.get(deviceId) ?? [],
      smartScopeIds: selections.smartScopeIdsByDevice.get(deviceId) ?? [],
    };
  }

  private selectionFor(device: CrosspointDeviceRow, selections: DeviceSelectionRows): CrosspointSelection {
    return {
      mode: device.selectionMode,
      libraryIds: selections.libraryIdsByDevice.get(device.id) ?? [],
      collectionIds: selections.collectionIdsByDevice.get(device.id) ?? [],
      smartScopeIds: selections.smartScopeIdsByDevice.get(device.id) ?? [],
    };
  }

  private toInfo(device: CrosspointDeviceRow, selection: CrosspointSelection): CrosspointDeviceInfo {
    return {
      id: device.id,
      name: device.name,
      host: device.host,
      wsPort: device.wsPort,
      httpPort: device.httpPort,
      deviceId: device.deviceId,
      deviceModel: device.deviceModel,
      firmwareVersion: device.firmwareVersion,
      rootFolder: device.rootFolder,
      fileNamingPattern: device.fileNamingPattern,
      removeMissing: device.removeMissing,
      selection,
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      lastSyncAt: device.lastSyncAt?.toISOString() ?? null,
      createdAt: device.createdAt.toISOString(),
      updatedAt: device.updatedAt.toISOString(),
    };
  }
}
