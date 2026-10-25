import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { assertNoLeak } from '../../core/snapshot'
import { loadFields, loadForecastRuns, loadObservation, parseIemCsv } from '../../core/weather'
import { buildDemoTasks, buildScenarioSnapshot } from './index'
import { buildReplay } from './replay'
import { evaluateWindow } from './rules'

describe('parseIemCsv', () => {
  it(':54 정시 관측을 가까운 정시로, knot을 mph로, M은 null, 흔적 강수 T는 0', () => {
    const csv = 'station,valid,tmpf,dwpf,sknt,gust,drct,p01i\nDSM,2026-07-29 15:54,84.0,66.0,7.00,M,180.00,0.00\r\nDSM,2026-07-29 18:54,86.0,67.0,9.00,15.00,200.00,T\n'
    expect(parseIemCsv(csv)).toEqual([
      { time: '2026-07-29T16:00:00Z', tempF: 84, dewF: 66, windMph: 8.06, gustMph: null, windDirDeg: 180, precipIn: 0 },
      { time: '2026-07-29T19:00:00Z', tempF: 86, dewF: 67, windMph: 10.36, gustMph: 17.27, windDirDeg: 200, precipIn: 0 },
    ])
  })
})

describe('실데이터 시나리오 real-0729', () => {
  const runs = loadForecastRuns('real-0729')
  const obs = loadObservation('real-0729')
  const t0 = '2026-07-29T16:00:00Z'
  const snap = buildScenarioSnapshot(loadFields()[0], t0, 'real-0729', runs, obs)
  const meta = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'fixtures', 'nowcasting', 'real-0729', 'meta.json'), 'utf8'))

  it('실제 예보·관측 표시와 출처가 있다', () => {
    expect(meta.demo).toBe(false)
    expect(meta.source.forecast).toContain('Open-Meteo')
    expect(obs.hourly).toHaveLength(72)
  })

  it('16Z 스냅샷은 미래 정보가 없고 당일 00Z run을 쓴다', () => {
    expect(assertNoLeak(snap)).toEqual([])
    expect(snap.forecasts.map(f => f.issuedAt)).toEqual(Array(4).fill('2026-07-29T00:00:00Z'))
  })

  it('HRRR은 살포 가능으로 예보했지만 실측은 위반 (meta.story와 같은 판정)', () => {
    const hrrr = snap.forecasts.find(f => f.model === 'ncep_hrrr_conus')!
    expect(evaluateWindow(hrrr.hourly, t0).violation).toBe(false)
    expect(evaluateWindow(obs.hourly, t0).violation).toBe(true)
  })

  it('재생은 저장된 기준선 답을 실측으로 채점한다', () => {
    const r = buildReplay('real-0729')
    expect(r.task.t0).toBe('2026-07-29T16:00:00.000Z')
    expect(r.verdict.violation).toBe(true)
    expect(r.score.resolvedWith?.stationId).toBe('DSM')
  })

  it('목업 과제 id는 그대로이고 실데이터 과제는 뒤에 붙는다', () => {
    const { tasks } = buildDemoTasks(Number.MAX_SAFE_INTEGER)
    expect(tasks[0]).toMatchObject({ id: 'task-nc-0001', t0: '2026-06-10T12:00:00.000Z' })
    const real = tasks.filter(t => t.snapshotId.endsWith('@real-0729'))
    expect(real).toHaveLength(11 * 8)
    expect(tasks.indexOf(real[0])).toBe(11 * 3 * 8)
  })
})
