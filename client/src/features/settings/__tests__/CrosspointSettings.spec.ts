import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type {
  CrosspointDeviceInfo,
  CrosspointDiscoveredDevice,
  CrosspointProbeResult,
  CrosspointSyncPreview,
  CrosspointSyncRun,
  CrosspointSyncStatus,
} from '@bookorbit/types'

import { i18n } from '@/i18n'

const route = { query: { tab: 'devices' as string } }
const routerReplace = vi.fn<() => Promise<void>>()
const devices = ref<CrosspointDeviceInfo[]>([])
const statusByDevice = ref<Record<number, unknown>>({})
const runs = ref<CrosspointSyncRun[]>([])

const fetchDevices = vi.fn<() => Promise<void>>()
const createDevice = vi.fn<(payload: unknown) => Promise<CrosspointDeviceInfo>>()
const deleteDevice = vi.fn<(id: number) => Promise<void>>()
const discover = vi.fn<() => Promise<CrosspointDiscoveredDevice[]>>()
const probeAddress = vi.fn<(payload: unknown) => Promise<CrosspointProbeResult>>()
const previewSync = vi.fn<(deviceId: number) => Promise<CrosspointSyncPreview>>()
const startSync = vi.fn<(deviceId: number) => Promise<number>>()
const fetchStatus = vi.fn<(deviceId: number) => Promise<CrosspointSyncStatus>>()
const cancelSync = vi.fn<(deviceId: number) => Promise<void>>()
const fetchRuns = vi.fn<() => Promise<CrosspointSyncRun[]>>()
const clearRuns = vi.fn<() => void>()
const fetchCollections = vi.fn<() => Promise<void>>()
const fetchSmartScopes = vi.fn<() => Promise<void>>()
const { toastSuccess, toastError, toastInfo, toastWarning } = vi.hoisted(() => ({
  toastSuccess: vi.fn<(...args: unknown[]) => void>(),
  toastError: vi.fn<(...args: unknown[]) => void>(),
  toastInfo: vi.fn<(...args: unknown[]) => void>(),
  toastWarning: vi.fn<(...args: unknown[]) => void>(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ replace: routerReplace }),
}))

vi.mock('@/features/crosspoint/composables/useCrosspointDevices', () => ({
  useCrosspointDevices: () => ({
    devices,
    loading: ref(false),
    error: ref(null),
    fetchDevices,
    createDevice,
    deleteDevice,
    discover,
    probeAddress,
  }),
}))

vi.mock('@/features/crosspoint/composables/useCrosspointSync', () => ({
  useCrosspointSync: () => ({
    statusByDevice,
    runs,
    runsLoading: ref(false),
    previewSync,
    startSync,
    fetchStatus,
    cancelSync,
    fetchRuns,
    clearRuns,
  }),
}))

vi.mock('@/features/collection/composables/useCollections', () => ({
  useCollections: () => ({ collections: ref([]), loading: ref(false), fetchCollections }),
}))

vi.mock('@/features/smart-scope/composables/useSmartScopes', () => ({
  useSmartScopes: () => ({ smartScopes: ref([]), loading: ref(false), fetchSmartScopes }),
}))

vi.mock('vue-sonner', () => ({
  toast: { success: toastSuccess, error: toastError, info: toastInfo, warning: toastWarning },
}))

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

function makeRun(): CrosspointSyncRun {
  return {
    id: 5,
    deviceId: 1,
    status: 'completed',
    totalBooks: 4,
    uploaded: 2,
    skipped: 1,
    deleted: 1,
    failed: 0,
    totalBytes: 4_000,
    transferredBytes: 2_000,
    errorClass: null,
    error: null,
    failures: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:05.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('CrosspointSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    route.query = { tab: 'devices' }
    devices.value = [makeDevice()]
    statusByDevice.value = {}
    runs.value = []
    fetchDevices.mockResolvedValue(undefined)
    fetchStatus.mockResolvedValue({ run: null, currentBook: null })
    fetchRuns.mockResolvedValue([])
    fetchCollections.mockResolvedValue(undefined)
    fetchSmartScopes.mockResolvedValue(undefined)
    discover.mockResolvedValue([])
    createDevice.mockResolvedValue(makeDevice({ id: 2, name: 'New reader' }))
  })

  async function mountPage() {
    const { default: CrosspointSettings } = await import('../CrosspointSettings.vue')
    return mount(CrosspointSettings, {
      global: {
        plugins: [i18n],
        stubs: { CrosspointDeviceEditor: true, ConfirmDialog: true },
      },
    })
  }

  it('renders registered readers and loads them on mount', async () => {
    const wrapper = await mountPage()
    await flushPromises()

    expect(fetchDevices).toHaveBeenCalledWith(true)
    expect(fetchStatus).toHaveBeenCalledWith(1)
    expect(wrapper.text()).toContain('Bedroom reader')
    expect(wrapper.text()).toContain('Add reader')
  })

  it('opens the add form and reports an empty network scan', async () => {
    const wrapper = await mountPage()
    await flushPromises()

    const add = wrapper.findAll('button').find((button) => button.text().includes('Add reader'))
    await add!.trigger('click')
    expect(wrapper.find('#crosspoint-new-name').exists()).toBe(true)

    const scan = wrapper.findAll('button').find((button) => button.text().includes('Scan network'))
    await scan!.trigger('click')
    await flushPromises()

    expect(discover).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('No CrossPoint readers answered')
  })

  it('creates a reader from the add form', async () => {
    const wrapper = await mountPage()
    await flushPromises()

    const add = wrapper.findAll('button').find((button) => button.text().includes('Add reader'))
    await add!.trigger('click')
    await wrapper.find('#crosspoint-new-name').setValue('New reader')
    await wrapper.find('#crosspoint-new-host').setValue('192.168.1.60')

    const create = wrapper
      .findAll('button')
      .filter((button) => button.text().includes('Add reader'))
      .at(-1)
    await create!.trigger('click')
    await flushPromises()

    expect(createDevice).toHaveBeenCalledWith(expect.objectContaining({ name: 'New reader', host: '192.168.1.60', removeMissing: false }))
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('loads activity when the tab opens', async () => {
    route.query = { tab: 'activity' }
    runs.value = [makeRun()]

    const wrapper = await mountPage()
    await flushPromises()

    expect(fetchRuns).toHaveBeenCalledWith(1)
    expect(wrapper.text()).toContain('Completed')
    expect(wrapper.text()).toContain('2 uploaded')
  })
})
