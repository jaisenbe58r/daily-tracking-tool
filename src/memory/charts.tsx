import type { ReactNode } from 'react'
import { activeDay, addDays, monthName, shortDay, type Memory, type PageKey, type TramaRow } from './graph'

/**
 * One ink, four greys and the brand green only as a filled block for the
 * good days. Every mark carries `data-tip`, which the memory view shows as
 * a tooltip; every row and cell is a way to travel somewhere.
 */
const STEPS = ['var(--m1)', 'var(--m2)', 'var(--m3)', 'var(--ink)']
const step = (n: number, max: number) => (n ? STEPS[Math.min(3, Math.ceil((4 * n) / max) - 1)] : null)
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

type Go = (key: PageKey) => void

/** Month labels over a week axis. */
function monthTicks(weeks: string[]): { i: number; label: string }[] {
  const out: { i: number; label: string }[] = []
  weeks.forEach((w, i) => {
    // A week belongs to the month its Thursday falls in.
    const m = addDays(w, 3).slice(0, 7)
    if (!out.length || addDays(weeks[out[out.length - 1].i], 3).slice(0, 7) !== m) out.push({ i, label: monthName(m).split(' ')[0] })
  })
  return out
}

const weekTip = (w: string) => `Semana del ${shortDay(w)}`
const clip = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function Legend({ children }: { children?: ReactNode }) {
  return (
    <div className="m-legend">
      menos {STEPS.map((c) => <i key={c} style={{ background: c }} />)} más{children}
    </div>
  )
}

/** Rows are the pages this one crosses most, columns are weeks; a click on a row travels there, on a cell to that week's busiest day. */
export function Trama({ mem, rows, go }: { mem: Memory; rows: TramaRow[]; go: Go }) {
  const LW = 170, CW = 10, CH = 14, RH = 24, TOP = 22
  const W = LW + mem.weeks.length * (CW + 2) + 24, H = TOP + rows.length * RH
  const max = Math.max(1, ...rows.flatMap((r) => r.counts))
  const x = (i: number) => LW + i * (CW + 2)
  const busiest = (r: TramaRow, i: number) => {
    const days = new Map<string, number>()
    for (const t of r.tasks) {
      const k = activeDay(t)
      if (k >= mem.weeks[i] && k < addDays(mem.weeks[i], 7)) days.set(k, (days.get(k) ?? 0) + 1)
    }
    return [...days].sort((a, b) => b[1] - a[1])[0]?.[0] ?? mem.weeks[i]
  }
  return (
    <>
      <div className="m-scroll">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Trama: relaciones por semana">
          {monthTicks(mem.weeks).map((m) => (
            <g key={m.i}>
              <line className="m-grid" x1={x(m.i)} x2={x(m.i)} y1={TOP - 6} y2={H} />
              <text className="m-ax" x={x(m.i) + 2} y={TOP - 10}>{m.label}</text>
            </g>
          ))}
          {rows.map((r, j) => {
            const y = TOP + j * RH
            return (
              <g key={r.key}>
                {j === 0 ? (
                  <text className="m-lab m-strong" x={0} y={y + CH - 3}>{r.label}</text>
                ) : (
                  <text className="m-lab m-link" x={0} y={y + CH - 3} onClick={() => go(r.key)}>
                    <title>{r.label}</title>
                    {clip(r.label)}
                  </text>
                )}
                {r.counts.map((c, i) => {
                  const fill = step(c, max)
                  return fill ? (
                    <rect key={i} x={x(i)} y={y} width={CW} height={CH} rx={1.5} fill={fill} className="m-hit"
                      data-tip={`${weekTip(mem.weeks[i])} · ${r.label} · ${plural(c, 'tarea', 'tareas')}`}
                      onClick={() => go(`d:${busiest(r, i)}`)} />
                  ) : (
                    <rect key={i} x={x(i) + CW / 2 - 1} y={y + CH / 2 - 1} width={2} height={2} fill="var(--m1)" />
                  )
                })}
              </g>
            )
          })}
        </svg>
      </div>
      <Legend> · una fila lleva a su página, una celda al día</Legend>
    </>
  )
}

/** A square per day: darker with more closed tasks, green when the day ended at zero. */
export function Pulso({ mem, closedOn, zero, go }: { mem: Memory; closedOn: Map<string, number>; zero: Set<string>; go: Go }) {
  const C = 11, G = 2, LW = 22, TOP = 18
  const W = LW + mem.weeks.length * (C + G), H = TOP + 7 * (C + G)
  const max = Math.max(1, ...closedOn.values())
  const cells: ReactNode[] = []
  mem.weeks.forEach((w, i) => {
    for (let r = 0; r < 7; r++) {
      const d = addDays(w, r)
      if (d > mem.today) break
      const n = closedOn.get(d) ?? 0
      const fill = zero.has(d) ? 'var(--green)' : (step(n, max) ?? 'var(--wash-strong)')
      cells.push(
        <rect key={d} x={LW + i * (C + G)} y={TOP + r * (C + G)} width={C} height={C} rx={1.5} fill={fill} className="m-hit"
          data-tip={`${shortDay(d)} · ${plural(n, 'cierre', 'cierres')}${zero.has(d) ? ' · a cero' : ''}`} onClick={() => go(`d:${d}`)} />,
      )
    }
  })
  return (
    <>
      <div className="m-scroll">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pulso: cierres por día">
          {monthTicks(mem.weeks).map((m) => <text key={m.i} className="m-ax" x={LW + m.i * (C + G)} y={11}>{m.label}</text>)}
          {['L', 'X', 'V'].map((l, i) => <text key={l} className="m-ax" x={0} y={TOP + i * 2 * (C + G) + 9}>{l}</text>)}
          {cells}
        </svg>
      </div>
      <Legend><span className="m-gap" /><i style={{ background: 'var(--green)' }} /> a cero</Legend>
    </>
  )
}

const bar = (x: number, base: number, w: number, h: number, up = true) =>
  up
    ? `M${x},${base} v${-(h - 2)} q0,-2 2,-2 h${w - 4} q2,0 2,2 v${h - 2} z`
    : `M${x},${base} v${h - 2} q0,2 2,2 h${w - 4} q2,0 2,-2 v${-(h - 2)} z`

/** One strip per project, closed tasks per week on a shared scale. */
export function Estratos({ mem, rows, go }: { mem: Memory; rows: { key: PageKey; label: string; counts: number[] }[]; go: Go }) {
  const LW = 170, BW = 9, G = 3, RH = 34, TOP = 18
  const W = LW + mem.weeks.length * (BW + G), H = TOP + rows.length * RH
  const max = Math.max(1, ...rows.flatMap((r) => r.counts))
  return (
    <div className="m-scroll">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Estratos: cierres por semana y proyecto">
        {monthTicks(mem.weeks).map((m) => <text key={m.i} className="m-ax" x={LW + m.i * (BW + G)} y={11}>{m.label}</text>)}
        {rows.map((r, j) => {
          const base = TOP + j * RH + RH - 6
          return (
            <g key={r.key}>
              <line className="m-grid" x1={LW} x2={W} y1={base + 0.5} y2={base + 0.5} />
              <text className={`m-lab${r.key ? ' m-link' : ''}`} x={0} y={base - 3} onClick={r.key ? () => go(r.key) : undefined}>
                <title>{r.label}</title>
                {clip(r.label)}
              </text>
              {r.counts.map((c, i) => {
                if (!c) return null
                const x = LW + i * (BW + G)
                return (
                  <g key={i}>
                    <path d={bar(x, base, BW, Math.max(3, ((RH - 10) * c) / max))} fill="var(--ink)" />
                    <rect x={x - 1} y={base - RH + 6} width={BW + 2} height={RH} className="m-hit m-clear"
                      data-tip={`${r.label} · ${weekTip(mem.weeks[i])} · ${plural(c, 'cierre', 'cierres')}`}
                      onClick={r.key ? () => go(r.key) : undefined} />
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Horizontal bars with direct values; `hi` bars in ink, the rest grey. */
export function Bars({ items, unit }: { items: { label: string; n: number; hi?: boolean }[]; unit: string }) {
  const LW = 90, BW = 420, RH = 26, W = LW + BW + 60, H = items.length * RH
  const max = Math.max(1, ...items.map((i) => i.n))
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W }} role="img" aria-label={unit}>
      {items.map((it, i) => {
        const y = i * RH, w = it.n ? Math.max(6, (BW * it.n) / max) : 0
        return (
          <g key={it.label} className="m-hit" data-tip={`${it.label} · ${it.n} ${unit}`}>
            <rect x={0} y={y} width={W} height={RH} className="m-clear" />
            <text className="m-ax" x={0} y={y + 15}>{it.label}</text>
            {w > 0 && <path d={`M${LW},${y + 5} h${w - 4} q4,0 4,4 v6 q0,4 -4,4 h${-(w - 4)} z`} fill={it.hi ? 'var(--ink)' : 'var(--m2)'} />}
            <text className="m-val" x={LW + w + 8} y={y + 16}>{it.n}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** Closed minus written, per week: ink when the list went down, grey when it grew. */
export function Balance({ mem, closed, written }: { mem: Memory; closed: number[]; written: number[] }) {
  const net = closed.map((c, i) => c - written[i])
  const max = Math.max(1, ...net.map(Math.abs))
  const BW = 9, G = 3, LW = 30, H = 120, MID = 60
  const W = LW + mem.weeks.length * (BW + G)
  return (
    <>
      <div className="m-scroll">
        <svg width={W} height={H + 16} viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label="Balance semanal">
          <text className="m-ax" x={0} y={MID - 40}>+{max}</text>
          <text className="m-ax" x={0} y={MID + 48}>−{max}</text>
          {net.map((v, i) => {
            const x = LW + i * (BW + G)
            const h = Math.max(3, (50 * Math.abs(v)) / max)
            return (
              <g key={i}>
                {v !== 0 && <path d={bar(x, MID, BW, h, v > 0)} fill={v > 0 ? 'var(--ink)' : 'var(--m2)'} />}
                <rect x={x - 1} y={0} width={BW + 2} height={H} className="m-hit m-clear"
                  data-tip={`${weekTip(mem.weeks[i])} · ${closed[i]} cerradas, ${written[i]} escritas · ${v > 0 ? '+' : ''}${v}`} />
              </g>
            )
          })}
          <line className="m-base" x1={LW} x2={W} y1={MID} y2={MID} />
          {monthTicks(mem.weeks).map((m) => <text key={m.i} className="m-ax" x={LW + m.i * (BW + G)} y={H + 12}>{m.label}</text>)}
        </svg>
      </div>
      <div className="m-legend"><i style={{ background: 'var(--ink)' }} /> la lista bajó <span className="m-gap" /><i style={{ background: 'var(--m2)' }} /> la lista creció</div>
    </>
  )
}
