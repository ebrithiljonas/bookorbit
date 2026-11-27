<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Check, Copy, Info, Link2, Loader2, Plus, Tablet, Wifi, X } from '@lucide/vue'
import type { CrosspointDeviceInfo, CrosspointProbeResult, CrosspointSelection, CrosspointSyncPreview } from '@bookorbit/types'
import { CROSSPOINT_DEFAULT_FILE_NAMING_PATTERN, CROSSPOINT_DEFAULT_ROOT_FOLDER } from '@bookorbit/types'
import { toast } from 'vue-sonner'

import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { formatBytes } from '@/lib/formatting'
import { errorMessage } from '@/lib/api-json'
import { copyToClipboard } from '@/lib/clipboard'
import { useCollections } from '@/features/collection/composables/useCollections'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'
import { useCrosspointDevices } from '@/features/crosspoint/composables/useCrosspointDevices'
import { useCrosspointSync } from '@/features/crosspoint/composables/useCrosspointSync'
import CrosspointActivityList from '@/features/crosspoint/components/CrosspointActivityList.vue'
import CrosspointBookSelectionFields from '@/features/crosspoint/components/CrosspointBookSelectionFields.vue'
import CrosspointDeviceCard from '@/features/crosspoint/components/CrosspointDeviceCard.vue'
import CrosspointDeviceEditor from '@/features/crosspoint/components/CrosspointDeviceEditor.vue'
import SettingsEmptyPanel from './components/SettingsEmptyPanel.vue'
import SettingsField from './components/SettingsField.vue'
import SettingsTabs from './components/SettingsTabs.vue'

const { t } = useI18n()
const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const route = props.embedded ? null : useRoute()
const router = props.embedded ? null : useRouter()

type Tab = 'devices' | 'activity'

function normalizeTab(value: unknown): Tab {
  return value === 'activity' ? 'activity' : 'devices'
}

const activeTab = ref<Tab>(props.embedded ? 'devices' : normalizeTab(route?.query.tab))
const tabs = computed(() => [
  { id: 'devices' as const, label: t('settings.reader.crosspoint.tabs.devices'), controls: 'crosspoint-devices-panel' },
  { id: 'activity' as const, label: t('settings.reader.crosspoint.tabs.activity'), controls: 'crosspoint-activity-panel' },
])

function selectTab(tab: Tab): void {
  activeTab.value = tab
  if (route && router) {
    void router.replace({ name: 'settings-crosspoint', query: { ...route.query, tab } })
  }
}

watch(
  () => route?.query.tab,
  (value) => {
    activeTab.value = normalizeTab(value)
  },
)

watch(activeTab, (tab) => {
  if (tab === 'activity') void loadActivity()
})

const {
  devices,
  loading: devicesLoading,
  error: devicesError,
  fetchDevices,
  createDevice,
  rotateSyncToken,
  deleteDevice,
  probeAddress,
} = useCrosspointDevices()
const { statusByDevice, runs, runsLoading, previewSync, startSync, fetchStatus, cancelSync, fetchRuns, clearRuns } = useCrosspointSync()
const { collections, fetchCollections, loading: collectionsLoading } = useCollections()
const { libraries, fetchLibraries, loading: librariesLoading } = useLibraries()
const { smartScopes, fetchSmartScopes, loading: smartScopesLoading } = useSmartScopes()

const loading = ref(true)
const optionsLoading = computed(() => librariesLoading.value || collectionsLoading.value || smartScopesLoading.value)
const pollTimers = new Map<number, ReturnType<typeof setTimeout>>()

const showAddForm = ref(false)
const newName = ref('')
const newHost = ref('')
const newWsPort = ref(81)
const newHttpPort = ref(80)
const newSelection = ref<CrosspointSelection>({ mode: 'all', libraryIds: [], collectionIds: [], smartScopeIds: [] })
const testing = ref(false)
const probeResult = ref<CrosspointProbeResult | null>(null)
const creating = ref(false)
const createError = ref<string | null>(null)
const syncEndpointUrl = ref<string | null>(null)
const syncEndpointDeviceName = ref('')
const rotatingEndpointId = ref<number | null>(null)

watch([newHost, newWsPort, newHttpPort], () => {
  probeResult.value = null
  createError.value = null
})

const editorOpen = ref(false)
const editingDevice = ref<CrosspointDeviceInfo | null>(null)

const removeTarget = ref<CrosspointDeviceInfo | null>(null)
const removing = ref(false)

const previewingId = ref<number | null>(null)
const syncingId = ref<number | null>(null)
const pendingSyncDevice = ref<CrosspointDeviceInfo | null>(null)
const pendingPreview = ref<CrosspointSyncPreview | null>(null)
const cancelTarget = ref<CrosspointDeviceInfo | null>(null)
const cancelling = ref(false)

const selectedActivityDeviceId = ref<number | null>(null)

const probeSummary = computed(() => {
  const probe = probeResult.value
  if (!probe) return null
  if (!probe.reachable) {
    return { ok: false, text: probe.error ?? t('settings.reader.crosspoint.unreachable') }
  }
  if (!probe.isCrosspoint) {
    return { ok: false, text: t('settings.reader.crosspoint.wrongDevice') }
  }
  return {
    ok: true,
    text: t('settings.reader.crosspoint.probeSuccess', {
      model: probe.deviceModel ?? t('settings.reader.crosspoint.unknownModel'),
      firmware: probe.firmwareVersion ?? t('settings.reader.crosspoint.unknownFirmware'),
    }),
  }
})

const syncConfirmDisabled = computed(() => {
  const preview = pendingPreview.value
  const device = pendingSyncDevice.value
  if (!preview || !device) return true
  if (preview.totalBooks > 0) return false
  return !(device.removeMissing && preview.removedBooks > 0)
})

const syncConfirmDescription = computed(() => {
  const preview = pendingPreview.value
  const device = pendingSyncDevice.value
  if (!preview || !device) return ''

  const parts = [
    t('settings.reader.crosspoint.syncConfirm.summary', {
      books: preview.totalBooks,
      size: formatBytes(preview.uploadBytes),
    }),
    t('settings.reader.crosspoint.syncConfirm.changes', {
      newCount: preview.newBooks,
      changed: preview.changedBooks,
    }),
  ]

  if (preview.removedBooks > 0) {
    parts.push(
      device.removeMissing
        ? t('settings.reader.crosspoint.syncConfirm.willRemove', { count: preview.removedBooks })
        : t('settings.reader.crosspoint.syncConfirm.willKeep', { count: preview.removedBooks }),
    )
  }

  if (preview.totalBooks === 0 && preview.removedBooks === 0) {
    parts.push(t('settings.reader.crosspoint.syncConfirm.nothing'))
  }

  return parts.join(' ')
})

function resetAddForm(): void {
  newName.value = ''
  newHost.value = ''
  newWsPort.value = 81
  newHttpPort.value = 80
  newSelection.value = { mode: 'all', libraryIds: [], collectionIds: [], smartScopeIds: [] }
  probeResult.value = null
  createError.value = null
}

function beginAdd(): void {
  resetAddForm()
  showAddForm.value = true
}

function cancelAdd(): void {
  if (creating.value) return
  showAddForm.value = false
  resetAddForm()
}

async function testConnection(): Promise<void> {
  const host = newHost.value.trim()
  if (!host) {
    createError.value = t('settings.reader.crosspoint.readerAddressRequired')
    return
  }

  testing.value = true
  probeResult.value = null
  createError.value = null
  try {
    probeResult.value = await probeAddress({
      host,
      wsPort: Number(newWsPort.value),
      httpPort: Number(newHttpPort.value),
    })
  } catch (reason) {
    createError.value = errorMessage(reason, 'settings.reader.crosspoint.testFailed')
    toast.error(createError.value)
  } finally {
    testing.value = false
  }
}

async function submitCreate(): Promise<void> {
  const name = newName.value.trim()
  const host = newHost.value.trim()
  if (!name || !host) {
    createError.value = t('settings.reader.crosspoint.fieldsRequired')
    return
  }

  creating.value = true
  createError.value = null
  try {
    const created = await createDevice({
      name,
      host,
      wsPort: Number(newWsPort.value),
      httpPort: Number(newHttpPort.value),
      rootFolder: CROSSPOINT_DEFAULT_ROOT_FOLDER,
      fileNamingPattern: CROSSPOINT_DEFAULT_FILE_NAMING_PATTERN,
      removeMissing: false,
      selection: newSelection.value,
    })
    syncEndpointUrl.value = `${window.location.origin}/api/v1/crosspoint/sync/${created.syncToken}`
    syncEndpointDeviceName.value = created.name
    toast.success(t('settings.reader.crosspoint.readerAdded', { name: created.name }))
    showAddForm.value = false
    resetAddForm()
    selectedActivityDeviceId.value = created.id
    await fetchStatus(created.id).catch(() => undefined)
    if (activeTab.value === 'activity') await loadActivity()
  } catch (reason) {
    createError.value = errorMessage(reason, 'settings.reader.crosspoint.createDeviceFailed')
    toast.error(createError.value)
  } finally {
    creating.value = false
  }
}

async function showSyncEndpoint(device: CrosspointDeviceInfo): Promise<void> {
  rotatingEndpointId.value = device.id
  try {
    const { syncToken } = await rotateSyncToken(device.id)
    syncEndpointUrl.value = `${window.location.origin}/api/v1/crosspoint/sync/${syncToken}`
    syncEndpointDeviceName.value = device.name
  } catch (reason) {
    toast.error(errorMessage(reason, 'settings.reader.crosspoint.syncEndpointFailed'))
  } finally {
    rotatingEndpointId.value = null
  }
}

function dismissSyncEndpoint(): void {
  syncEndpointUrl.value = null
  syncEndpointDeviceName.value = ''
}

async function copySyncEndpoint(): Promise<void> {
  if (!syncEndpointUrl.value) return
  const copied = await copyToClipboard(syncEndpointUrl.value)
  if (copied) toast.success(t('settings.reader.crosspoint.syncEndpointCopied'))
  else toast.error(t('settings.reader.crosspoint.syncEndpointCopyFailed'))
}

function openEditor(device: CrosspointDeviceInfo): void {
  editingDevice.value = device
  editorOpen.value = true
}

function closeEditor(): void {
  editorOpen.value = false
}

function handleEditorSaved(device: CrosspointDeviceInfo): void {
  void fetchStatus(device.id).catch(() => undefined)
  if (activeTab.value === 'activity') void loadActivity()
}

function requestRemove(device: CrosspointDeviceInfo): void {
  removeTarget.value = device
}

function cancelRemove(): void {
  if (!removing.value) removeTarget.value = null
}

async function confirmRemove(): Promise<void> {
  const device = removeTarget.value
  if (!device) return

  removing.value = true
  try {
    await deleteDevice(device.id)
    const nextStatuses = { ...statusByDevice.value }
    delete nextStatuses[device.id]
    statusByDevice.value = nextStatuses
    removeTarget.value = null
    toast.success(t('settings.reader.crosspoint.readerRemoved', { name: device.name }))

    if (selectedActivityDeviceId.value === device.id) {
      selectedActivityDeviceId.value = devices.value[0]?.id ?? null
      clearRuns()
      await loadActivity()
    }
  } catch (reason) {
    toast.error(errorMessage(reason, 'settings.reader.crosspoint.removeFailed'))
  } finally {
    removing.value = false
  }
}

async function requestSync(device: CrosspointDeviceInfo): Promise<void> {
  if (previewingId.value !== null || syncingId.value !== null) {
    toast.info(t('settings.reader.crosspoint.syncAlreadyRunning'))
    return
  }
  if (statusByDevice.value[device.id]?.run?.status === 'running') {
    toast.info(t('settings.reader.crosspoint.syncAlreadyRunning'))
    return
  }

  previewingId.value = device.id
  try {
    const preview = await previewSync(device.id)
    pendingPreview.value = preview
    pendingSyncDevice.value = device
  } catch (reason) {
    toast.error(errorMessage(reason, 'settings.reader.crosspoint.previewFailed'))
  } finally {
    previewingId.value = null
  }
}

function cancelSyncConfirm(): void {
  pendingSyncDevice.value = null
  pendingPreview.value = null
}

async function confirmSync(): Promise<void> {
  const device = pendingSyncDevice.value
  if (!device || syncConfirmDisabled.value) return

  pendingSyncDevice.value = null
  pendingPreview.value = null
  syncingId.value = device.id
  try {
    await startSync(device.id)
    toast.success(t('settings.reader.crosspoint.syncStarted'))
    startPolling(device.id)
  } catch (reason) {
    syncingId.value = null
    toast.error(errorMessage(reason, 'settings.reader.crosspoint.startFailed'))
  }
}

function requestCancel(device: CrosspointDeviceInfo): void {
  cancelTarget.value = device
}

function cancelCancel(): void {
  if (!cancelling.value) cancelTarget.value = null
}

async function confirmCancel(): Promise<void> {
  const device = cancelTarget.value
  if (!device) return

  cancelling.value = true
  try {
    await cancelSync(device.id)
    cancelTarget.value = null
    toast.success(t('settings.reader.crosspoint.cancelRequested'))
  } catch (reason) {
    toast.error(errorMessage(reason, 'settings.reader.crosspoint.cancelFailed'))
  } finally {
    cancelling.value = false
  }
}

function clearPollTimer(deviceId: number): void {
  const timer = pollTimers.get(deviceId)
  if (timer) clearTimeout(timer)
  pollTimers.delete(deviceId)
}

function startPolling(deviceId: number): void {
  clearPollTimer(deviceId)
  void pollDevice(deviceId)
}

async function pollDevice(deviceId: number): Promise<void> {
  try {
    const status = await fetchStatus(deviceId)
    const run = status.run

    if (run?.status === 'running') {
      syncingId.value = deviceId
      pollTimers.set(
        deviceId,
        setTimeout(() => {
          void pollDevice(deviceId)
        }, 1000),
      )
      return
    }

    if (syncingId.value === deviceId) syncingId.value = null
    clearPollTimer(deviceId)
    await fetchDevices(true)
    if (activeTab.value === 'activity' && selectedActivityDeviceId.value === deviceId) {
      await loadActivity()
    }

    if (run?.status === 'completed') {
      if (run.failed > 0) {
        toast.warning(
          t('settings.reader.crosspoint.syncCompletedWithFailures', {
            uploaded: run.uploaded,
            failed: run.failed,
          }),
        )
      } else {
        toast.success(t('settings.reader.crosspoint.syncCompleted', { uploaded: run.uploaded, skipped: run.skipped }))
      }
    } else if (run?.status === 'failed') {
      toast.error(t('settings.reader.crosspoint.syncFailed'))
    } else if (run?.status === 'cancelled') {
      toast.info(t('settings.reader.crosspoint.syncCancelled'))
    } else if (run?.status === 'interrupted') {
      toast.warning(t('settings.reader.crosspoint.syncInterrupted'))
    }
  } catch (reason) {
    syncingId.value = null
    clearPollTimer(deviceId)
    toast.error(errorMessage(reason, 'settings.reader.crosspoint.statusFailed'))
  }
}

async function loadActivity(): Promise<void> {
  const deviceId = selectedActivityDeviceId.value
  if (!deviceId) {
    clearRuns()
    return
  }
  try {
    await fetchRuns(deviceId)
  } catch (reason) {
    toast.error(errorMessage(reason, 'settings.reader.crosspoint.activity.loadFailed'))
  }
}

function handleSelectActivityDevice(deviceId: number): void {
  selectedActivityDeviceId.value = deviceId
  clearRuns()
  void loadActivity()
}

async function loadPage(): Promise<void> {
  loading.value = true
  await Promise.allSettled([fetchDevices(true), fetchLibraries(), fetchCollections(), fetchSmartScopes()])

  if (devices.value.length > 0) {
    if (!selectedActivityDeviceId.value || !devices.value.some((device) => device.id === selectedActivityDeviceId.value)) {
      selectedActivityDeviceId.value = devices.value[0]!.id
    }
    await Promise.allSettled(
      devices.value.map(async (device) => {
        const status = await fetchStatus(device.id)
        if (status.run?.status === 'running') startPolling(device.id)
      }),
    )
    if (activeTab.value === 'activity') await loadActivity()
  }

  loading.value = false
}

watch(devices, (next) => {
  if (next.length === 0) {
    selectedActivityDeviceId.value = null
    clearRuns()
    return
  }
  if (!next.some((device) => device.id === selectedActivityDeviceId.value)) {
    selectedActivityDeviceId.value = next[0]!.id
    if (activeTab.value === 'activity') void loadActivity()
  }
})

onMounted(() => {
  void loadPage()
})

onUnmounted(() => {
  for (const timer of pollTimers.values()) clearTimeout(timer)
  pollTimers.clear()
})
</script>

<template>
  <div v-if="loading && devices.length === 0" class="settings-loading-state">
    {{ t('common.loading') }}
  </div>

  <div v-else-if="devicesError && devices.length === 0" class="settings-error-state">
    <p>{{ devicesError }}</p>
    <Button size="sm" variant="outline" @click="loadPage">{{ t('settings.reader.crosspoint.retry') }}</Button>
  </div>

  <template v-else>
    <SettingsTabs v-if="!props.embedded" :tabs="tabs" :active-tab="activeTab" @select="selectTab" />

    <div v-show="activeTab === 'devices' || props.embedded" id="crosspoint-devices-panel">
      <div v-if="syncEndpointUrl" class="mb-6 rounded-lg border-2 border-primary/30 bg-primary/5 p-4 shadow-xs">
        <div class="mb-3 flex items-start justify-between gap-4">
          <div class="flex items-start gap-2.5">
            <div class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
              <Check :size="13" stroke-width="3" aria-hidden="true" />
            </div>
            <div>
              <p class="settings-label mb-0.5 leading-none">{{ t('settings.reader.crosspoint.syncEndpointTitle') }}</p>
              <p class="settings-hint">{{ t('settings.reader.crosspoint.syncEndpointHint', { name: syncEndpointDeviceName }) }}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" class="shrink-0" @click="dismissSyncEndpoint">
            <X :size="18" aria-hidden="true" />
          </Button>
        </div>

        <div class="rounded-lg border border-border bg-background p-4">
          <p class="mb-2.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {{ t('settings.reader.crosspoint.syncEndpoint') }}
          </p>
          <div class="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2.5">
            <Link2 :size="14" class="shrink-0 text-muted-foreground" aria-hidden="true" />
            <span class="min-w-0 flex-1 select-all truncate font-mono text-sm text-foreground">{{ syncEndpointUrl }}</span>
            <Button variant="outline" size="sm" class="shrink-0" @click="copySyncEndpoint">
              <Copy :size="12" aria-hidden="true" />
              {{ t('settings.reader.crosspoint.syncEndpointCopy') }}
            </Button>
          </div>
        </div>

        <p class="mt-2.5 flex items-center gap-2 rounded-md border border-warning/20 bg-warning/5 px-3 py-2 text-xs font-medium text-warning">
          <Info :size="14" class="shrink-0" aria-hidden="true" />
          {{ t('settings.reader.crosspoint.syncEndpointNotShownAgain') }}
        </p>

        <div class="mt-3 space-y-1.5 rounded-md border border-border bg-background p-4 text-xs text-muted-foreground">
          <p class="font-semibold text-foreground">{{ t('settings.reader.crosspoint.syncEndpointNextSteps.title') }}</p>
          <p>{{ t('settings.reader.crosspoint.syncEndpointNextSteps.step1') }}</p>
          <p>{{ t('settings.reader.crosspoint.syncEndpointNextSteps.step2') }}</p>
          <p>{{ t('settings.reader.crosspoint.syncEndpointNextSteps.step3') }}</p>
          <p>{{ t('settings.reader.crosspoint.syncEndpointNextSteps.step4') }}</p>
        </div>
      </div>

      <div class="mb-6 rounded-lg border border-primary/10 bg-primary/5 p-4">
        <div class="flex items-start gap-3">
          <Info :size="18" class="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
          <div class="space-y-1.5">
            <p class="text-sm font-semibold text-foreground">{{ t('settings.reader.crosspoint.intro.title') }}</p>
            <p class="text-xs leading-relaxed text-muted-foreground">{{ t('settings.reader.crosspoint.intro.body') }}</p>
            <p class="text-xs leading-relaxed text-muted-foreground">{{ t('settings.reader.crosspoint.intro.noProgress') }}</p>
          </div>
        </div>
      </div>

      <div class="mb-8">
        <div class="mb-2 flex items-center justify-between gap-3">
          <p class="settings-group-label mb-0">{{ t('settings.reader.crosspoint.registeredReaders') }}</p>
          <Button v-if="!showAddForm" size="sm" type="button" @click="beginAdd">
            <Plus :size="12" aria-hidden="true" />
            {{ t('settings.reader.crosspoint.addReader') }}
          </Button>
        </div>

        <div v-if="showAddForm" class="mb-4 space-y-4 rounded-lg border border-border bg-card p-4 shadow-xs">
          <div>
            <p class="settings-label">{{ t('settings.reader.crosspoint.addReader') }}</p>
            <p class="settings-hint">{{ t('settings.reader.crosspoint.addReaderHint') }}</p>
          </div>

          <SettingsField :label="t('settings.reader.crosspoint.readerName')" input-id="crosspoint-new-name" required>
            <template #default="{ describedBy }">
              <input
                id="crosspoint-new-name"
                v-model="newName"
                type="text"
                class="input-field w-full"
                :aria-describedby="describedBy"
                autocomplete="off"
                :placeholder="t('settings.reader.crosspoint.readerNamePlaceholder')"
              />
            </template>
          </SettingsField>

          <SettingsField
            :label="t('settings.reader.crosspoint.readerAddress')"
            input-id="crosspoint-new-host"
            :brief="t('settings.reader.crosspoint.readerAddressHint')"
            required
          >
            <template #default="{ describedBy }">
              <input
                id="crosspoint-new-host"
                v-model="newHost"
                type="text"
                class="input-field w-full font-mono"
                :aria-describedby="describedBy"
                autocomplete="off"
                spellcheck="false"
                :placeholder="t('settings.reader.crosspoint.readerAddressPlaceholder')"
              />
            </template>
          </SettingsField>

          <div class="grid gap-4 sm:grid-cols-2">
            <SettingsField :label="t('settings.reader.crosspoint.wsPort')" input-id="crosspoint-new-ws-port">
              <template #default="{ describedBy }">
                <input
                  id="crosspoint-new-ws-port"
                  v-model.number="newWsPort"
                  type="number"
                  min="1"
                  max="65535"
                  class="input-field w-full"
                  :aria-describedby="describedBy"
                />
              </template>
            </SettingsField>
            <SettingsField :label="t('settings.reader.crosspoint.httpPort')" input-id="crosspoint-new-http-port">
              <template #default="{ describedBy }">
                <input
                  id="crosspoint-new-http-port"
                  v-model.number="newHttpPort"
                  type="number"
                  min="1"
                  max="65535"
                  class="input-field w-full"
                  :aria-describedby="describedBy"
                />
              </template>
            </SettingsField>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" type="button" :disabled="testing || creating" @click="testConnection">
              <Loader2 v-if="testing" :size="13" class="animate-spin" aria-hidden="true" />
              <Wifi v-else :size="13" aria-hidden="true" />
              {{ testing ? t('settings.reader.crosspoint.testing') : t('settings.reader.crosspoint.testConnection') }}
            </Button>
          </div>

          <div
            v-if="probeSummary"
            class="flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
            :class="probeSummary.ok ? 'border-primary/20 bg-primary/5 text-primary' : 'border-destructive/20 bg-destructive/5 text-destructive'"
          >
            <Check v-if="probeSummary.ok" :size="14" class="mt-0.5 shrink-0" aria-hidden="true" />
            <X v-else :size="14" class="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{{ probeSummary.text }}</span>
          </div>

          <section class="space-y-3 border-t border-border pt-4">
            <div>
              <h3 class="settings-group-label mb-0">{{ t('settings.reader.crosspoint.editor.booksTitle') }}</h3>
              <p class="settings-hint">{{ t('settings.reader.crosspoint.editor.booksHint') }}</p>
            </div>
            <CrosspointBookSelectionFields
              v-model="newSelection"
              :libraries="libraries"
              :collections="collections"
              :smart-scopes="smartScopes"
              :options-loading="optionsLoading"
              :disabled="creating"
            />
          </section>

          <p v-if="createError" role="alert" class="text-xs text-destructive">{{ createError }}</p>

          <div class="flex items-center gap-2 pt-1">
            <Button size="sm" type="button" :disabled="creating || !newName.trim() || !newHost.trim()" @click="submitCreate">
              <Loader2 v-if="creating" :size="13" class="animate-spin" aria-hidden="true" />
              {{ creating ? t('settings.reader.crosspoint.creating') : t('settings.reader.crosspoint.createReader') }}
            </Button>
            <Button size="sm" variant="outline" type="button" :disabled="creating" @click="cancelAdd">
              {{ t('common.cancel') }}
            </Button>
          </div>
        </div>

        <SettingsEmptyPanel
          v-if="devices.length === 0 && !showAddForm && !devicesLoading"
          :title="t('settings.reader.crosspoint.noReadersTitle')"
          :body="t('settings.reader.crosspoint.noReadersHint')"
        >
          <template #icon><Tablet :size="16" aria-hidden="true" /></template>
          <Button size="sm" type="button" @click="beginAdd">
            <Plus :size="12" aria-hidden="true" />
            {{ t('settings.reader.crosspoint.addReader') }}
          </Button>
        </SettingsEmptyPanel>

        <div v-else class="space-y-2">
          <CrosspointDeviceCard
            v-for="device in devices"
            :key="device.id"
            :device="device"
            :status="statusByDevice[device.id] ?? null"
            :syncing="syncingId === device.id"
            :previewing="previewingId === device.id"
            @sync="requestSync(device)"
            @cancel="requestCancel(device)"
            @edit="openEditor(device)"
            @endpoint="showSyncEndpoint(device)"
            @remove="requestRemove(device)"
          />
        </div>
      </div>
    </div>

    <div v-show="activeTab === 'activity' && !props.embedded" id="crosspoint-activity-panel">
      <CrosspointActivityList
        :devices="devices"
        :runs="runs"
        :loading="runsLoading"
        :selected-device-id="selectedActivityDeviceId"
        @select-device="handleSelectActivityDevice"
        @refresh="loadActivity"
      />
    </div>

    <CrosspointDeviceEditor
      :open="editorOpen"
      :device="editingDevice"
      :libraries="libraries"
      :collections="collections"
      :smart-scopes="smartScopes"
      :options-loading="optionsLoading"
      @close="closeEditor"
      @saved="handleEditorSaved"
    />

    <ConfirmDialog
      :open="pendingSyncDevice !== null"
      :title="t('settings.reader.crosspoint.syncConfirm.title', { name: pendingSyncDevice?.name ?? '' })"
      :description="syncConfirmDescription"
      :confirm-label="t('settings.reader.crosspoint.syncConfirm.confirm')"
      :cancel-label="t('common.cancel')"
      :destructive="false"
      :confirm-disabled="syncConfirmDisabled"
      @confirm="confirmSync"
      @cancel="cancelSyncConfirm"
    />

    <ConfirmDialog
      :open="removeTarget !== null"
      :title="t('settings.reader.crosspoint.removeReaderTitle')"
      :description="t('settings.reader.crosspoint.removeReaderBody', { name: removeTarget?.name ?? '' })"
      :confirm-label="t('settings.reader.crosspoint.removeReader')"
      :busy="removing"
      @confirm="confirmRemove"
      @cancel="cancelRemove"
    />

    <ConfirmDialog
      :open="cancelTarget !== null"
      :title="t('settings.reader.crosspoint.cancelSyncTitle')"
      :description="t('settings.reader.crosspoint.cancelSyncBody', { name: cancelTarget?.name ?? '' })"
      :confirm-label="t('settings.reader.crosspoint.cancelSync')"
      :busy="cancelling"
      :destructive="false"
      @confirm="confirmCancel"
      @cancel="cancelCancel"
    />
  </template>
</template>
