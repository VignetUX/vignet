import { test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AliasDemo } from '@/components/AliasDemo.js'

test('renders', { meta: { vignet: { name: 'Alias Demo' } } }, () => {
  render(<AliasDemo />)
  expect(screen.getByRole('button', { name: 'Resolved via @ alias' })).toBeTruthy()
})
