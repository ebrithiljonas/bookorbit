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
