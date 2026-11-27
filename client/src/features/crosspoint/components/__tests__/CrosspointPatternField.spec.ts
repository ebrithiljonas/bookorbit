import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { CROSSPOINT_DEFAULT_FILE_NAMING_PATTERN } from '@bookorbit/types'

import { i18n } from '@/i18n'
import CrosspointPatternField from '../CrosspointPatternField.vue'

describe('CrosspointPatternField', () => {
  it('previews the shipped default pattern', () => {
    const wrapper = mount(CrosspointPatternField, {
      props: { modelValue: CROSSPOINT_DEFAULT_FILE_NAMING_PATTERN, rootFolder: '/BookOrbit' },
      global: { plugins: [i18n] },
    })

    expect(wrapper.text()).toContain('/BookOrbit/Books/William Gibson/Sprawl/neuromancer.epub')
  })

  it('previews the resolved path under the managed folder', async () => {
    const wrapper = mount(CrosspointPatternField, {
      props: { modelValue: '<{authors:first} - >{title}', rootFolder: '/BookOrbit' },
      global: { plugins: [i18n] },
    })

    expect(wrapper.text()).toContain('/BookOrbit/William Gibson - Neuromancer.epub')

    await wrapper.find('textarea').setValue('E2E/{title}')
    await wrapper.setProps({ modelValue: 'E2E/{title}' })
    expect(wrapper.text()).toContain('/BookOrbit/E2E/Neuromancer.epub')
  })

  it('reports a pattern that would escape the managed folder', async () => {
    const wrapper = mount(CrosspointPatternField, {
      props: { modelValue: '/absolute/{title}', rootFolder: '/BookOrbit' },
      global: { plugins: [i18n] },
    })

    expect(wrapper.text()).toContain('must be relative')
    expect(wrapper.find('textarea').attributes('aria-invalid')).toBe('true')
  })

  it('resets to the shipped default', async () => {
    const wrapper = mount(CrosspointPatternField, {
      props: { modelValue: 'Custom/{title}', rootFolder: '/BookOrbit' },
      global: { plugins: [i18n] },
    })

    const reset = wrapper.findAll('button').find((button) => button.text().includes('Reset'))
    await reset!.trigger('click')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([CROSSPOINT_DEFAULT_FILE_NAMING_PATTERN])
  })
})
