// 공개 예보만으로 한 살포 판단이 실측과 얼마나 어긋나는지 (실데이터 백테스트). 실행: npx -y tsx scripts/backtest-spray-windows.ts [시작일] [종료일]
// 날마다 당일 00Z run(Open-Meteo Single Runs)과 IEM ASOS DSM 실측을 같은 규칙(rules.ts evaluateWindow)으로 판정해 12~22Z 시작 11개 창을 비교한다.
import { parseIemCsv } from '../src/core/weather'
import type { HourlyPoint } from '../src/core/types'
import { t0sOn } from '../src/families/nowcasting/index'
import { evaluateWindow } from '../src/families/nowcasting/rules'

const [FROM = '2026-06-01', TO = '2026-08-31'] = process.argv.slice(2)
const MODELS: Record<string, string> = { ncep_hrrr_conus: 'HRRR', ncep_nbm_conus: 'NBM', gfs_seamless: 'GFS', ecmwf_ifs025: 'ECMWF IFS' }
const DAY = 86_400_000

async function forecast(model: string, date: string): Promise<HourlyPoint[]> {
  const r = await fetch(`https://single-runs-api.open-meteo.com/v1/forecast?latitude=41.534&longitude=-93.653&models=${model}&run=${date}T00:00` +
    '&hourly=wind_speed_10m,wind_gusts_10m,precipitation&wind_speed_unit=mph&precipitation_unit=inch&forecast_hours=36')
  const h = (await r.json()).hourly
  if (!h) return []
  return h.time.map((t: string, i: number) => ({ time: `${t}:00Z`, tempF: null, windMph: h.wind_speed_10m[i], gustMph: h.wind_gusts_10m[i], precipIn: h.precipitation[i] }))
}

async function main() {
  const end = new Date(Date.parse(TO) + 2 * DAY)
  const q = (d: Date, n: 1 | 2) => `year${n}=${d.getUTCFullYear()}&month${n}=${d.getUTCMonth() + 1}&day${n}=${d.getUTCDate()}`
  const csv = await (await fetch(`https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=DSM&data=sknt&data=gust&data=p01i&${q(new Date(FROM), 1)}&${q(end, 2)}&tz=Etc/UTC&format=onlycomma&latlon=no&missing=M&trace=T&report_type=3`)).text()
  const obs = parseIemCsv(csv)

  const tally = Object.fromEntries(Object.keys(MODELS).map((m) => [m, { n: 0, wrong: 0, missed: 0, falseAlarm: 0 }]))
  let windows = 0, violations = 0
  for (let d = Date.parse(FROM); d <= Date.parse(TO); d += DAY) {
    const date = new Date(d).toISOString().slice(0, 10)
    const runs = await Promise.all(Object.keys(MODELS).map(async (m) => [m, await forecast(m, date)] as const))
    for (const t0 of t0sOn(date)) {
      const y = evaluateWindow(obs, t0).violation
      windows++; violations += +y
      for (const [m, hourly] of runs) {
        if (hourly.length === 0) continue
        const p = evaluateWindow(hourly, t0).violation
        const t = tally[m]
        t.n++
        if (p !== y) { t.wrong++; if (y) t.missed++; else t.falseAlarm++ }
      }
    }
  }
  const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`
  console.log(`${FROM} ~ ${TO}, DSM, 살포 시작 창 ${windows}개, 실측 위반 ${pct(violations, windows)}`)
  for (const [m, t] of Object.entries(tally))
    console.log(`${MODELS[m].padEnd(9)} 판정 불일치 ${pct(t.wrong, t.n)} (n=${t.n}) · 위반을 놓침 ${t.missed} · 괜히 막음 ${t.falseAlarm}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
