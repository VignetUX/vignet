import { test } from 'vitest'
import { workshopMount } from '../../src/index.js'
import { Button } from './Button.js'

test('primary', async () => {
  await workshopMount(<Button label="Click me" variant="primary" />)
})

test('danger', async () => {
  await workshopMount(<Button label="Delete" variant="danger" />)
})

test('ghost / disabled', async () => {
  await workshopMount(<Button label="Cancel" variant="ghost" disabled />)
})
