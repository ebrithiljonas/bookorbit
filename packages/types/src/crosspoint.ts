export const CROSSPOINT_SELECTION_MODES = ["all", "libraries", "selected"] as const;
export type CrosspointSelectionMode = (typeof CROSSPOINT_SELECTION_MODES)[number];

export const CROSSPOINT_DEVICE_MODELS = ["X3", "X4"] as const;
export type CrosspointDeviceModel = (typeof CROSSPOINT_DEVICE_MODELS)[number];

export const CROSSPOINT_SYNC_RUN_STATUSES = ["running", "completed", "failed", "cancelled", "interrupted"] as const;
export type CrosspointSyncRunStatus = (typeof CROSSPOINT_SYNC_RUN_STATUSES)[number];

export const CROSSPOINT_DEFAULT_ROOT_FOLDER = "/BookOrbit";
export const CROSSPOINT_DEFAULT_FILE_NAMING_PATTERN = "{library}/<{authors:first}|Unknown Author>/<{series}/>{originalFilename}";
export const CROSSPOINT_DEFAULT_WS_PORT = 81;
export const CROSSPOINT_DEFAULT_HTTP_PORT = 80;

/** Which books a reader receives: everything, chosen libraries, or chosen collections and smart scopes. */
export interface CrosspointSelection {
  mode: CrosspointSelectionMode;
  libraryIds: number[];
  collectionIds: number[];
  smartScopeIds: number[];
}

export interface CrosspointDeviceInfo {
  id: number;
  name: string;
  host: string;
  wsPort: number;
  httpPort: number;
  /** Stable id the firmware derives from its NVS secret and the `bookorbit` plugin name. */
  deviceId: string | null;
  deviceModel: CrosspointDeviceModel | null;
  firmwareVersion: string | null;
  rootFolder: string;
  fileNamingPattern: string;
  removeMissing: boolean;
  selection: CrosspointSelection;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Returned only when an endpoint is created or rotated, so the URL is not exposed in device lists. */
export interface CrosspointDeviceSetup extends CrosspointDeviceInfo {
  syncToken: string;
}

/** Rich position the CrossPoint firmware sends alongside a progress update. */
export interface CrosspointRichPosition {
  pctQ?: number;
  spine?: number;
  page?: number;
  pages?: number;
  para?: number;
  li?: number;
  anchor?: string;
  xpath?: string;
}

export interface CrosspointProbeResult {
  reachable: boolean;
  isCrosspoint: boolean;
  deviceId: string | null;
  deviceModel: CrosspointDeviceModel | null;
  firmwareVersion: string | null;
  mode: string | null;
  ip: string | null;
  error: string | null;
}

export interface CrosspointFileEntry {
  path: string;
  name: string;
  size: number;
  isDirectory: boolean;
  isEpub: boolean;
}

export interface CrosspointUploadProgress {
  sent: number;
  total: number;
}

export interface ProbeCrosspointDeviceRequest {
  host: string;
  wsPort?: number;
  httpPort?: number;
}

export interface CreateCrosspointDeviceRequest extends ProbeCrosspointDeviceRequest {
  name: string;
  rootFolder?: string;
  fileNamingPattern?: string;
  removeMissing?: boolean;
  selection?: CrosspointSelection;
}

export interface UpdateCrosspointDeviceRequest {
  name?: string;
  host?: string;
  wsPort?: number;
  httpPort?: number;
  rootFolder?: string;
  fileNamingPattern?: string;
  removeMissing?: boolean;
  selection?: CrosspointSelection;
}

export interface CrosspointSyncFailure {
  bookId: number;
  title: string | null;
  remotePath: string | null;
  errorClass: string;
  error: string;
}

export interface CrosspointSyncPreview {
  totalBooks: number;
  totalBytes: number;
  newBooks: number;
  changedBooks: number;
  unchangedBooks: number;
  removedBooks: number;
  uploadBytes: number;
}

export interface CrosspointSyncCurrentBook {
  id: number;
  title: string | null;
  bytes: number;
  transferred: number;
}

export interface CrosspointSyncStatus {
  run: CrosspointSyncRun | null;
  currentBook: CrosspointSyncCurrentBook | null;
}

export interface CrosspointSyncStartResponse {
  runId: number;
}

export interface CrosspointSyncRun {
  id: number;
  deviceId: number;
  status: CrosspointSyncRunStatus;
  totalBooks: number;
  uploaded: number;
  skipped: number;
  deleted: number;
  failed: number;
  totalBytes: number | null;
  transferredBytes: number;
  errorClass: string | null;
  error: string | null;
  failures: CrosspointSyncFailure[];
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
}
