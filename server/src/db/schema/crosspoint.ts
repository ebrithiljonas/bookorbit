import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import type { CrosspointDeviceModel, CrosspointSelectionMode, CrosspointSyncFailure, CrosspointSyncRunStatus } from '@bookorbit/types';

import { users } from './auth';
import { bookFiles, books } from './books';
import { collections } from './collections';
import { libraries } from './libraries';
import { bookmarks } from './reader';
import { smartScopes } from './smart-scopes';

export const crosspointDevices = pgTable(
  'crosspoint_devices',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    host: varchar('host', { length: 255 }).notNull(),
    wsPort: integer('ws_port').notNull().default(81),
    httpPort: integer('http_port').notNull().default(80),
    deviceId: varchar('device_id', { length: 64 }),
    deviceModel: varchar('device_model', { length: 8 }).$type<CrosspointDeviceModel>(),
    firmwareVersion: varchar('firmware_version', { length: 64 }),
    rootFolder: varchar('root_folder', { length: 512 }).notNull().default('/BookOrbit'),
    fileNamingPattern: text('file_naming_pattern').notNull().default('{library}/<{authors:first}|Unknown Author>/<{series}/>{originalFilename}'),
    syncToken: varchar('sync_token', { length: 32 })
      .notNull()
      .default(sql`replace(gen_random_uuid()::text, '-', '')`),
    selectionMode: varchar('selection_mode', { length: 16 }).notNull().default('all').$type<CrosspointSelectionMode>(),
    removeMissing: boolean('remove_missing').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('crosspoint_devices_user_id_idx').on(t.userId),
    uniqueIndex('crosspoint_devices_sync_token_uidx').on(t.syncToken),
    uniqueIndex('crosspoint_devices_user_device_id_uidx')
      .on(t.userId, t.deviceId)
      .where(sql`${t.deviceId} is not null`),
    uniqueIndex('crosspoint_devices_user_host_port_uidx').on(t.userId, t.host, t.wsPort),
    unique('crosspoint_devices_id_user_id_unique').on(t.id, t.userId),
    check('crosspoint_devices_selection_mode_chk', sql`${t.selectionMode} in ('all', 'libraries', 'selected')`),
    check('crosspoint_devices_ws_port_chk', sql`${t.wsPort} >= 1 and ${t.wsPort} <= 65535`),
    check('crosspoint_devices_http_port_chk', sql`${t.httpPort} >= 1 and ${t.httpPort} <= 65535`),
  ],
);

export type CrosspointDeviceRow = typeof crosspointDevices.$inferSelect;
export type NewCrosspointDeviceRow = typeof crosspointDevices.$inferInsert;

export const crosspointDeviceCollections = pgTable(
  'crosspoint_device_collections',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: integer('device_id').notNull(),
    collectionId: integer('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.collectionId] }),
    foreignKey({
      columns: [t.deviceId, t.userId],
      foreignColumns: [crosspointDevices.id, crosspointDevices.userId],
      name: 'crosspoint_device_collections_owner_fk',
    }).onDelete('cascade'),
    index('crosspoint_device_collections_user_id_idx').on(t.userId),
    index('crosspoint_device_collections_collection_id_idx').on(t.collectionId),
  ],
);

export const crosspointDeviceLibraries = pgTable(
  'crosspoint_device_libraries',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: integer('device_id').notNull(),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.libraryId] }),
    foreignKey({
      columns: [t.deviceId, t.userId],
      foreignColumns: [crosspointDevices.id, crosspointDevices.userId],
      name: 'crosspoint_device_libraries_owner_fk',
    }).onDelete('cascade'),
    index('crosspoint_device_libraries_user_id_idx').on(t.userId),
    index('crosspoint_device_libraries_library_id_idx').on(t.libraryId),
  ],
);

export const crosspointDeviceSmartScopes = pgTable(
  'crosspoint_device_smart_scopes',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: integer('device_id').notNull(),
    smartScopeId: integer('smart_scope_id')
      .notNull()
      .references(() => smartScopes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.smartScopeId] }),
    foreignKey({
      columns: [t.deviceId, t.userId],
      foreignColumns: [crosspointDevices.id, crosspointDevices.userId],
      name: 'crosspoint_device_smart_scopes_owner_fk',
    }).onDelete('cascade'),
    index('crosspoint_device_smart_scopes_user_id_idx').on(t.userId),
    index('crosspoint_device_smart_scopes_smart_scope_id_idx').on(t.smartScopeId),
  ],
);

export const crosspointDeviceDocuments = pgTable(
  'crosspoint_device_documents',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: integer('device_id').notNull(),
    documentHash: varchar('document_hash', { length: 64 }).notNull(),
    bookFileId: integer('book_file_id')
      .notNull()
      .references(() => bookFiles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.documentHash] }),
    foreignKey({
      columns: [t.deviceId, t.userId],
      foreignColumns: [crosspointDevices.id, crosspointDevices.userId],
      name: 'crosspoint_device_documents_owner_fk',
    }).onDelete('cascade'),
    index('crosspoint_device_documents_user_id_idx').on(t.userId),
    index('crosspoint_device_documents_book_file_id_idx').on(t.bookFileId),
  ],
);

export const crosspointBookmarkLinks = pgTable(
  'crosspoint_bookmark_links',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: integer('device_id').notNull(),
    crosspointId: varchar('crosspoint_id', { length: 32 }).notNull(),
    bookmarkId: integer('bookmark_id')
      .notNull()
      .references(() => bookmarks.id, { onDelete: 'cascade' }),
    xpath: text('xpath').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.crosspointId] }),
    foreignKey({
      columns: [t.deviceId, t.userId],
      foreignColumns: [crosspointDevices.id, crosspointDevices.userId],
      name: 'crosspoint_bookmark_links_owner_fk',
    }).onDelete('cascade'),
    index('crosspoint_bookmark_links_user_id_idx').on(t.userId),
    index('crosspoint_bookmark_links_bookmark_id_idx').on(t.bookmarkId),
  ],
);

export const crosspointDeviceBooks = pgTable(
  'crosspoint_device_books',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: integer('device_id').notNull(),
    bookId: integer('book_id').references(() => books.id, { onDelete: 'set null' }),
    fileId: integer('file_id').references(() => bookFiles.id, { onDelete: 'set null' }),
    remotePath: varchar('remote_path', { length: 2048 }).notNull(),
    remoteFilenameHash: varchar('remote_filename_hash', { length: 32 }).generatedAlwaysAs(sql`md5(regexp_replace(remote_path, '^.*/', ''))`),
    fileHash: varchar('file_hash', { length: 32 }),
    fileSize: bigint('file_size', { mode: 'number' }),
    lastSeenRunId: integer('last_seen_run_id'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    foreignKey({
      columns: [t.deviceId, t.userId],
      foreignColumns: [crosspointDevices.id, crosspointDevices.userId],
      name: 'crosspoint_device_books_owner_fk',
    }).onDelete('cascade'),
    uniqueIndex('crosspoint_device_books_device_book_uidx')
      .on(t.deviceId, t.bookId)
      .where(sql`${t.bookId} is not null`),
    uniqueIndex('crosspoint_device_books_device_path_uidx').on(t.deviceId, t.remotePath),
    index('crosspoint_device_books_user_device_idx').on(t.userId, t.deviceId),
    index('crosspoint_device_books_device_filename_hash_idx').on(t.deviceId, t.remoteFilenameHash),
    index('crosspoint_device_books_book_id_idx').on(t.bookId),
    index('crosspoint_device_books_last_seen_run_idx').on(t.deviceId, t.lastSeenRunId),
    check('crosspoint_device_books_file_size_nonnegative_chk', sql`${t.fileSize} is null or ${t.fileSize} >= 0`),
  ],
);

export type CrosspointDeviceBookRow = typeof crosspointDeviceBooks.$inferSelect;
export type NewCrosspointDeviceBookRow = typeof crosspointDeviceBooks.$inferInsert;

export const crosspointSyncRuns = pgTable(
  'crosspoint_sync_runs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: integer('device_id').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('running').$type<CrosspointSyncRunStatus>(),
    totalBooks: integer('total_books').notNull().default(0),
    uploaded: integer('uploaded').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    deleted: integer('deleted').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    totalBytes: bigint('total_bytes', { mode: 'number' }),
    transferredBytes: bigint('transferred_bytes', { mode: 'number' }).notNull().default(0),
    errorClass: varchar('error_class', { length: 128 }),
    error: varchar('error', { length: 1000 }),
    failures: jsonb('failures').$type<CrosspointSyncFailure[]>().notNull().default([]),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.deviceId, t.userId],
      foreignColumns: [crosspointDevices.id, crosspointDevices.userId],
      name: 'crosspoint_sync_runs_owner_fk',
    }).onDelete('cascade'),
    index('crosspoint_sync_runs_user_started_idx').on(t.userId, sql`${t.startedAt} desc`),
    index('crosspoint_sync_runs_device_started_idx').on(t.deviceId, sql`${t.startedAt} desc`),
    check('crosspoint_sync_runs_status_chk', sql`${t.status} in ('running', 'completed', 'failed', 'cancelled', 'interrupted')`),
    check(
      'crosspoint_sync_runs_counts_nonnegative_chk',
      sql`${t.totalBooks} >= 0 and ${t.uploaded} >= 0 and ${t.skipped} >= 0 and ${t.deleted} >= 0 and ${t.failed} >= 0 and ${t.transferredBytes} >= 0`,
    ),
    check('crosspoint_sync_runs_total_bytes_nonnegative_chk', sql`${t.totalBytes} is null or ${t.totalBytes} >= 0`),
  ],
);

export type CrosspointSyncRunRow = typeof crosspointSyncRuns.$inferSelect;
export type NewCrosspointSyncRunRow = typeof crosspointSyncRuns.$inferInsert;
