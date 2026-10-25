// Data comes from fixtures/. real-* scenarios are recorded from Open-Meteo Single Runs + IEM ASOS by scripts/build-real-scenario.ts.
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Field, ForecastRun, HourlyPoint, Observation } from './types'

export const SCENARIOS = ['gust-block', 'calm-go', 'forecast-miss', 'real-0729'] as const
export type ScenarioId = (typeof SCENARIOS)[number]
/** Scenario day (UTC). The first three are designed mock days; real-* are actual forecasts and observations. */
export const SCENARIO_DATE: Record<ScenarioId, string> = {
  'gust-block': '2026-06-10',
  'calm-go': '2026-06-10',
  'forecast-miss': '2026-06-10',
  'real-0729': '2026-07-29',
}

function readJson(...parts: string[]): any {
  const p = path.join(process.cwd(), 'fixtures', ...parts)
  if (!fs.existsSync(p)) throw new Error(`fixture not found: ${p}`)
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

export function loadFields(): Field[] {
  const j = readJson('common', 'fields.json')
  if (!Array.isArray(j.fields)) throw new Error('fixtures/common/fields.json: missing "fields" array')
  return j.fields as Field[]
}

export function loadForecastRuns(scenario: ScenarioId): ForecastRun[] {
  const j = readJson('nowcasting', scenario, 'snapshot-source.json')
  if (!Array.isArray(j.runs)) throw new Error(`fixtures/nowcasting/${scenario}/snapshot-source.json: missing "runs" array`)
  return j.runs as ForecastRun[]
}

export function loadObservation(scenario: ScenarioId): Observation {
  const j = readJson('nowcasting', scenario, 'observation.json')
  if (!Array.isArray(j.hourly)) throw new Error(`fixtures/nowcasting/${scenario}/observation.json: missing "hourly" array`)
  return { stationId: j.stationId, hourly: j.hourly }
}

export function knotToMph(k: number | null): number | null {
  return k == null ? null : Math.round(k * 1.151 * 100) / 100
}

export function parseIemValue(s: string): number | null {
  const t = s.trim()
  if (t === '' || t === 'M') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const HOUR_MS = 3_600_000

/**
 * IEM asos.py CSV (format=onlycomma, tz=Etc/UTC, report_type=3, data=tmpf,dwpf,sknt,gust,drct,p01i) -> hourly points.
 * Routine METARs come at :54, so each is snapped to the nearest hour. Trace precipitation (T) counts as 0.
 */
export function parseIemCsv(csv: string): HourlyPoint[] {
  const [header = '', ...rows] = csv.trim().split(/\r?\n/)
  const cols = header.split(',').map((c) => c.trim())
  const byHour = new Map<string, HourlyPoint>()
  for (const row of rows) {
    const cells = row.split(',')
    const get = (k: string) => cells[cols.indexOf(k)] ?? ''
    const ms = Date.parse(`${get('valid').trim().replace(' ', 'T')}:00Z`)
    if (Number.isNaN(ms)) continue
    const time = new Date(Math.round(ms / HOUR_MS) * HOUR_MS).toISOString().replace('.000Z', 'Z')
    const precip = get('p01i').trim()
    byHour.set(time, {
      time,
      tempF: parseIemValue(get('tmpf')),
      dewF: parseIemValue(get('dwpf')),
      windMph: knotToMph(parseIemValue(get('sknt'))),
      gustMph: knotToMph(parseIemValue(get('gust'))),
      windDirDeg: parseIemValue(get('drct')),
      precipIn: precip === 'T' ? 0 : parseIemValue(precip),
    })
  }
  return [...byHour.values()].sort((a, b) => a.time.localeCompare(b.time))
}
