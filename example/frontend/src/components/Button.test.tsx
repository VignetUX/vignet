import { test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from './Button.js'
import { param } from '@vignet/vignet'

test('primary', { meta: { vignet: { name: 'Primary Button' } } }, () => {
  const label    = param('label',    'Click me', { label: 'Label' })
  const variant  = param('variant',  'primary' as 'primary' | 'danger' | 'ghost', { label: 'Variant', options: ['primary', 'danger', 'ghost'] })
  const disabled = param('disabled', false,       { label: 'Disabled' })
  render(<Button label={label} variant={variant} disabled={disabled} />)
  expect(screen.getByRole('button', { name: label })).toBeTruthy()
})

test('danger', { meta: { vignet: { name: 'Danger Button' } } }, () => {
  const label = param('label', 'Delete', { label: 'Label' })
  render(<Button label={label} variant="danger" />)
  expect(screen.getByRole('button', { name: label })).toBeTruthy()
})

test('ghost / disabled', { meta: { vignet: { name: 'Ghost Button' } } }, () => {
  const label = param('label', 'Cancel', { label: 'Label' })
  render(<Button label={label} variant="ghost" disabled />)
  expect(screen.getByRole('button', { name: label }).hasAttribute('disabled')).toBe(true)
})
