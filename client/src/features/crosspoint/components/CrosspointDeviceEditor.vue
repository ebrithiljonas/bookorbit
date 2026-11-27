<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Info, Loader2 } from '@lucide/vue'
import type { Collection, CrosspointDeviceInfo, CrosspointSelectionMode, SmartScope } from '@bookorbit/types'
import { toast } from 'vue-sonner'

import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/api-json'
import SettingsEditorSheet from '@/features/settings/components/SettingsEditorSheet.vue'
import SettingsField from '@/features/settings/components/SettingsField.vue'
import SettingsToggleField from '@/features/settings/components/SettingsToggleField.vue'
import CrosspointPatternField from './CrosspointPatternField.vue'
import { useCrosspointDevices } from '../composables/useCrosspointDevices'

const props = defineProps<{
  open: boolean
  device: CrosspointDeviceInfo | null
  collections: Collection[]
  smartScopes: SmartScope[]
  optionsLoading?: boolean
}>()

const emit = defineEmits<{ close: []; saved: [device: CrosspointDeviceInfo] }>()
const { t } = useI18n()
const { updateDevice } = useCrosspointDevices()

const name = ref('')
const host = ref('')
const wsPort = ref(81)
const httpPort = ref(80)
const rootFolder = ref('/BookOrbit')
const pattern = ref('')
const selectionMode = ref<CrosspointSelectionMode>('all')
const collectionIds = ref<number[]>([])
const smartScopeIds = ref<number[]>([])
const removeMissing = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const originalSnapshot = ref('')

function snapshot(): string {
  return JSON.stringify({
    name: name.value,
    host: host.value,
    wsPort: wsPort.value,
    httpPort: httpPort.value,
    rootFolder: rootFolder.value,
    pattern: pattern.value,
    selectionMode: selectionMode.value,
    collectionIds: [...collectionIds.value].sort((a, b) => a - b),
    smartScopeIds: [...smartScopeIds.value].sort((a, b) => a - b),
    removeMissing: removeMissing.value,
  })
}

const dirty = computed(() => props.open && snapshot() !== originalSnapshot.value)
const selectedWithoutChoices = computed(
  () => selectionMode.value === 'selected' && collectionIds.value.length === 0 && smartScopeIds.value.length === 0,
)
const canSave = computed(() => props.device !== null && name.value.trim().length > 0 && host.value.trim().length > 0 && !saving.value)

function initialize(): void {
  const device = props.device
  if (!device) return

  name.value = device.name
  host.value = device.host
  wsPort.value = device.wsPort
  httpPort.value = device.httpPort
  rootFolder.value = device.rootFolder
  pattern.value = device.fileNamingPattern
  selectionMode.value = device.selection.mode
  collectionIds.value = [...device.selection.collectionIds]
  smartScopeIds.value = [...device.selection.smartScopeIds]
  removeMissing.value = device.removeMissing
  error.value = null
  originalSnapshot.value = snapshot()
}

watch(
  () => [props.open, props.device?.id] as const,
  ([open]) => {
    if (open) initialize()
  },
  { immediate: true },
)

function closeEditor(): void {
  if (!saving.value) emit('close')
}

function toggleCollection(id: number): void {
  collectionIds.value = collectionIds.value.includes(id) ? collectionIds.value.filter((value) => value !== id) : [...collectionIds.value, id]
}

function toggleSmartScope(id: number): void {
  smartScopeIds.value = smartScopeIds.value.includes(id) ? smartScopeIds.value.filter((value) => value !== id) : [...smartScopeIds.value, id]
}

async function handleSave(): Promise<void> {
  const device = props.device
  if (!device || !canSave.value) return

  saving.value = true
  error.value = null
  try {
    const updated = await updateDevice(device.id, {
      name: name.value.trim(),
      host: host.value.trim(),
      wsPort: Number(wsPort.value),
      httpPort: Number(httpPort.value),
      rootFolder: rootFolder.value.trim(),
      fileNamingPattern: pattern.value,
      removeMissing: removeMissing.value,
      selection: {
        mode: selectionMode.value,
        collectionIds: collectionIds.value,
        smartScopeIds: smartScopeIds.value,
      },
    })
    toast.success(t('settings.reader.crosspoint.editor.saved'))
    emit('saved', updated)
    emit('close')
  } catch (reason) {
    error.value = errorMessage(reason, 'settings.reader.crosspoint.updateDeviceFailed')
    toast.error(error.value)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <SettingsEditorSheet
    :open="open"
    :title="t('settings.reader.crosspoint.editor.title', { name: device?.name ?? '' })"
    :description="t('settings.reader.crosspoint.editor.description')"
    :busy="saving"
    :dirty="dirty"
    @save="handleSave"
    @cancel="closeEditor"
  >
    <div class="space-y-6">
      <section class="space-y-4">
        <div>
          <h3 class="settings-group-label mb-0">{{ t('settings.reader.crosspoint.editor.addressTitle') }}</h3>
          <p class="settings-hint">{{ t('settings.reader.crosspoint.editor.addressHint') }}</p>
        </div>

        <SettingsField
          :label="t('settings.reader.crosspoint.readerName')"
          input-id="crosspoint-editor-name"
          :brief="t('settings.reader.crosspoint.editor.nameHint')"
          required
        >
          <template #default="{ describedBy }">
            <input
              id="crosspoint-editor-name"
              v-model="name"
              type="text"
              class="input-field w-full"
              :aria-describedby="describedBy"
              autocomplete="off"
            />
          </template>
        </SettingsField>

        <SettingsField
          :label="t('settings.reader.crosspoint.readerAddress')"
          input-id="crosspoint-editor-host"
          :brief="t('settings.reader.crosspoint.editor.addressFieldHint')"
          required
        >
          <template #default="{ describedBy }">
            <input
              id="crosspoint-editor-host"
              v-model="host"
              type="text"
              class="input-field w-full font-mono"
              :aria-describedby="describedBy"
              autocomplete="off"
              spellcheck="false"
            />
          </template>
        </SettingsField>

        <div class="grid gap-4 sm:grid-cols-2">
          <SettingsField
            :label="t('settings.reader.crosspoint.wsPort')"
            input-id="crosspoint-editor-ws-port"
            :brief="t('settings.reader.crosspoint.editor.wsPortHint')"
          >
            <template #default="{ describedBy }">
              <input
                id="crosspoint-editor-ws-port"
                v-model.number="wsPort"
                type="number"
                min="1"
                max="65535"
                class="input-field w-full"
                :aria-describedby="describedBy"
              />
            </template>
          </SettingsField>

          <SettingsField
            :label="t('settings.reader.crosspoint.httpPort')"
            input-id="crosspoint-editor-http-port"
            :brief="t('settings.reader.crosspoint.editor.httpPortHint')"
          >
            <template #default="{ describedBy }">
              <input
                id="crosspoint-editor-http-port"
                v-model.number="httpPort"
                type="number"
                min="1"
                max="65535"
                class="input-field w-full"
                :aria-describedby="describedBy"
              />
            </template>
          </SettingsField>
        </div>
      </section>

      <section class="space-y-4 border-t border-border pt-5">
        <div>
          <h3 class="settings-group-label mb-0">{{ t('settings.reader.crosspoint.editor.filesTitle') }}</h3>
          <p class="settings-hint">{{ t('settings.reader.crosspoint.editor.filesHint') }}</p>
        </div>

        <SettingsField
          :label="t('settings.reader.crosspoint.editor.managedFolder')"
          input-id="crosspoint-editor-root"
          :brief="t('settings.reader.crosspoint.editor.managedFolderHint')"
        >
          <template #default="{ describedBy }">
            <input
              id="crosspoint-editor-root"
              v-model="rootFolder"
              type="text"
              class="input-field w-full font-mono"
              :aria-describedby="describedBy"
              spellcheck="false"
            />
          </template>
        </SettingsField>

        <CrosspointPatternField v-model="pattern" :root-folder="rootFolder" :disabled="saving" />

        <p class="flex items-start gap-2 text-xs text-muted-foreground">
          <Info :size="13" class="mt-0.5 shrink-0" aria-hidden="true" />
          {{ t('settings.reader.crosspoint.editor.patternChangeWarning') }}
        </p>
      </section>

      <section class="space-y-4 border-t border-border pt-5">
        <div>
          <h3 class="settings-group-label mb-0">{{ t('settings.reader.crosspoint.editor.booksTitle') }}</h3>
          <p class="settings-hint">{{ t('settings.reader.crosspoint.editor.booksHint') }}</p>
        </div>

        <div class="space-y-2">
          <label class="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2.5">
            <input v-model="selectionMode" type="radio" value="all" class="mt-0.5 size-4 accent-primary" />
            <span class="min-w-0">
              <span class="settings-label block">{{ t('settings.reader.crosspoint.editor.allBooks') }}</span>
              <span class="settings-hint">{{ t('settings.reader.crosspoint.editor.allBooksHint') }}</span>
            </span>
          </label>
          <label class="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2.5">
            <input v-model="selectionMode" type="radio" value="selected" class="mt-0.5 size-4 accent-primary" />
            <span class="min-w-0">
              <span class="settings-label block">{{ t('settings.reader.crosspoint.editor.selectedBooks') }}</span>
              <span class="settings-hint">{{ t('settings.reader.crosspoint.editor.selectedBooksHint') }}</span>
            </span>
          </label>
        </div>

        <div v-if="selectionMode === 'selected'" class="space-y-4 rounded-md border border-border bg-muted/20 p-3.5">
          <p v-if="optionsLoading" class="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 :size="13" class="animate-spin" aria-hidden="true" />
            {{ t('settings.reader.crosspoint.editor.optionsLoading') }}
          </p>

          <div v-else class="grid gap-5 md:grid-cols-2">
            <div class="min-w-0 space-y-2">
              <p class="settings-group-label mb-0">{{ t('settings.reader.crosspoint.editor.collections') }}</p>
              <p v-if="collections.length === 0" class="settings-hint">{{ t('settings.reader.crosspoint.editor.collectionsEmpty') }}</p>
              <div v-else class="max-h-48 space-y-1.5 overflow-y-auto pe-1">
                <label
                  v-for="collection in collections"
                  :key="collection.id"
                  class="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    :checked="collectionIds.includes(collection.id)"
                    class="size-4 shrink-0 accent-primary"
                    @change="toggleCollection(collection.id)"
                  />
                  <span class="min-w-0 flex-1 truncate">{{ collection.name }}</span>
                  <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{{ collection.bookCount }}</span>
                </label>
              </div>
            </div>

            <div class="min-w-0 space-y-2">
              <p class="settings-group-label mb-0">{{ t('settings.reader.crosspoint.editor.smartScopes') }}</p>
              <p v-if="smartScopes.length === 0" class="settings-hint">{{ t('settings.reader.crosspoint.editor.smartScopesEmpty') }}</p>
              <div v-else class="max-h-48 space-y-1.5 overflow-y-auto pe-1">
                <label
                  v-for="scope in smartScopes"
                  :key="scope.id"
                  class="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    :checked="smartScopeIds.includes(scope.id)"
                    class="size-4 shrink-0 accent-primary"
                    @change="toggleSmartScope(scope.id)"
                  />
                  <span class="min-w-0 flex-1 truncate">{{ scope.name }}</span>
                  <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{{ scope.bookCount ?? '?' }}</span>
                </label>
              </div>
            </div>
          </div>

          <p v-if="selectedWithoutChoices" role="alert" class="text-xs text-destructive">
            {{ t('settings.reader.crosspoint.editor.noSelection') }}
          </p>
        </div>
      </section>

      <section class="border-t border-border pt-5">
        <SettingsToggleField
          v-model="removeMissing"
          input-id="crosspoint-editor-remove-missing"
          :label="t('settings.reader.crosspoint.editor.removeMissing')"
          :brief="t('settings.reader.crosspoint.editor.removeMissingHint')"
          :disabled="saving"
        />
      </section>

      <p v-if="error" role="alert" class="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        {{ error }}
      </p>
    </div>

    <template #footer="{ requestClose }">
      <div class="flex flex-wrap items-center gap-3">
        <Button size="sm" :disabled="!canSave" @click="handleSave">
          <Loader2 v-if="saving" class="animate-spin" aria-hidden="true" />
          {{ saving ? t('settings.reader.crosspoint.editor.saving') : t('common.save') }}
        </Button>
        <Button size="sm" variant="outline" :disabled="saving" @click="requestClose">{{ t('common.cancel') }}</Button>
      </div>
    </template>
  </SettingsEditorSheet>
</template>
