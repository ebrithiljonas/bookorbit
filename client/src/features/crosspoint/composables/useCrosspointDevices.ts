import { ref } from 'vue'
import type {
  CreateCrosspointDeviceRequest,
  CrosspointDeviceInfo,
  CrosspointProbeResult,
  ProbeCrosspointDeviceRequest,
  UpdateCrosspointDeviceRequest,
} from '@bookorbit/types'

import { apiJson, apiSend, errorMessage, jsonBody } from '@/lib/api-json'

const devices = ref<CrosspointDeviceInfo[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
let fetchPromise: Promise<void> | null = null

export function useCrosspointDevices() {
  async function fetchDevices(force = false): Promise<void> {
    if (fetchPromise) return fetchPromise
    if (!force && devices.value.length > 0) return

    loading.value = true
    error.value = null
    fetchPromise = apiJson<CrosspointDeviceInfo[]>('/api/v1/crosspoint/devices', undefined, 'settings.reader.crosspoint.loadFailed')
      .then((rows) => {
        devices.value = rows
      })
      .catch((reason: unknown) => {
        error.value = errorMessage(reason, 'settings.reader.crosspoint.loadFailed')
      })
      .finally(() => {
        loading.value = false
        fetchPromise = null
      })
    return fetchPromise
  }

  async function createDevice(payload: CreateCrosspointDeviceRequest): Promise<CrosspointDeviceInfo> {
    const created = await apiJson<CrosspointDeviceInfo>(
      '/api/v1/crosspoint/devices',
      jsonBody('POST', payload),
      'settings.reader.crosspoint.createDeviceFailed',
    )
    devices.value = [...devices.value, created]
    return created
  }

  async function updateDevice(id: number, payload: UpdateCrosspointDeviceRequest): Promise<CrosspointDeviceInfo> {
    const updated = await apiJson<CrosspointDeviceInfo>(
      `/api/v1/crosspoint/devices/${id}`,
      jsonBody('PATCH', payload),
      'settings.reader.crosspoint.updateDeviceFailed',
    )
    devices.value = devices.value.map((device) => (device.id === id ? updated : device))
    return updated
  }

  async function deleteDevice(id: number): Promise<void> {
    await apiSend(`/api/v1/crosspoint/devices/${id}`, { method: 'DELETE' }, 'settings.reader.crosspoint.removeFailed')
    devices.value = devices.value.filter((device) => device.id !== id)
  }

  async function probeAddress(payload: ProbeCrosspointDeviceRequest): Promise<CrosspointProbeResult> {
    return apiJson<CrosspointProbeResult>('/api/v1/crosspoint/probe', jsonBody('POST', payload), 'settings.reader.crosspoint.testFailed')
  }

  async function probeDevice(id: number): Promise<CrosspointProbeResult> {
    return apiJson<CrosspointProbeResult>(`/api/v1/crosspoint/devices/${id}/probe`, { method: 'POST' }, 'settings.reader.crosspoint.testFailed')
  }

  return {
    devices,
    loading,
    error,
    fetchDevices,
    createDevice,
    updateDevice,
    deleteDevice,
    probeAddress,
    probeDevice,
  }
}
