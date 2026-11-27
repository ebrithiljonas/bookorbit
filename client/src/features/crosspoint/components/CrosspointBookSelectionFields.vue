<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import type { Collection, CrosspointSelection, CrosspointSelectionMode, Library, SmartScope } from '@bookorbit/types'

const props = defineProps<{
  modelValue: CrosspointSelection
  libraries: Library[]
  collections: Collection[]
  smartScopes: SmartScope[]
  optionsLoading?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: CrosspointSelection] }>()
const { t } = useI18n()

const selection = computed(() => props.modelValue)
const selectedWithoutChoices = computed(() => {
  if (selection.value.mode === 'libraries') return selection.value.libraryIds.length === 0
  if (selection.value.mode === 'selected') {
    return selection.value.collectionIds.length === 0 && selection.value.smartScopeIds.length === 0
  }
  return false
})

function update(next: Partial<CrosspointSelection>): void {
  emit('update:modelValue', { ...selection.value, ...next })
}

function setMode(mode: CrosspointSelectionMode): void {
  update({ mode })
}

function toggleLibrary(id: number): void {
  update({
    libraryIds: selection.value.libraryIds.includes(id)
      ? selection.value.libraryIds.filter((value) => value !== id)
      : [...selection.value.libraryIds, id],
  })
}

function toggleCollection(id: number): void {
  update({
    collectionIds: selection.value.collectionIds.includes(id)
      ? selection.value.collectionIds.filter((value) => value !== id)
      : [...selection.value.collectionIds, id],
  })
}

function toggleSmartScope(id: number): void {
  update({
    smartScopeIds: selection.value.smartScopeIds.includes(id)
      ? selection.value.smartScopeIds.filter((value) => value !== id)
      : [...selection.value.smartScopeIds, id],
  })
}
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-2">
      <label class="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2.5">
        <input
          :checked="selection.mode === 'all'"
          type="radio"
          value="all"
          class="mt-0.5 size-4 accent-primary"
          :disabled="disabled"
          @change="setMode('all')"
        />
        <span class="min-w-0">
          <span class="settings-label block">{{ t('settings.reader.crosspoint.editor.allBooks') }}</span>
          <span class="settings-hint">{{ t('settings.reader.crosspoint.editor.allBooksHint') }}</span>
        </span>
      </label>

      <label class="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2.5">
        <input
          :checked="selection.mode === 'libraries'"
          type="radio"
          value="libraries"
          class="mt-0.5 size-4 accent-primary"
          :disabled="disabled"
          @change="setMode('libraries')"
        />
        <span class="min-w-0">
          <span class="settings-label block">{{ t('settings.reader.crosspoint.editor.selectedLibraries') }}</span>
          <span class="settings-hint">{{ t('settings.reader.crosspoint.editor.selectedLibrariesHint') }}</span>
        </span>
      </label>

      <label class="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2.5">
        <input
          :checked="selection.mode === 'selected'"
          type="radio"
          value="selected"
          class="mt-0.5 size-4 accent-primary"
          :disabled="disabled"
          @change="setMode('selected')"
        />
        <span class="min-w-0">
          <span class="settings-label block">{{ t('settings.reader.crosspoint.editor.selectedBooks') }}</span>
          <span class="settings-hint">{{ t('settings.reader.crosspoint.editor.selectedBooksHint') }}</span>
        </span>
      </label>
    </div>

    <div v-if="selection.mode === 'libraries'" class="space-y-2 rounded-md border border-border bg-muted/20 p-3.5">
      <p class="settings-group-label mb-0">{{ t('settings.reader.crosspoint.editor.libraries') }}</p>
      <p v-if="optionsLoading" class="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 :size="13" class="animate-spin" aria-hidden="true" />
        {{ t('settings.reader.crosspoint.editor.optionsLoading') }}
      </p>
      <p v-else-if="libraries.length === 0" class="settings-hint">{{ t('settings.reader.crosspoint.editor.librariesEmpty') }}</p>
      <div v-else class="max-h-56 space-y-1.5 overflow-y-auto pe-1">
        <label
          v-for="library in libraries"
          :key="library.id"
          class="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-sm"
        >
          <input
            type="checkbox"
            :checked="selection.libraryIds.includes(library.id)"
            class="size-4 shrink-0 accent-primary"
            :disabled="disabled"
            @change="toggleLibrary(library.id)"
          />
          <span class="min-w-0 flex-1 truncate">{{ library.name }}</span>
          <span v-if="library.bookCount !== undefined" class="shrink-0 text-xs tabular-nums text-muted-foreground">{{ library.bookCount }}</span>
        </label>
      </div>
    </div>

    <div v-if="selection.mode === 'selected'" class="space-y-4 rounded-md border border-border bg-muted/20 p-3.5">
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
                :checked="selection.collectionIds.includes(collection.id)"
                class="size-4 shrink-0 accent-primary"
                :disabled="disabled"
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
                :checked="selection.smartScopeIds.includes(scope.id)"
                class="size-4 shrink-0 accent-primary"
                :disabled="disabled"
                @change="toggleSmartScope(scope.id)"
              />
              <span class="min-w-0 flex-1 truncate">{{ scope.name }}</span>
              <span class="shrink-0 text-xs tabular-nums text-muted-foreground">{{ scope.bookCount ?? '?' }}</span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <p v-if="selectedWithoutChoices" role="alert" class="text-xs text-destructive">
      {{
        selection.mode === 'libraries'
          ? t('settings.reader.crosspoint.editor.noLibrarySelection')
          : t('settings.reader.crosspoint.editor.noSelection')
      }}
    </p>
  </div>
</template>
