export const palette = {
  ground: '#fbfcfd',
  backdrop: '#eef2f5',
  grid: '#e3e8ee',
  steel: '#9aa4ae',
  steelDark: '#6b7682',
  concrete: '#dfe3e8',
  wall: '#f4f6f8',
  roof: '#5b6774',
  insulator: '#b3261e',
  transformer: '#55606b',
  cable: '#4a5561',
  flow: '#f26b1d',
  accent: '#0e6e8c',
  ink: '#0f1b2a',
  zones: ['#cfe3f7', '#fbdcc9', '#cdeee4', '#e2dbf6', '#f6e7b8', '#d7ecf9'],
}

/**
 * Meter colour by voltage band. MV networks are typically allowed ±10 % (EN 50160), so
 * amber means "low but within limits" and red means "outside limits".
 */
export const VOLTAGE_BANDS = { nominal: 0.97, limit: 0.9 }

export function voltageColor(vm: number | null): string {
  if (vm === null) return '#a7b0ba'
  if (vm >= VOLTAGE_BANDS.nominal) return '#17a673'
  if (vm >= VOLTAGE_BANDS.limit) return '#e9a23b'
  return '#d64545'
}

export function voltageLabel(vm: number | null): string {
  if (vm === null) return 'No reading'
  if (vm >= VOLTAGE_BANDS.nominal) return 'Nominal'
  if (vm >= VOLTAGE_BANDS.limit) return 'Low, within limits'
  return 'Outside limits'
}
