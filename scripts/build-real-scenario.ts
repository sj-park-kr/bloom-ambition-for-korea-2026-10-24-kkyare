// 실데이터 나우캐스팅 시나리오 생성기. 실행: npx -y tsx scripts/build-real-scenario.ts [YYYY-MM-DD]  (기본 2026-07-29)
// 예보: Open-Meteo Single Runs API (그 시각에 실제로 발행된 run 그대로), 관측: IEM ASOS DSM 정시 관측. 둘 다 키 없이 무료.
// Open-Meteo 무료 API는 비상업 용도만 허용한다 (상업 납품 전에는 유료 구독으로 바꾼다).
// 새 날짜를 만들면 src/core/weather.ts의 SCENARIOS·SCENARIO_DATE와 replay.ts의 DEFAULT_T0에도 추가한다.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { ForecastRun, HourlyPoint } from '../src/core/types'
import { loadFields, parseIemCsv, type ScenarioId } from '../src/core/weather'
import { buildScenarioSnapshot, referenceProbability, t0sOn } from '../src/families/nowcasting/index'
import { evaluateWindow } from '../src/families/nowcasting/rules'

const DATE = process.argv[2] ?? '2026-07-29'
const ID = `real-${DATE.slice(5, 7)}${DATE.slice(8, 10)}` as ScenarioId
const OUT = join(resolve(dirname(process.argv[1]), '..'), 'fixtures', 'nowcasting', ID)
const DSM = { lat: 41.534, lon: -93.653 }
const MODELS = ['ncep_hrrr_conus', 'ncep_nbm_conus', 'gfs_seamless', 'ecmwf_ifs025']
const HOUR = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z')
const day0 = Date.parse(`${DATE}T00:00:00Z`)
// 설계 시나리오와 같은 구조: 전날 12Z run과 당일 00Z run, 결정 시각은 당일 12~22Z라 두 run 모두 이미 공개된 뒤다
const RUNS = [iso(day0 - 12 * HOUR), iso(day0)]

async function getJson(url: string): Promise<any> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

async function forecastRun(model: string, issuedAt: string): Promise<ForecastRun> {
  const j = await getJson(`https://single-runs-api.open-meteo.com/v1/forecast?latitude=${DSM.lat}&longitude=${DSM.lon}&models=${model}&run=${issuedAt.slice(0, 16)}` +
    '&hourly=temperature_2m,dew_point_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation' +
    '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&forecast_hours=48')
  const h = j.hourly
  if (!h || h.time.length !== 48) throw new Error(`${model}@${issuedAt}: expected 48 hours, got ${h?.time?.length}`)
  return {
    model, issuedAt, gridElevationM: j.elevation,
    hourly: h.time.map((t: string, i: number): HourlyPoint => ({
      time: `${t}:00Z`, tempF: h.temperature_2m[i], dewF: h.dew_point_2m[i],
      windMph: h.wind_speed_10m[i], gustMph: h.wind_gusts_10m[i], windDirDeg: h.wind_direction_10m[i], precipIn: h.precipitation[i],
    })),
  }
}

async function observation(): Promise<HourlyPoint[]> {
  const from = new Date(day0 - 24 * HOUR), to = new Date(day0 + 48 * HOUR)
  const d = (x: Date, n: 1 | 2) => `year${n}=${x.getUTCFullYear()}&month${n}=${x.getUTCMonth() + 1}&day${n}=${x.getUTCDate()}`
  const r = await fetch(`https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=DSM&data=tmpf&data=dwpf&data=sknt&data=gust&data=drct&data=p01i&${d(from, 1)}&${d(to, 2)}&tz=Etc/UTC&format=onlycomma&latlon=no&missing=M&trace=T&report_type=3`)
  if (!r.ok) throw new Error(`IEM ${r.status}`)
  const byTime = new Map(parseIemCsv(await r.text()).map((p) => [p.time, p]))
  // 72시간 격자를 채운다. 관측이 빠진 시각은 전부 null (지어내지 않는다)
  return Array.from({ length: 72 }, (_, i) => {
    const time = iso(from.getTime() + i * HOUR)
    return byTime.get(time) ?? { time, tempF: null, dewF: null, windMph: null, gustMph: null, windDirDeg: null, precipIn: null }
  })
}

const LABEL: Record<string, string> = { ncep_hrrr_conus: 'HRRR', ncep_nbm_conus: 'NBM', gfs_seamless: 'GFS', ecmwf_ifs025: 'ECMWF IFS' }
const source = {
  forecast: 'Open-Meteo Single Runs API, https://open-meteo.com (CC BY 4.0)',
  observation: 'Iowa Environmental Mesonet ASOS DSM 정시 관측, https://mesonet.agron.iastate.edu',
}

async function main() {
  const runs = (await Promise.all(MODELS.flatMap((m) => RUNS.map((r) => forecastRun(m, r))))).sort((a, b) => a.model.localeCompare(b.model) || a.issuedAt.localeCompare(b.issuedAt))
  const hourly = await observation()
  const latest = (t0: string) => MODELS.map((m) => runs.filter((r) => r.model === m && r.issuedAt <= t0).at(-1)!)

  const windows = t0sOn(DATE).map((t0) => ({
    start: iso(Date.parse(t0)),
    violation: evaluateWindow(hourly, t0).violation,
    basis: 'observation',
    forecast: Object.fromEntries(latest(t0).map((r) => [r.model, evaluateWindow(r.hourly, t0).violation])),
  }))
  const wrong = (m: string) => windows.filter((w) => w.forecast[m] !== w.violation).length
  const story = `실제 관측(IEM ASOS DSM) 기준, ${DATE} 살포 시작 시각 11개(12~22Z) 중 ${windows.filter((w) => w.violation).length}개가 살포 조건 위반이었다. ` +
    `당일 00Z 예보 판정이 실측과 다른 시각: ${MODELS.map((m) => `${LABEL[m]} ${wrong(m)}개`).join(', ')}.`

  // 재생(/live)용 저장 답: 첫 위반 시각에 공개 예보 4개 합의를 비용-손실 기준으로 따른 기준선. Claude 답이 아니다
  const t0 = windows.find((w) => w.violation)?.start ?? windows[0].start
  const snapshot = buildScenarioSnapshot(loadFields()[0], t0, ID, runs, { stationId: 'DSM', hourly })
  const p = Math.round(referenceProbability(snapshot) * 100) / 100
  const flagged = snapshot.forecasts.filter((f) => evaluateWindow(f.hourly, t0).violation).map((f) => LABEL[f.model])
  const answer = {
    demo: true,
    model: 'public-forecast-consensus (saved)',
    probability: p,
    decision: p > 7 / 31 ? 'delay' : 'spray',
    rationale: `공개 예보 ${snapshot.forecasts.length}개 중 ${flagged.length}개(${flagged.join(', ') || '없음'})가 앞으로 4시간 살포 조건 위반을 예보했다. ` +
      `위반 확률 p = ${p}일 때 미루는 비용 $7가 위반 손실 $31 × ${p}보다 ${p > 7 / 31 ? '작아 미룬다' : '커서 살포한다'}.`,
  }

  mkdirSync(OUT, { recursive: true })
  const write = (name: string, data: unknown) => writeFileSync(join(OUT, name), JSON.stringify(data, null, 2) + '\n')
  const fetchedAt = iso(Math.floor(Date.now() / 1000) * 1000)
  write('snapshot-source.json', { demo: false, scenario: ID, source: source.forecast, fetchedAt, runs })
  write('observation.json', { demo: false, source: source.observation, fetchedAt, stationId: 'DSM', hourly })
  write('meta.json', { demo: false, date: DATE, source, fetchedAt, story, expected: { windowHours: 4, defaultT0: t0, windows } })
  write('answer.json', answer)
  console.log(`wrote ${OUT}\n${story}\ndefault t0 ${t0}: p=${p} ${answer.decision}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
