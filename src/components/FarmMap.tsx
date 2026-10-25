'use client'

// 위성 영상(Sentinel-2 cloudless) 위에 필지를 면적대로 세워 그리는 3D 지도. 필지 색과 높이 = 올해 예상 생산량 또는 위험점수
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useMemo, useRef } from 'react'
import Map, { Layer, NavigationControl, Source, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre'
import { setWorkerUrl, type StyleSpecification } from 'maplibre-gl'
import type { Field } from '@/core/types'

// MapLibre 6의 워커 파일은 번들러가 제공하지 못해 public/에 두고 주소를 지정한다 (node_modules/maplibre-gl/dist에서 복사, 버전 6.13.0)
setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')

export interface MapField extends Field { risk: Record<string, number>; yieldPct: number }
export type ColorBy = 'yield' | 'frost' | 'excess_rain' | 'drought'

const SATELLITE: StyleSpecification = {
  version: 8,
  sources: {
    s2: {
      type: 'raster',
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'],
      tileSize: 256,
      maxzoom: 15,
      attribution: '<a href="https://s2maps.eu" target="_blank" rel="noreferrer">Sentinel-2 cloudless 2024</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)',
    },
  },
  layers: [{ id: 's2', type: 'raster', source: 's2' }],
}
const STREETS = 'https://tiles.openfreemap.org/styles/positron'

/** 필지를 면적에 맞는 정사각형으로 (1 acre = 4,046.86 m²) */
function square(f: Field) {
  const side = Math.sqrt(f.acres * 4046.86)
  const dLat = side / 2 / 111_320
  const dLon = side / 2 / (111_320 * Math.cos((f.lat * Math.PI) / 180))
  return [[
    [f.lon - dLon, f.lat - dLat], [f.lon + dLon, f.lat - dLat], [f.lon + dLon, f.lat + dLat], [f.lon - dLon, f.lat + dLat], [f.lon - dLon, f.lat - dLat],
  ]]
}

export function FarmMap({ fields, selected, highlighted, colorBy, satellite, onSelect }: {
  fields: MapField[]; selected: string | null; highlighted: string[]; colorBy: ColorBy; satellite: boolean; onSelect: (id: string) => void
}) {
  const data = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: fields.map((f) => ({
      type: 'Feature' as const,
      id: f.id,
      properties: {
        id: f.id,
        name: f.name,
        value: colorBy === 'yield' ? f.yieldPct : f.risk[colorBy] ?? 0,
        selected: f.id === selected ? 1 : 0,
        highlighted: highlighted.includes(f.id) ? 1 : 0,
      },
      geometry: { type: 'Polygon' as const, coordinates: square(f) },
    })),
  }), [fields, colorBy, selected, highlighted])
  // 멀리서 볼 때는 필지가 몇 픽셀이라 중심점 원으로 보여 준다
  const points = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: data.features.map((ft, i) => ({ ...ft, geometry: { type: 'Point' as const, coordinates: [fields[i].lon, fields[i].lat] } })),
  }), [data, fields])

  // 생산량: 낮을수록 흙색, 높을수록 캐노피 녹색 / 위험점수: 높을수록 흙색
  const fill = colorBy === 'yield'
    ? ['interpolate', ['linear'], ['get', 'value'], 80, '#7a4a2a', 90, '#c99a1e', 97, '#4e7a3a']
    : ['interpolate', ['linear'], ['get', 'value'], 0, '#4e7a3a', 50, '#c99a1e', 90, '#7a4a2a']
  // 생산량은 75~100% 사이 차이가 작아 75%를 바닥으로 늘려 보여 준다 (최대 1.5km).
  // 멀리서는 필지가 몇 픽셀이라 4배로 키우고, 가까이 갈수록 원래 높이로 줄인다
  const base = colorBy === 'yield'
    ? ['*', ['max', ['-', ['get', 'value'], 75], 0], 60]
    : ['*', ['get', 'value'], 15]
  const height = ['interpolate', ['linear'], ['zoom'], 9, ['*', base, 4], 13, base]

  // 처음 선택은 전체 보기를 유지하고, 이후 선택(클릭·검색)만 그 필지로 날아간다
  const mapRef = useRef<MapRef>(null)
  const firstSelect = useRef(true)
  useEffect(() => {
    const f = fields.find((x) => x.id === selected)
    if (!f) return
    if (firstSelect.current) { firstSelect.current = false; return }
    mapRef.current?.flyTo({ center: [f.lon, f.lat], zoom: 12, pitch: 55, duration: 1200 })
  }, [selected, fields])

  const onClick = (e: MapLayerMouseEvent) => {
    const id = e.features?.[0]?.properties?.id
    if (typeof id === 'string') onSelect(id)
  }

  const [legendLabel, lo, hi] = LEGEND[colorBy]
  return (
    <div className="relative h-full w-full">
      <Map
        ref={mapRef}
        initialViewState={{ longitude: -93.75, latitude: 41.6, zoom: 9, pitch: 50, bearing: -15 }}
        mapStyle={satellite ? SATELLITE : STREETS}
        style={{ width: '100%', height: '100%' }}
        interactiveLayerIds={['fields-fill', 'fields-dot']}
        onClick={onClick}
        cursor="pointer"
        attributionControl={{ compact: true }}
      >
        <NavigationControl position="top-left" visualizePitch />
        {/* 점 레이어를 먼저 그려 기둥이 그 위에 오게 한다 */}
        <Source id="field-points" type="geojson" data={points}>
          <Layer
            id="fields-dot"
            type="circle"
            maxzoom={12.5}
            paint={{
              'circle-color': fill as never,
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, ['case', ['==', ['get', 'selected'], 1], 9, 6], 12, ['case', ['==', ['get', 'selected'], 1], 13, 9]],
              'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], '#ffffff', ['==', ['get', 'highlighted'], 1], '#f4f6f2', 'rgba(0,0,0,0.5)'],
              'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 3, ['==', ['get', 'highlighted'], 1], 2.5, 1],
            }}
          />
        </Source>
        <Source id="fields" type="geojson" data={data}>
          <Layer
            id="fields-fill"
            type="fill-extrusion"
            paint={{
              'fill-extrusion-color': ['case', ['==', ['get', 'selected'], 1], '#ffffff', fill] as never,
              'fill-extrusion-height': height as never,
              'fill-extrusion-opacity': 0.85,
            }}
          />
          <Layer
            id="fields-line"
            type="line"
            paint={{
              'line-color': ['case', ['==', ['get', 'selected'], 1], '#ffffff', ['==', ['get', 'highlighted'], 1], '#f4f6f2', 'rgba(0,0,0,0.45)'],
              'line-width': ['case', ['==', ['get', 'selected'], 1], 3, ['==', ['get', 'highlighted'], 1], 2.5, 1],
            }}
          />
        </Source>
      </Map>
      <div className="pointer-events-none absolute bottom-10 right-2 rounded-sm bg-[var(--paper-2)]/90 px-2.5 py-1.5 text-xs text-[var(--ink)]">
        <p className="font-medium">색·높이 = {legendLabel}</p>
        <div className="mt-1 h-1.5 w-40 rounded-sm" style={{ background: colorBy === 'yield' ? 'linear-gradient(90deg, #7a4a2a, #c99a1e, #4e7a3a)' : 'linear-gradient(90deg, #4e7a3a, #c99a1e, #7a4a2a)' }} />
        <div className="mt-0.5 flex w-40 justify-between text-[var(--ink-2)]"><span>{lo}</span><span>{hi}</span></div>
      </div>
    </div>
  )
}

const LEGEND: Record<ColorBy, [string, string, string]> = {
  yield: ['올해 예상 생산량', '평년 80%', '97% 이상'],
  frost: ['서리 위험점수', '0', '90 이상'],
  excess_rain: ['폭우 위험점수', '0', '90 이상'],
  drought: ['가뭄 위험점수', '0', '90 이상'],
}
