import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrosspointSyncPreview, CrosspointSyncRun, CrosspointSyncStatus } from '@bookorbit/types'

const { apiMock, MockNetworkError } = vi.hoisted(() => ({
  apiMock: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  MockNetworkError: class extends Error {},
}))

vi.mock('@/lib/api', () => ({
  api: apiMock,
  NetworkError: MockNetworkError,
}))

function makeResponse(data: unknown, options: { ok?: boolean; status?: number } = {}): Response {
  const { ok = true, status = ok ? 200 : 500 } = options
  return {
    ok,
    status,
    json: async () => data,
  } as Response
}

function makePreview(overrides: Partial<CrosspointSyncPreview> = {}): CrosspointSyncPreview {
  return {
    totalBooks: 4,
    totalBytes: 4_000,
    newBooks: 2,
    changedBooks: 1,
    unchangedBooks: 1,
    removedBooks: 0,
    uploadBytes: 3_000,
    ...overrides,
  }
}

function makeRun(overrides: Partial<CrosspointSyncRun> = {}): CrosspointSyncRun {
  return {
    id: 5,
    deviceId: 1,
    status: 'running',
    totalBooks: 4,
    uploaded: 1,
    skipped: 0,
    deleted: 0,
    failed: 0,
    totalBytes: 4_000,
    transferredBytes: 1_000,
    errorClass: null,
    error: null,
    failures: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeStatus(overrides: Partial<CrosspointSyncStatus> = {}): CrosspointSyncStatus {
  return {
    run: makeRun(),
    currentBook: { id: 9, title: 'Dune', bytes: 1_000, transferred: 400 },
    ...overrides,
  }
}

describe('useCrosspointSync', () => {
  beforeEach(() => {
    vi.resetModules()
    apiMock.mockReset()
  })

  it('previews, starts and records status for a device', async () => {
    apiMock
      .mockResolvedValueOnce(makeResponse(makePreview()))
      .mockResolvedValueOnce(makeResponse({ runId: 5 }))
      .mockResolvedValueOnce(makeResponse(makeStatus()))
    const { useCrosspointSync } = await import('../useCrosspointSync')
    const { preview, statusByDevice, previewSync, startSync, fetchStatus } = useCrosspointSync()

    await expect(previewSync(1)).resolves.toEqual(makePreview())
    expect(preview.value).toEqual(makePreview())
    await expect(startSync(1)).resolves.toBe(5)
    await expect(fetchStatus(1)).resolves.toEqual(makeStatus())
    expect(statusByDevice.value[1]).toEqual(makeStatus())
  })

  it('cancels and lists runs', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({})).mockResolvedValueOnce(makeResponse([makeRun({ status: 'completed' })]))
    const { useCrosspointSync } = await import('../useCrosspointSync')
    const { runs, cancelSync, fetchRuns, clearRuns } = useCrosspointSync()

    await cancelSync(1)
    await expect(fetchRuns(1, 10)).resolves.toEqual([makeRun({ status: 'completed' })])
    expect(runs.value).toHaveLength(1)
    clearRuns()
    expect(runs.value).toEqual([])
  })

  it('records a localized preview failure', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'offline' }, { ok: false, status: 500 }))
    const { useCrosspointSync } = await import('../useCrosspointSync')
    const { error, previewSync } = useCrosspointSync()

    await expect(previewSync(1)).rejects.toBeTruthy()
    expect(error.value).toBeTruthy()
  })
})
