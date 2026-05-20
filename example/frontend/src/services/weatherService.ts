export interface WeatherData {
  city: string
  temperatureC: number
  description: string
}

export async function getCurrentWeather(city: string): Promise<WeatherData> {
  const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`)
  if (!res.ok) throw new Error(`Weather fetch failed: ${res.status}`)
  const json = await res.json()
  return {
    city,
    temperatureC: Number(json.current_condition[0].temp_C),
    description: json.current_condition[0].weatherDesc[0].value,
  }
}
