import React, { useState, useEffect } from 'react'
import { Box, CircularProgress, Stack, Typography } from '@mui/material'
import { getCurrentWeather, type WeatherData } from '../services/weatherService'

interface WeatherWidgetProps {
  city: string
}

export const WeatherWidget = ({ city }: WeatherWidgetProps) => {
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getCurrentWeather(city)
      .then(data => {
        setWeather(data)
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setLoading(false)
      })
  }, [city])

  if (loading) {
    return (
      <Stack sx={{ alignItems: 'center', paddingTop: 4 }}>
        <CircularProgress />
        <Typography variant="body2" sx={{ mt: 2 }}>Fetching weather for {city}…</Typography>
      </Stack>
    )
  }

  if (error) {
    return (
      <Box sx={{ padding: 3 }}>
        <Typography color="error">Failed to load weather: {error}</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ maxWidth: 320, margin: '48px auto', padding: 3, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
      <Typography variant="h5">{weather!.city}</Typography>
      <Typography variant="h2">{weather!.temperatureC}°C</Typography>
      <Typography variant="body1" color="text.secondary">{weather!.description}</Typography>
    </Box>
  )
}
