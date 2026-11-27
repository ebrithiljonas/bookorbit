import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { CrosspointDeviceInfo, CrosspointSyncStatus } from '@bookorbit/types'

import { i18n } from '@/i18n'
import CrosspointDeviceCard from '../CrosspointDeviceCard.vue'

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
    fileNamingPattern: '{library}/<{authors:first}|Unknown Author>/<{series}/>{originalFilename}',
    removeMissing: false,
    selection: { mode: 'all', libraryIds: [], collectionIds: [], smartScopeIds: [] },
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    lastSyncAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function runningStatus(): CrosspointSyncStatus {
  return {
    run: {
      id: 5,
      deviceId: 1,
      status: 'running',
      totalBooks: 4,
      uploaded: 1,
      skipped: 0,
      deleted: 0,
      failed: 0,
      totalBytes: 4_000,
      transferredBytes: 1_000,
      errorClass: null,
      error: null,
      failures: [],
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    currentBook: { id: 9, title: 'Dune', bytes: 1_000, transferred: 400 },
  }
}

describe('CrosspointDeviceCard', () => {
  it('shows the reader and emits sync, edit and remove actions', async () => {
    const wrapper = mount(CrosspointDeviceCard, {
      props: { device: makeDevice(), status: null, syncing: false, previewing: false },
      global: { plugins: [i18n] },
    })

    expect(wrapper.text()).toContain('Bedroom reader')
    expect(wrapper.text()).toContain('192.168.1.50:81')
    expect(wrapper.text()).toContain('Syncs all EPUB books')

    const sync = wrapper.findAll('button').find((button) => button.text().includes('Sync now'))
    await sync!.trigger('click')
    expect(wrapper.emitted('sync')).toHaveLength(1)

    const edit = wrapper.findAll('button').find((button) => button.attributes('title') === 'Edit reader')
    await edit!.trigger('click')
    expect(wrapper.emitted('edit')).toHaveLength(1)

    const remove = wrapper.findAll('button').find((button) => button.attributes('title') === 'Remove reader')
    await remove!.trigger('click')
    expect(wrapper.emitted('remove')).toHaveLength(1)
  })

  it('summarises a library selection', () => {
    const wrapper = mount(CrosspointDeviceCard, {
      props: {
        device: makeDevice({
          selection: { mode: 'libraries', libraryIds: [1, 2], collectionIds: [], smartScopeIds: [] },
        }),
        status: null,
        syncing: false,
        previewing: false,
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.text()).toContain('2 selected libraries')
  })

  it('shows book progress and lets the run be cancelled', async () => {
    const wrapper = mount(CrosspointDeviceCard, {
      props: { device: makeDevice(), status: runningStatus(), syncing: true, previewing: false },
      global: { plugins: [i18n] },
    })

    expect(wrapper.text()).toContain('1 of 4 books')
    expect(wrapper.text()).toContain('Dune')

    const cancel = wrapper.findAll('button').find((button) => button.text().includes('Cancel sync'))
    await cancel!.trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('shows the last error', () => {
    const wrapper = mount(CrosspointDeviceCard, {
      props: {
        device: makeDevice(),
        status: {
          run: {
            ...runningStatus().run!,
            status: 'failed',
            failed: 1,
            finishedAt: '2026-01-01T00:01:00.000Z',
            errorClass: 'Error',
            error: 'Disk full',
          },
          currentBook: null,
        },
        syncing: false,
        previewing: false,
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.text()).toContain('Disk full')
    expect(wrapper.text()).toContain('Failed')
  })
})
