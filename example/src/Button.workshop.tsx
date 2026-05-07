import { test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from './Button.js'

test('primary', () => {
  render(<Button label="Click me" variant="primary" />)
  expect(screen.getByRole('button', { name: 'Click me' })).toBeTruthy()
})

test('danger', () => {
  render(<Button label="Delete" variant="danger" />)
  expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
})

test('ghost / disabled', () => {
  render(<Button label="Cancel" variant="ghost" disabled />)
  expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
})
