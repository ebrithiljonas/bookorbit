import { BadRequestException } from '@nestjs/common';
import { sanitizePathSegment, validatePattern } from '@bookorbit/types';

export const MAX_CROSSPOINT_ROOT_FOLDER_LENGTH = 512;

/**
 * Keeps the managed folder inside the device filesystem. Segments are sanitized for the SD
 * card's FAT-compatible names, and traversal components are refused rather than rewritten so a
 * mistake is visible in the settings form.
 */
export function normalizeCrosspointRootFolder(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new BadRequestException('Root folder is required');
  if (!trimmed.startsWith('/')) throw new BadRequestException('Root folder must start with /');

  const rawSegments = trimmed.split('/').filter((segment) => segment.length > 0);
  if (rawSegments.some((segment) => segment === '.' || segment === '..')) {
    throw new BadRequestException('Root folder cannot contain . or .. segments');
  }

  const segments = rawSegments.map((segment) => sanitizePathSegment(segment, '_'));
  const normalized = segments.length === 0 ? '/' : `/${segments.join('/')}`;
  if (normalized.length > MAX_CROSSPOINT_ROOT_FOLDER_LENGTH) {
    throw new BadRequestException(`Root folder must be at most ${MAX_CROSSPOINT_ROOT_FOLDER_LENGTH} characters`);
  }
  return normalized;
}

/** The pattern is always relative to the managed root folder, so it cannot escape it. */
export function normalizeCrosspointFileNamingPattern(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new BadRequestException('File naming pattern is required');
  if (trimmed.startsWith('/')) throw new BadRequestException('File naming pattern must be relative to the root folder');
  if (trimmed.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new BadRequestException('File naming pattern cannot contain . or .. segments');
  }
  if (!validatePattern(trimmed)) throw new BadRequestException('File naming pattern contains unsupported characters');
  return trimmed;
}

/** Builds the HTTP base used by the reader's status and file endpoints. */
export function crosspointHttpUrl(host: string, httpPort: number): string {
  const trimmed = host.trim();
  const bracketed = trimmed.includes(':') && !trimmed.startsWith('[') ? `[${trimmed}]` : trimmed;
  return `http://${bracketed}:${httpPort}`;
}

/** Builds the WebSocket upload URL. */
export function crosspointWebSocketUrl(host: string, wsPort: number): string {
  const trimmed = host.trim();
  const bracketed = trimmed.includes(':') && !trimmed.startsWith('[') ? `[${trimmed}]` : trimmed;
  return `ws://${bracketed}:${wsPort}/`;
}

/** Normalizes a path on the reader's SD card to a leading-slash, no-trailing-slash form. */
export function normalizeDevicePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '/';
  const parts = trimmed
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part.length > 0);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new BadRequestException('Device path cannot contain . or .. segments');
  }
  return parts.length === 0 ? '/' : `/${parts.join('/')}`;
}

/** Joins a managed root folder with the relative path produced by the naming pattern. */
export function joinDevicePath(root: string, relative: string): string {
  const normalizedRoot = normalizeDevicePath(root);
  const normalizedRelative = relative.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizedRelative) return normalizedRoot;
  return normalizeDevicePath(normalizedRoot === '/' ? `/${normalizedRelative}` : `${normalizedRoot}/${normalizedRelative}`);
}

export function deviceDirname(path: string): string {
  const normalized = normalizeDevicePath(path);
  if (normalized === '/') return '/';
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '/' : normalized.slice(0, index);
}

export function deviceBasename(path: string): string {
  const normalized = normalizeDevicePath(path);
  return normalized === '/' ? '' : normalized.slice(normalized.lastIndexOf('/') + 1);
}

export function isPathInsideDevicePath(path: string, root: string): boolean {
  const normalizedPath = normalizeDevicePath(path);
  const normalizedRoot = normalizeDevicePath(root);
  if (normalizedRoot === '/') return true;
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

/** Empty directories that would become orphaned by a deletion, deepest first. Never includes the root. */
export function ancestorDeviceDirectories(path: string, root: string): string[] {
  const normalizedRoot = normalizeDevicePath(root);
  const directories: string[] = [];
  let current = deviceDirname(path);
  while (current !== normalizedRoot && isPathInsideDevicePath(current, normalizedRoot)) {
    directories.push(current);
    const parent = deviceDirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories;
}
