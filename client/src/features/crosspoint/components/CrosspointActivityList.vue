<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Ban, CheckCircle2, Clock, History, Loader2, RefreshCw, Tablet } from '@lucide/vue'
import type { CrosspointDeviceInfo, CrosspointSyncRun } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { formatDate } from '@/i18n/formatters'

const props = defineProps<{
  devices: CrosspointDeviceInfo[]
  runs: CrosspointSyncRun[]
  loading: boolean
  selectedDeviceId: number | null
}>()

const emit = defineEmits<{ 'select-device': [id: number]; refresh: [] }>()
const { t } = useI18n()

const selectedDevice = computed(() => props.devices.find((device) => device.id === props.selectedDeviceId) ?? null)

function handleDeviceChange(event: Event): void {
  const value = Number((event.target as HTMLSelectElement).value)
  if (Number.isInteger(value) && value > 0) emit('select-device', value)
}

function requestRefresh(): void {
  emit('refresh')
}

function formatWhen(value: string | null): string {
  return value ? formatDate(new Date(value), { dateStyle: 'medium', timeStyle: 'short' }) : t('settings.reader.crosspoint.never')
}

function formatDuration(run: CrosspointSyncRun): string {
  if (!run.finishedAt) return t('settings.reader.crosspoint.activity.inProgress')
  const ms = Math.max(0, new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime())
  if (ms < 1000) return `${ms} ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

function statusLabel(run: CrosspointSyncRun): string {
  if (run.status === 'completed' && run.failed > 0) {
    return t('settings.reader.crosspoint.activity.status.completedWithFailures')
  }
  return t(`settings.reader.crosspoint.activity.status.${run.status}`)
}

function statusClass(run: CrosspointSyncRun): string {
  if (run.status === 'failed' || (run.status === 'completed' && run.failed > 0)) {
    return 'border-warning/30 bg-warning/10 text-warning'
  }
  if (run.status === 'cancelled' || run.status === 'interrupted') return 'border-border bg-muted/60 text-muted-foreground'
  if (run.status === 'running') return 'border-primary/30 bg-primary/10 text-primary'
  return 'border-primary/30 bg-primary/10 text-primary'
}

function statusIcon(run: CrosspointSyncRun) {
  if (run.status === 'failed' || (run.status === 'completed' && run.failed > 0)) return AlertTriangle
  if (run.status === 'cancelled' || run.status === 'interrupted') return Ban
  if (run.status === 'running') return Loader2
  return CheckCircle2
}

function firstFailure(run: CrosspointSyncRun) {
  return run.failures[0] ?? null
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <Tablet :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
        <label for="crosspoint-activity-device" class="sr-only">{{ t('settings.reader.crosspoint.activity.selectReader') }}</label>
        <select
          id="crosspoint-activity-device"
          :value="selectedDeviceId ?? ''"
          class="input-field h-9 min-w-0 max-w-xs flex-1"
          :disabled="devices.length === 0"
          @change="handleDeviceChange"
        >
          <option v-if="devices.length === 0" value="">{{ t('settings.reader.crosspoint.activity.noReaders') }}</option>
          <option v-for="device in devices" :key="device.id" :value="device.id">{{ device.name }}</option>
        </select>
      </div>
      <Button variant="outline" size="sm" :disabled="loading || !selectedDevice" @click="requestRefresh">
        <RefreshCw :size="13" :class="{ 'animate-spin': loading }" aria-hidden="true" />
        {{ t('settings.reader.crosspoint.activity.refresh') }}
      </Button>
    </div>

    <div v-if="!selectedDevice" class="rounded-lg border border-border bg-card px-5 py-10 text-center">
      <div class="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted">
        <History :size="18" class="text-muted-foreground" aria-hidden="true" />
      </div>
      <p class="text-sm font-medium text-foreground">{{ t('settings.reader.crosspoint.activity.noReadersTitle') }}</p>
      <p class="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">{{ t('settings.reader.crosspoint.activity.noReadersHint') }}</p>
    </div>

    <div v-else-if="loading && runs.length === 0" class="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 :size="14" class="animate-spin" aria-hidden="true" />
      {{ t('settings.reader.crosspoint.activity.loading') }}
    </div>

    <div v-else-if="runs.length === 0" class="rounded-lg border border-border bg-card px-5 py-10 text-center">
      <div class="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted">
        <History :size="18" class="text-muted-foreground" aria-hidden="true" />
      </div>
      <p class="text-sm font-medium text-foreground">{{ t('settings.reader.crosspoint.activity.emptyTitle') }}</p>
      <p class="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">{{ t('settings.reader.crosspoint.activity.emptyHint') }}</p>
    </div>

    <div v-else class="space-y-2">
      <article v-for="run in runs" :key="run.id" class="rounded-lg border border-border bg-card px-4 py-3 shadow-xs">
        <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                :class="statusClass(run)"
              >
                <component :is="statusIcon(run)" :size="11" :class="{ 'animate-spin': run.status === 'running' }" aria-hidden="true" />
                {{ statusLabel(run) }}
              </span>
              <span class="text-xs text-muted-foreground">{{ formatWhen(run.startedAt) }}</span>
              <span class="text-xs text-muted-foreground">· {{ formatDuration(run) }}</span>
            </div>

            <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{{ t('settings.reader.crosspoint.activity.counts.uploaded', { count: run.uploaded }) }}</span>
              <span>{{ t('settings.reader.crosspoint.activity.counts.skipped', { count: run.skipped }) }}</span>
              <span>{{ t('settings.reader.crosspoint.activity.counts.deleted', { count: run.deleted }) }}</span>
              <span :class="{ 'text-destructive': run.failed > 0 }">
                {{ t('settings.reader.crosspoint.activity.counts.failed', { count: run.failed }) }}
              </span>
              <span>{{ t('settings.reader.crosspoint.activity.booksTotal', { count: run.totalBooks }) }}</span>
            </div>

            <p v-if="run.error" class="mt-2 text-xs text-destructive">{{ run.error }}</p>
            <p v-else-if="firstFailure(run)" class="mt-2 truncate text-xs text-destructive">
              {{ firstFailure(run)?.title ?? t('settings.reader.crosspoint.untitledBook') }}:
              {{ firstFailure(run)?.error }}
            </p>
          </div>

          <p class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Clock :size="11" aria-hidden="true" />
            {{ formatWhen(run.finishedAt ?? run.startedAt) }}
          </p>
        </div>
      </article>
    </div>
  </div>
</template>
