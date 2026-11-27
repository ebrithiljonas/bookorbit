<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RotateCcw } from '@lucide/vue'
import {
  CROSSPOINT_DEFAULT_FILE_NAMING_PATTERN,
  EXAMPLE_PATTERN_METADATA,
  PATTERN_TOKENS,
  resolveUploadPath,
  validatePattern,
} from '@bookorbit/types'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  modelValue: string
  rootFolder: string
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { t } = useI18n()

const PATTERN_PREVIEW_TOKENS = { ...EXAMPLE_PATTERN_METADATA, extension: 'epub' }

const trimmed = computed(() => props.modelValue.trim())
const invalidReason = computed(() => {
  if (!trimmed.value) return t('settings.reader.crosspoint.editor.patternRequired')
  if (trimmed.value.startsWith('/')) return t('settings.reader.crosspoint.editor.patternAbsolute')
  if (trimmed.value.split('/').some((segment) => segment === '.' || segment === '..')) {
    return t('settings.reader.crosspoint.editor.patternTraversal')
  }
  if (!validatePattern(trimmed.value)) return t('settings.reader.crosspoint.editor.patternInvalid')
  return null
})

const previewPath = computed(() => {
  if (invalidReason.value) return null
  const resolved = resolveUploadPath(trimmed.value, PATTERN_PREVIEW_TOKENS, 'epub', { sanitizeForCrossPlatform: true })
  if (!resolved) return null
  const root = props.rootFolder.trim().replace(/\/+$/, '') || '/'
  const relative = resolved.replace(/^\/+/, '')
  return root === '/' ? `/${relative}` : `${root}/${relative}`
})

function handleInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}

function resetPattern(): void {
  emit('update:modelValue', CROSSPOINT_DEFAULT_FILE_NAMING_PATTERN)
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between gap-3">
      <label for="crosspoint-file-pattern" class="settings-label">
        {{ t('settings.reader.crosspoint.editor.pattern') }}
      </label>
      <Button size="sm" variant="outline" type="button" :disabled="disabled" @click="resetPattern">
        <RotateCcw :size="13" aria-hidden="true" />
        {{ t('settings.reader.crosspoint.editor.resetPattern') }}
      </Button>
    </div>
    <p id="crosspoint-file-pattern-hint" class="settings-hint">
      {{ t('settings.reader.crosspoint.editor.patternHint') }}
    </p>
    <textarea
      id="crosspoint-file-pattern"
      :value="modelValue"
      rows="3"
      spellcheck="false"
      :disabled="disabled"
      class="input-field min-h-24 w-full resize-y bg-background font-mono"
      :aria-invalid="Boolean(invalidReason)"
      :aria-describedby="invalidReason ? 'crosspoint-file-pattern-error' : 'crosspoint-file-pattern-hint'"
      @input="handleInput"
    />
    <p v-if="invalidReason" id="crosspoint-file-pattern-error" role="alert" class="text-xs text-destructive">
      {{ invalidReason }}
    </p>

    <div class="rounded-md border border-border bg-muted/30 px-3 py-2.5">
      <p class="settings-group-label mb-1">{{ t('settings.reader.crosspoint.editor.patternPreview') }}</p>
      <p v-if="previewPath" class="break-all font-mono text-xs text-foreground">{{ previewPath }}</p>
      <p v-else class="text-xs text-muted-foreground">{{ t('settings.reader.crosspoint.editor.patternPreviewUnavailable') }}</p>
      <p class="mt-1.5 text-xs text-muted-foreground">{{ t('settings.reader.crosspoint.editor.patternPreviewNote') }}</p>
    </div>

    <details class="rounded-md border border-border bg-card">
      <summary class="cursor-pointer select-none px-3 py-2.5 text-xs font-semibold text-foreground">
        {{ t('settings.reader.crosspoint.editor.tokens') }}
      </summary>
      <div class="space-y-3 border-t border-border px-3 py-3">
        <p class="settings-hint">{{ t('settings.reader.crosspoint.editor.modifiersHint') }}</p>
        <div class="grid max-h-64 grid-cols-1 gap-x-4 gap-y-1.5 overflow-y-auto sm:grid-cols-2">
          <div v-for="token in PATTERN_TOKENS" :key="token.token" class="flex min-w-0 gap-2 text-xs">
            <code class="shrink-0 font-mono text-foreground">{{ '{' + token.token + '}' }}</code>
            <span class="min-w-0 text-muted-foreground">{{ token.description }}</span>
          </div>
        </div>
      </div>
    </details>
  </div>
</template>
