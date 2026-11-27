import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { Collection, CrosspointSelection, Library, SmartScope } from '@bookorbit/types'

import { i18n } from '@/i18n'
import CrosspointBookSelectionFields from '../CrosspointBookSelectionFields.vue'

function makeSelection(overrides: Partial<CrosspointSelection> = {}): CrosspointSelection {
  return { mode: 'all', libraryIds: [], collectionIds: [], smartScopeIds: [], ...overrides }
}

function makeLibrary(overrides: Partial<Library> = {}): Library {
  return { id: 1, name: 'Books', displayOrder: 0, bookCount: 42, ...overrides } as Library
}

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return { id: 1, name: 'Favourites', bookCount: 5, ...overrides } as Collection
}

function makeScope(overrides: Partial<SmartScope> = {}): SmartScope {
  return { id: 1, name: 'Unread sci-fi', bookCount: 7, ...overrides } as SmartScope
}

function mountFields(selection = makeSelection()) {
  return mount(CrosspointBookSelectionFields, {
    props: {
      modelValue: selection,
      libraries: [makeLibrary(), makeLibrary({ id: 2, name: 'Comics' })],
      collections: [makeCollection()],
      smartScopes: [makeScope()],
    },
    global: { plugins: [i18n] },
  })
}

describe('CrosspointBookSelectionFields', () => {
  it('offers all books, libraries, and collections as separate modes', () => {
    const wrapper = mountFields()
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(3)
    expect(wrapper.text()).toContain('All books')
    expect(wrapper.text()).toContain('Selected libraries')
    expect(wrapper.text()).toContain('Selected collections and smart scopes')
  })

  it('emits the library mode and selected library ids', async () => {
    const wrapper = mountFields()
    const radios = wrapper.findAll('input[type="radio"]')
    await radios[1]!.setValue(true)
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([makeSelection({ mode: 'libraries' })])

    await wrapper.setProps({ modelValue: makeSelection({ mode: 'libraries' }) })
    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true)
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([makeSelection({ mode: 'libraries', libraryIds: [1] })])
  })

  it('shows collection and smart scope choices in the selected mode', () => {
    const wrapper = mountFields(makeSelection({ mode: 'selected' }))
    expect(wrapper.text()).toContain('Collections')
    expect(wrapper.text()).toContain('Smart scopes')
    expect(wrapper.text()).toContain('Favourites')
    expect(wrapper.text()).toContain('Unread sci-fi')
  })

  it('warns when the chosen mode has no choices', () => {
    const libraries = mountFields(makeSelection({ mode: 'libraries' }))
    expect(libraries.text()).toContain('Choose at least one library')

    const selected = mountFields(makeSelection({ mode: 'selected' }))
    expect(selected.text()).toContain('Choose at least one collection or smart scope')
  })
})
