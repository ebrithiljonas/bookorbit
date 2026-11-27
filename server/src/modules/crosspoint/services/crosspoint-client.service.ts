import { Injectable, Logger } from '@nestjs/common';
import type { CrosspointFileEntry, CrosspointProbeResult, CrosspointUploadProgress } from '@bookorbit/types';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { WebSocket } from 'undici';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { ensureSafeRemoteHost } from '../../../common/utils/ssrf.utils';
import { ancestorDeviceDirectories, crosspointHttpUrl, crosspointWebSocketUrl, normalizeDevicePath } from '../crosspoint-path.utils';

const PROBE_TIMEOUT_MS = 4_000;
const FILE_LIST_TIMEOUT_MS = 15_000;
const MKDIR_TIMEOUT_MS = 10_000;
const DELETE_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;
const MESSAGE_TIMEOUT_MS = 30_000;
const DRAIN_TIMEOUT_MS = 30_000;
const MAX_BUFFERED_BYTES = 256 * 1024;
const DEFAULT_CHUNK_SIZE = 2048;

type Socket = InstanceType<typeof WebSocket>;

interface MessageWaiter {
  predicate: (message: string) => boolean;
  resolve: (message: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface UploadOptions {
  host: string;
  wsPort: number;
  directory: string;
  filename: string;
  filePath?: string;
  contents?: Buffer;
  chunkSize?: number;
  signal?: AbortSignal;
  onProgress?: (progress: CrosspointUploadProgress) => void;
}

export class CrosspointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class CrosspointHttpError extends CrosspointError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class CrosspointAbortError extends CrosspointError {}

export class CrosspointTimeoutError extends CrosspointError {}

export class CrosspointSocketClosedError extends CrosspointError {}

export class CrosspointDeviceError extends CrosspointError {
  constructor(
    message: string,
    readonly deviceMessage: string,
  ) {
    super(message);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      return this.unreachable('Could not reach the reader. Put it into File Transfer mode and check its address and network.');
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

  async listFiles(host: string, httpPort: number, path: string): Promise<CrosspointFileEntry[]> {
    const normalizedPath = normalizeDevicePath(path);
    const url = `${crosspointHttpUrl(host, httpPort)}/api/files?path=${encodeURIComponent(normalizedPath)}`;
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(FILE_LIST_TIMEOUT_MS), redirect: 'error' });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new CrosspointError(`Could not list ${normalizedPath}: ${err.message}`);
    }

    if (response.status === 404) return [];
    if (!response.ok) throw new CrosspointHttpError(`Could not list ${normalizedPath}: HTTP ${response.status}`, response.status);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new CrosspointError(`The reader returned an invalid listing for ${normalizedPath}`);
    }
    if (!Array.isArray(body)) throw new CrosspointError(`The reader returned an invalid listing for ${normalizedPath}`);

    return body.flatMap((entry) => this.parseFileEntry(entry, normalizedPath));
  }

  /** Every file under the managed root, recursively. Folders are walked but not returned. */
  async listFilesRecursive(host: string, httpPort: number, root: string): Promise<CrosspointFileEntry[]> {
    const normalizedRoot = normalizeDevicePath(root);
    const files: CrosspointFileEntry[] = [];
    const pending = [normalizedRoot];
    const visited = new Set<string>();

    while (pending.length > 0) {
      const directory = pending.pop()!;
      if (visited.has(directory)) continue;
      visited.add(directory);

      const entries = await this.listFiles(host, httpPort, directory);
      for (const entry of entries) {
        if (entry.isDirectory) pending.push(entry.path);
        else files.push(entry);
      }
    }

    return files;
  }

  async ensureDirectory(host: string, httpPort: number, path: string): Promise<void> {
    const normalizedPath = normalizeDevicePath(path);
    if (normalizedPath === '/') return;

    let current = '/';
    for (const segment of normalizedPath.slice(1).split('/')) {
      const entries = await this.listFiles(host, httpPort, current);
      if (entries.some((entry) => entry.isDirectory && entry.name === segment)) {
        current = current === '/' ? `/${segment}` : `${current}/${segment}`;
        continue;
      }

      await this.mkdir(host, httpPort, segment, current);
      current = current === '/' ? `/${segment}` : `${current}/${segment}`;
    }
  }

  async deletePaths(host: string, httpPort: number, paths: string[]): Promise<void> {
    const normalizedPaths = paths.map((path) => normalizeDevicePath(path)).filter((path) => path !== '/');
    if (normalizedPaths.length === 0) return;

    const url = `${crosspointHttpUrl(host, httpPort)}/delete`;
    const body = new URLSearchParams({ paths: JSON.stringify(normalizedPaths) });
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new CrosspointError(`Could not delete files: ${err.message}`);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new CrosspointHttpError(`Could not delete files: HTTP ${response.status}${detail ? ` ${detail}` : ''}`, response.status);
    }
  }

  /** Best-effort removal of folders left empty by a deletion, never the managed root. */
  async pruneEmptyDirectories(host: string, httpPort: number, root: string, deletedPaths: string[]): Promise<void> {
    const candidates = new Set<string>();
    for (const path of deletedPaths) {
      for (const directory of ancestorDeviceDirectories(path, root)) candidates.add(directory);
    }

    const ordered = [...candidates].sort((a, b) => b.split('/').length - a.split('/').length || b.localeCompare(a, undefined, { numeric: true }));
    for (const directory of ordered) {
      try {
        const entries = await this.listFiles(host, httpPort, directory);
        if (entries.length === 0) await this.deletePaths(host, httpPort, [directory]);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.debug(
          `[crosspoint.prune] [fail] path="${sanitizeLogValue(directory)}" errorClass=${err.name} error="${sanitizeLogValue(err.message)}" - empty folder cleanup skipped`,
        );
      }
    }
  }

  async uploadFile(options: UploadOptions): Promise<void> {
    if (options.signal?.aborted) throw new CrosspointAbortError('Sync cancelled');
    const startedAt = Date.now();
    const directory = normalizeDevicePath(options.directory);
    if (!options.filename || options.filename.includes(':') || options.filename.includes('/') || options.filename.includes('\\')) {
      throw new CrosspointError('Invalid upload filename');
    }

    if ((options.filePath === undefined) === (options.contents === undefined)) {
      throw new CrosspointError('An upload needs either a file path or contents');
    }
    const fileSize = options.contents ? options.contents.length : (await stat(options.filePath!)).size;
    const socket = this.createSocket(crosspointWebSocketUrl(options.host, options.wsPort));
    socket.binaryType = 'arraybuffer';

    const pending: string[] = [];
    const waiters: MessageWaiter[] = [];
    let closed = false;
    let closeReason = '';
    let lastProgress: CrosspointUploadProgress | null = null;
    let aborted = false;

    const removeWaiter = (waiter: MessageWaiter) => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
    };

    const rejectWaiters = (error: Error) => {
      for (const waiter of [...waiters]) {
        removeWaiter(waiter);
        waiter.reject(error);
      }
    };

    const onMessage: EventListener = (event) => {
      const data = (event as Event & { data?: unknown }).data;
      if (typeof data !== 'string') return;
      const message = data;
      if (message.startsWith('PROGRESS:')) {
        const [, receivedRaw, totalRaw] = message.split(':');
        const sent = Number(receivedRaw);
        const total = Number(totalRaw);
        if (Number.isFinite(sent) && sent >= 0) {
          lastProgress = { sent, total: Number.isFinite(total) ? total : fileSize };
          this.reportProgress(options.onProgress, lastProgress);
        }
        return;
      }

      const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message));
      if (waiterIndex >= 0) {
        const waiter = waiters[waiterIndex]!;
        removeWaiter(waiter);
        waiter.resolve(message);
        return;
      }
      pending.push(message);
    };

    const onClose = () => {
      closed = true;
      closeReason = 'Reader closed the upload connection';
      rejectWaiters(new CrosspointSocketClosedError(closeReason));
    };

    const onError = () => {
      closed = true;
      closeReason = 'Reader upload connection failed';
      rejectWaiters(new CrosspointError(closeReason));
    };

    const onAbort = () => {
      aborted = true;
      try {
        socket.close();
      } catch {
        // The socket may already be closed.
      }
      rejectWaiters(new CrosspointAbortError('Sync cancelled'));
    };

    const waitFor = (predicate: (message: string) => boolean, description: string): Promise<string> => {
      const existingIndex = pending.findIndex(predicate);
      if (existingIndex >= 0) return Promise.resolve(pending.splice(existingIndex, 1)[0]!);
      if (aborted) return Promise.reject(new CrosspointAbortError('Sync cancelled'));
      if (closed) return Promise.reject(new CrosspointSocketClosedError(closeReason || 'Upload connection closed'));

      return new Promise<string>((resolve, reject) => {
        const waiter: MessageWaiter = {
          predicate,
          resolve,
          reject,
          timer: setTimeout(() => {
            removeWaiter(waiter);
            reject(new CrosspointTimeoutError(`Timed out waiting for ${description}`));
          }, MESSAGE_TIMEOUT_MS),
          signal: options.signal,
          onAbort,
        };
        options.signal?.addEventListener('abort', onAbort, { once: true });
        waiters.push(waiter);
      });
    };

    socket.addEventListener('message', onMessage);
    socket.addEventListener('close', onClose);
    socket.addEventListener('error', onError);
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      this.logger.debug(
        `[crosspoint.upload] [start] host="${sanitizeLogValue(options.host)}" path="${sanitizeLogValue(directory)}/${sanitizeLogValue(options.filename)}" bytes=${fileSize} - upload started`,
      );

      await this.openSocket(socket, options.signal);

      socket.send(`START:${options.filename}:${fileSize}:${directory}`);
      const ready = await waitFor((message) => message === 'READY' || message.startsWith('ERROR'), 'READY');
      if (ready.startsWith('ERROR')) {
        throw new CrosspointDeviceError(ready, ready.slice('ERROR:'.length).trim());
      }

      let sent = 0;
      const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
      if (options.contents) {
        for (let offset = 0; offset < options.contents.length; offset += chunkSize) {
          if (aborted || options.signal?.aborted) throw new CrosspointAbortError('Sync cancelled');
          if (closed) throw new CrosspointSocketClosedError(closeReason || 'Upload connection closed');
          const chunk = options.contents.subarray(offset, offset + chunkSize);
          socket.send(chunk);
          sent += chunk.length;
          this.reportProgress(options.onProgress, { sent, total: fileSize });
          await this.waitForDrain(socket, options.signal);
        }
      } else {
        const stream = createReadStream(options.filePath!, { highWaterMark: chunkSize });
        try {
          for await (const chunk of stream) {
            if (aborted || options.signal?.aborted) throw new CrosspointAbortError('Sync cancelled');
            if (closed) throw new CrosspointSocketClosedError(closeReason || 'Upload connection closed');
            socket.send(chunk as Buffer);
            sent += chunk.length;
            this.reportProgress(options.onProgress, { sent, total: fileSize });
            await this.waitForDrain(socket, options.signal);
          }
        } finally {
          stream.destroy();
        }
      }

      if (aborted || options.signal?.aborted) throw new CrosspointAbortError('Sync cancelled');
      this.reportProgress(options.onProgress, lastProgress ?? { sent, total: fileSize });

      const done = await waitFor((message) => message === 'DONE' || message.startsWith('ERROR'), 'DONE');
      if (done.startsWith('ERROR')) throw new CrosspointDeviceError(done, done.slice('ERROR:'.length).trim());

      this.logger.debug(
        `[crosspoint.upload] [end] host="${sanitizeLogValue(options.host)}" path="${sanitizeLogValue(directory)}/${sanitizeLogValue(options.filename)}" durationMs=${Date.now() - startedAt} bytes=${fileSize} - upload completed`,
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.debug(
        `[crosspoint.upload] [fail] host="${sanitizeLogValue(options.host)}" path="${sanitizeLogValue(options.filename)}" durationMs=${Date.now() - startedAt} errorClass=${err.name} error="${sanitizeLogValue(err.message)}" - upload failed`,
      );
      throw error;
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('close', onClose);
      socket.removeEventListener('error', onError);
      rejectWaiters(new CrosspointSocketClosedError('Upload connection closed'));
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    }
  }

  protected createSocket(url: string): Socket {
    return new WebSocket(url);
  }

  private parseFileEntry(entry: unknown, parentPath: string): CrosspointFileEntry[] {
    if (!entry || typeof entry !== 'object') return [];
    const data = entry as Record<string, unknown>;
    const name = typeof data.name === 'string' ? data.name : '';
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) return [];

    const isDirectory = data.isDirectory === true;
    const isEpub = data.isEpub === true || name.toLowerCase().endsWith('.epub');
    const size = typeof data.size === 'number' && Number.isFinite(data.size) && data.size >= 0 ? data.size : 0;
    const path = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`;
    return [{ path, name, size, isDirectory, isEpub }];
  }

  private async mkdir(host: string, httpPort: number, name: string, parent: string): Promise<void> {
    const url = `${crosspointHttpUrl(host, httpPort)}/mkdir`;
    const body = new URLSearchParams({ name, path: parent });
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(MKDIR_TIMEOUT_MS),
      redirect: 'error',
    });

    if (response.ok) return;
    if (response.status === 400) {
      const entries = await this.listFiles(host, httpPort, parent);
      if (entries.some((entry) => entry.isDirectory && entry.name === name)) return;
    }
    throw new CrosspointHttpError(`Could not create folder ${name} in ${parent}: HTTP ${response.status}`, response.status);
  }

  private openSocket(socket: Socket, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new CrosspointTimeoutError('Timed out connecting to the reader'));
      }, CONNECT_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
        socket.removeEventListener('close', onCloseBeforeOpen);
        signal?.removeEventListener('abort', onAbort);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new CrosspointError('Could not connect to the reader'));
      };
      const onCloseBeforeOpen = () => {
        cleanup();
        reject(new CrosspointSocketClosedError('Reader closed the connection'));
      };
      const onAbort = () => {
        cleanup();
        try {
          socket.close();
        } catch {
          // Already closed.
        }
        reject(new CrosspointAbortError('Sync cancelled'));
      };

      socket.addEventListener('open', onOpen, { once: true });
      socket.addEventListener('error', onError, { once: true });
      socket.addEventListener('close', onCloseBeforeOpen, { once: true });
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async waitForDrain(socket: Socket, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + DRAIN_TIMEOUT_MS;
    while (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      if (signal?.aborted) throw new CrosspointAbortError('Sync cancelled');
      if (Date.now() > deadline) throw new CrosspointTimeoutError('Timed out waiting for the reader to accept data');
      await delay(5);
    }
  }

  private reportProgress(callback: ((progress: CrosspointUploadProgress) => void) | undefined, progress: CrosspointUploadProgress) {
    if (!callback) return;
    try {
      callback(progress);
    } catch {
      // Progress reporting must never fail an upload.
    }
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
