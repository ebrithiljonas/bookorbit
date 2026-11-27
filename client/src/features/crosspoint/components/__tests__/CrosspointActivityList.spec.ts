import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { CrosspointDeviceInfo, CrosspointSyncRun } from '@bookorbit/types'

import { i18n } from '@/i18n'
import CrosspointActivityList from '../CrosspointActivityList.vue'

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

function makeRun(overrides: Partial<CrosspointSyncRun> = {}): CrosspointSyncRun {
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
    ...overrides,
  }
}

describe('CrosspointActivityList', () => {
  it('shows run counts and emits refresh and device changes', async () => {
    const wrapper = mount(CrosspointActivityList, {
      props: {
        devices: [makeDevice(), makeDevice({ id: 2, name: 'Den reader' })],
        runs: [makeRun()],
        loading: false,
        selectedDeviceId: 1,
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.text()).toContain('Completed')
    expect(wrapper.text()).toContain('2 uploaded')
    expect(wrapper.text()).toContain('1 skipped')
    expect(wrapper.text()).toContain('5s')

    const refresh = wrapper.findAll('button').find((button) => button.text().includes('Refresh'))
    await refresh!.trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)

    await wrapper.find('select').setValue('2')
    expect(wrapper.emitted('select-device')).toEqual([[2]])
  })

  it('shows an empty state before the first run', () => {
    const wrapper = mount(CrosspointActivityList, {
      props: { devices: [makeDevice()], runs: [], loading: false, selectedDeviceId: 1 },
      global: { plugins: [i18n] },
    })

    expect(wrapper.text()).toContain('No sync activity yet')
  })
})
