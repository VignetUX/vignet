import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WeatherWidget } from './WeatherWidget'
import { getCurrentWeather } from '../services/weatherService'
import { param } from '@vignet/vignet'

// This test file is a fixture for testing vignet workshop module mocking support.
// vi.mock replaces the entire weatherService module so getCurrentWeather becomes
// a vi.fn() that tests can configure — the real fetch never runs.
vi.mock('../services/weatherService')

describe('WeatherWidget', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('shows loading state', { meta: { vignet: { name: 'Loading Weather Widget' } } }, () => {
    vi.mocked(getCurrentWeather).mockReturnValue(new Promise(() => { }))
    render(<WeatherWidget city="London" />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.getByText('Fetching weather for London…')).toBeInTheDocument()
  })

  it('shows weather data', { meta: { vignet: { name: 'Weather Widget with data' } } }, async () => {
    const city = param('city', 'London', { label: 'City' })
    const temperatureC = param('temperatureC', 18, { label: 'Temperature (°C)' })
    const description = param('description', 'Partly cloudy', { label: 'Description' })
    vi.mocked(getCurrentWeather).mockResolvedValue({ city, temperatureC, description })
    render(<WeatherWidget city={city} />)
    await screen.findByText(city)
    expect(screen.getByText(`${temperatureC}°C`)).toBeInTheDocument()
    expect(screen.getByText(description)).toBeInTheDocument()
  })

  it('shows error message', async () => {
    vi.mocked(getCurrentWeather).mockRejectedValue(new Error('Network error'))
    render(<WeatherWidget city="London" />)
    await screen.findByText(/Failed to load weather/)
    expect(screen.getByText(/Network error/)).toBeInTheDocument()
  })
})
