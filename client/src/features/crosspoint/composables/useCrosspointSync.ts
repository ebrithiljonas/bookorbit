import { ref } from 'vue'
import type { CrosspointSyncPreview, CrosspointSyncRun, CrosspointSyncStartResponse, CrosspointSyncStatus } from '@bookorbit/types'

import { apiJson, apiSend, errorMessage } from '@/lib/api-json'

const statusByDevice = ref<Record<number, CrosspointSyncStatus>>({})
const runs = ref<CrosspointSyncRun[]>([])
const preview = ref<CrosspointSyncPreview | null>(null)
const loading = ref(false)
const runsLoading = ref(false)
const error = ref<string | null>(null)

export function useCrosspointSync() {
  async function previewSync(deviceId: number): Promise<CrosspointSyncPreview> {
    loading.value = true
    error.value = null
    try {
      const result = await apiJson<CrosspointSyncPreview>(
        `/api/v1/crosspoint/devices/${deviceId}/sync/preview`,
        undefined,
        'settings.reader.crosspoint.previewFailed',
      )
      preview.value = result
      return result
    } catch (reason) {
      error.value = errorMessage(reason, 'settings.reader.crosspoint.previewFailed')
      throw reason
    } finally {
      loading.value = false
    }
  }

  async function startSync(deviceId: number): Promise<number> {
    const result = await apiJson<CrosspointSyncStartResponse>(
      `/api/v1/crosspoint/devices/${deviceId}/sync`,
      { method: 'POST' },
      'settings.reader.crosspoint.startFailed',
    )
    return result.runId
  }

  async function fetchStatus(deviceId: number): Promise<CrosspointSyncStatus> {
    const status = await apiJson<CrosspointSyncStatus>(
      `/api/v1/crosspoint/devices/${deviceId}/sync`,
      undefined,
      'settings.reader.crosspoint.statusFailed',
    )
    statusByDevice.value = { ...statusByDevice.value, [deviceId]: status }
    return status
  }

  async function cancelSync(deviceId: number): Promise<void> {
    await apiSend(`/api/v1/crosspoint/devices/${deviceId}/sync/cancel`, { method: 'POST' }, 'settings.reader.crosspoint.cancelFailed')
  }

  async function fetchRuns(deviceId: number, limit = 20): Promise<CrosspointSyncRun[]> {
    runsLoading.value = true
    try {
      runs.value = await apiJson<CrosspointSyncRun[]>(
        `/api/v1/crosspoint/devices/${deviceId}/runs?limit=${limit}`,
        undefined,
        'settings.reader.crosspoint.activity.loadFailed',
      )
      return runs.value
    } finally {
      runsLoading.value = false
    }
  }

  function clearRuns(): void {
    runs.value = []
  }

  return {
    statusByDevice,
    runs,
    preview,
    loading,
    runsLoading,
    error,
    previewSync,
    startSync,
    fetchStatus,
    cancelSync,
    fetchRuns,
    clearRuns,
  }
}
