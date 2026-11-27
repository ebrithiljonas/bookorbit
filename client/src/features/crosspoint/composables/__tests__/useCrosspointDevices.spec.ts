import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrosspointDeviceInfo } from '@bookorbit/types'

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

function makeDevice(overrides: Partial<CrosspointDeviceInfo> = {}): CrosspointDeviceInfo {
  return {
    id: 1,
    name: 'Bedroom reader',
    host: '192.168.1.50',
    wsPort: 81,
    httpPort: 80,
    deviceId: 'a'.repeat(64),
    deviceModel: 'X4',
    firmwareVersion: '1.0.0',
    rootFolder: '/BookOrbit',
    fileNamingPattern: '<{authors:first} - >{title}',
    removeMissing: false,
    selection: { mode: 'all', collectionIds: [], smartScopeIds: [] },
    lastSeenAt: null,
    lastSyncAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('useCrosspointDevices', () => {
  beforeEach(() => {
    vi.resetModules()
    apiMock.mockReset()
  })

  it('loads and deduplicates concurrent device fetches', async () => {
    apiMock.mockResolvedValueOnce(makeResponse([makeDevice()]))
    const { useCrosspointDevices } = await import('../useCrosspointDevices')
    const { devices, fetchDevices } = useCrosspointDevices()

    await Promise.all([fetchDevices(), fetchDevices()])

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(devices.value).toEqual([makeDevice()])
  })

  it('creates, updates and removes a reader in local state', async () => {
    apiMock
      .mockResolvedValueOnce(makeResponse(makeDevice({ id: 2, name: 'New reader' })))
      .mockResolvedValueOnce(makeResponse(makeDevice({ id: 2, name: 'Renamed reader' })))
      .mockResolvedValueOnce(makeResponse({}))
    const { useCrosspointDevices } = await import('../useCrosspointDevices')
    const { devices, createDevice, updateDevice, deleteDevice } = useCrosspointDevices()

    await createDevice({ name: 'New reader', host: '192.168.1.50' })
    expect(devices.value).toEqual([makeDevice({ id: 2, name: 'New reader' })])

    await updateDevice(2, { name: 'Renamed reader' })
    expect(devices.value).toEqual([makeDevice({ id: 2, name: 'Renamed reader' })])

    await deleteDevice(2)
    expect(devices.value).toEqual([])
    expect(apiMock).toHaveBeenLastCalledWith('/api/v1/crosspoint/devices/2', { method: 'DELETE' })
  })

  it('returns discovery and probe results', async () => {
    apiMock
      .mockResolvedValueOnce(makeResponse([{ host: '192.168.1.50', wsPort: 81, httpPort: 80, reachable: true }]))
      .mockResolvedValueOnce(makeResponse({ reachable: true, isCrosspoint: true }))
    const { useCrosspointDevices } = await import('../useCrosspointDevices')
    const { discover, probeAddress } = useCrosspointDevices()

    await expect(discover()).resolves.toEqual([{ host: '192.168.1.50', wsPort: 81, httpPort: 80, reachable: true }])
    await expect(probeAddress({ host: '192.168.1.50' })).resolves.toMatchObject({ reachable: true, isCrosspoint: true })
  })

  it('records a localized load failure', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'nope' }, { ok: false, status: 500 }))
    const { useCrosspointDevices } = await import('../useCrosspointDevices')
    const { error, fetchDevices } = useCrosspointDevices()

    await fetchDevices()

    expect(error.value).toBeTruthy()
  })
})
