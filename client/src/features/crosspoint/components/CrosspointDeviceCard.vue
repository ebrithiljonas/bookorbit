<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Ban, BookOpen, Clock, Loader2, Pencil, RefreshCw, Tablet, Trash2, Wifi } from '@lucide/vue'
import type { CrosspointDeviceInfo, CrosspointSyncStatus } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { formatDate } from '@/i18n/formatters'

const props = defineProps<{
  device: CrosspointDeviceInfo
  status: CrosspointSyncStatus | null
  syncing: boolean
  previewing: boolean
}>()

const emit = defineEmits<{ sync: []; cancel: []; edit: []; remove: [] }>()
const { t } = useI18n()

const run = computed(() => props.status?.run ?? null)
const currentBook = computed(() => props.status?.currentBook ?? null)
const isRunning = computed(() => run.value?.status === 'running')
const runStatus = computed(() => run.value?.status ?? null)
const runTotalBooks = computed(() => run.value?.totalBooks ?? 0)
const firstFailure = computed(() => run.value?.failures[0] ?? null)
const processed = computed(() => {
  const value = run.value
  if (!value) return 0
  return value.uploaded + value.skipped + value.deleted + value.failed
})
const percent = computed(() => {
  const total = run.value?.totalBooks ?? 0
  if (total <= 0) return 0
  return Math.min(100, Math.round((processed.value / total) * 100))
})
const currentPercent = computed(() => {
  const book = currentBook.value
  if (!book || book.bytes <= 0) return 0
  return Math.min(100, Math.round((book.transferred / book.bytes) * 100))
})
const selectionSummary = computed(() => {
  const selection = props.device.selection
  if (selection.mode === 'all') return t('settings.reader.crosspoint.allBooksSummary')
  if (selection.mode === 'libraries') {
    if (selection.libraryIds.length === 0) return t('settings.reader.crosspoint.noBooksSelected')
    return t('settings.reader.crosspoint.librariesSummary', { count: selection.libraryIds.length })
  }
  const total = selection.collectionIds.length + selection.smartScopeIds.length
  if (total === 0) return t('settings.reader.crosspoint.noBooksSelected')
  return t('settings.reader.crosspoint.selectedBooksSummary', {
    collections: selection.collectionIds.length,
    scopes: selection.smartScopeIds.length,
  })
})

const statusLabel = computed(() => {
  const value = runStatus.value
  if (!value) return null
  if (value === 'completed' && (run.value?.failed ?? 0) > 0) {
    return t('settings.reader.crosspoint.activity.status.completedWithFailures')
  }
  return t(`settings.reader.crosspoint.activity.status.${value}`)
})

const statusClass = computed(() => {
  const value = runStatus.value
  if (value === 'failed' || (value === 'completed' && (run.value?.failed ?? 0) > 0)) {
    return 'border-warning/30 bg-warning/10 text-warning'
  }
  if (value === 'cancelled' || value === 'interrupted') return 'border-border bg-muted/60 text-muted-foreground'
  if (value === 'running') return 'border-primary/30 bg-primary/10 text-primary'
  return 'border-primary/30 bg-primary/10 text-primary'
})

function formatWhen(value: string | null): string {
  return value ? formatDate(new Date(value), { dateStyle: 'medium', timeStyle: 'short' }) : t('settings.reader.crosspoint.never')
}

function requestSync(): void {
  emit('sync')
}

function requestCancel(): void {
  emit('cancel')
}

function requestEdit(): void {
  emit('edit')
}

function requestRemove(): void {
  emit('remove')
}

const statusIcon = computed(() => {
  const value = runStatus.value
  if (value === 'failed' || (value === 'completed' && (run.value?.failed ?? 0) > 0)) return AlertTriangle
  if (value === 'cancelled' || value === 'interrupted') return Ban
  if (value === 'running') return Loader2
  return RefreshCw
})
</script>

<template>
  <article class="rounded-lg border border-border bg-card p-4 shadow-xs">
    <div class="flex flex-wrap items-start gap-3">
      <div class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
        <Tablet :size="18" aria-hidden="true" />
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="truncate text-sm font-semibold text-foreground">{{ device.name }}</h3>
          <span
            v-if="statusLabel"
            class="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
            :class="statusClass"
          >
            <component :is="statusIcon" :size="11" :class="{ 'animate-spin': runStatus === 'running' }" aria-hidden="true" />
            {{ statusLabel }}
          </span>
        </div>
        <p class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span class="inline-flex items-center gap-1 font-mono">
            <Wifi :size="11" aria-hidden="true" />
            {{ device.host }}:{{ device.wsPort }}
          </span>
          <span v-if="device.deviceModel">{{ device.deviceModel }}</span>
          <span v-if="device.firmwareVersion">v{{ device.firmwareVersion }}</span>
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-1.5">
        <Button v-if="!isRunning" size="sm" :disabled="syncing || previewing" @click="requestSync">
          <Loader2 v-if="previewing" :size="13" class="animate-spin" aria-hidden="true" />
          <RefreshCw v-else :size="13" aria-hidden="true" />
          {{ syncing || previewing ? t('settings.reader.crosspoint.preparing') : t('settings.reader.crosspoint.syncNow') }}
        </Button>
        <Button v-else size="sm" variant="outline" @click="requestCancel">
          <Ban :size="13" aria-hidden="true" />
          {{ t('settings.reader.crosspoint.cancelSync') }}
        </Button>
        <Button size="icon-sm" variant="ghost" :disabled="syncing" :title="t('settings.reader.crosspoint.editReader')" @click="requestEdit">
          <Pencil :size="14" aria-hidden="true" />
        </Button>
        <Button
          size="icon-sm"
          variant="destructive-ghost"
          :disabled="syncing"
          :title="t('settings.reader.crosspoint.removeReader')"
          @click="requestRemove"
        >
          <Trash2 :size="14" aria-hidden="true" />
        </Button>
      </div>
    </div>

    <div class="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
      <p class="flex items-center gap-1.5">
        <Clock :size="12" aria-hidden="true" />
        {{ t('settings.reader.crosspoint.lastSeen', { time: formatWhen(device.lastSeenAt) }) }}
      </p>
      <p class="flex items-center gap-1.5">
        <BookOpen :size="12" aria-hidden="true" />
        {{ t('settings.reader.crosspoint.lastSync', { time: formatWhen(device.lastSyncAt) }) }}
      </p>
      <p class="min-w-0 truncate sm:col-span-2">{{ selectionSummary }}</p>
      <p v-if="device.removeMissing" class="sm:col-span-2">{{ t('settings.reader.crosspoint.removeMissingOn') }}</p>
    </div>

    <div v-if="isRunning" class="mt-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5">
      <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span class="font-medium text-foreground">
          {{ t('settings.reader.crosspoint.progressCount', { done: processed, total: runTotalBooks }) }}
        </span>
        <span class="tabular-nums text-muted-foreground">{{ percent }}%</span>
      </div>
      <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div class="h-full rounded-full bg-primary transition-[width] duration-300" :style="{ width: `${percent}%` }" />
      </div>
      <p v-if="currentBook" class="mt-2 truncate text-xs text-muted-foreground">
        {{ currentBook.title ?? t('settings.reader.crosspoint.untitledBook') }}
        <span class="tabular-nums">· {{ currentPercent }}%</span>
      </p>
      <p v-else class="mt-2 text-xs text-muted-foreground">{{ t('settings.reader.crosspoint.preparingNextBook') }}</p>
    </div>

    <div v-else-if="run" class="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2.5">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{{ t('settings.reader.crosspoint.activity.counts.uploaded', { count: run.uploaded }) }}</span>
        <span>{{ t('settings.reader.crosspoint.activity.counts.skipped', { count: run.skipped }) }}</span>
        <span>{{ t('settings.reader.crosspoint.activity.counts.deleted', { count: run.deleted }) }}</span>
        <span :class="{ 'text-destructive': run.failed > 0 }">
          {{ t('settings.reader.crosspoint.activity.counts.failed', { count: run.failed }) }}
        </span>
        <span class="ms-auto">{{ formatWhen(run.finishedAt ?? run.startedAt) }}</span>
      </div>
      <p v-if="run.error" class="mt-1.5 text-xs text-destructive">{{ run.error }}</p>
      <p v-else-if="firstFailure" class="mt-1.5 truncate text-xs text-destructive">
        {{ firstFailure.title ?? t('settings.reader.crosspoint.untitledBook') }}: {{ firstFailure.error }}
      </p>
    </div>
  </article>
</template>
