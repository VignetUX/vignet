import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WeatherWidget } from './WeatherWidget'
import { getCurrentWeather } from '../services/weatherService'

// This test file is a fixture for testing jibe workshop module mocking support.
// vi.mock replaces the entire weatherService module so getCurrentWeather becomes
// a vi.fn() that tests can configure — the real fetch never runs.
vi.mock('../services/weatherService')

describe('WeatherWidget', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('shows loading state', { meta: { jibe: { name: 'Loading Weather Widget' } } }, () => {
    vi.mocked(getCurrentWeather).mockReturnValue(new Promise(() => {}))
    render(<WeatherWidget city="London" />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.getByText('Fetching weather for London…')).toBeInTheDocument()
  })

  it('shows weather data', { meta: { jibe: { name: 'Weather Widget with data' } } }, async () => {
    vi.mocked(getCurrentWeather).mockResolvedValue({
      city: 'London',
      temperatureC: 18,
      description: 'Partly cloudy',
    })
    render(<WeatherWidget city="London" />)
    await screen.findByText('London')
    expect(screen.getByText('18°C')).toBeInTheDocument()
    expect(screen.getByText('Partly cloudy')).toBeInTheDocument()
  })

  it('shows error message', async () => {
    vi.mocked(getCurrentWeather).mockRejectedValue(new Error('Network error'))
    render(<WeatherWidget city="London" />)
    await screen.findByText(/Failed to load weather/)
    expect(screen.getByText(/Network error/)).toBeInTheDocument()
  })
})
