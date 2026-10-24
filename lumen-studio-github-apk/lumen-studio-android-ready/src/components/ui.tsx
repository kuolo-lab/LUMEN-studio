import React, { useEffect, useRef, useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import { type CurvePoint, type HistogramDataSource } from './curveTypes';
import { buildCurveLUT, clamp } from '../lib/adjust';

// ---------- Slider ----------
export function Slider(props: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; unit?: string; defaultValue?: number; fine?: boolean;
}) {
  const { label, value, min, max, step = 1, onChange, unit = '', defaultValue = 0 } = props;
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div
      className="group py-1"
      onDoubleClick={() => onChange(defaultValue)}
      title="Double-tap to reset"
    >
      <div className="mb-0.5 flex items-baseline justify-between">
        <span className="text-[11px] font-medium" style={{ color: 'var(--text-dim)' }}>{label}</span>
        <span className="font-num text-[11px]" style={{ color: Math.abs(value - defaultValue) > 0.001 ? 'var(--gold)' : 'var(--text-mute)' }}>
          {value > 0 && step < 10 ? '+' : ''}{Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}{unit}
        </span>
      </div>
      <input
        type="range" className="range-lumen" min={min} max={max} step={step} value={value}
        style={{ ['--fill' as any]: fill + '%' } as React.CSSProperties}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

// ---------- Segmented control ----------
export function Segmented<T extends string>(props: {
  options: { value: T; label: string; icon?: React.ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  small?: boolean;
}) {
  return (
    <div className="flex rounded-lg p-0.5" style={{ background: 'var(--bg-2)', border: '1px solid var(--line-soft)' }}>
      {props.options.map((o) => (
        <button
          key={o.value}
          disabled={o.disabled}
          onClick={() => props.onChange(o.value)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md font-medium transition-colors ${props.small ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'} ${o.disabled ? 'opacity-35' : ''}`}
          style={o.value === props.value
            ? { background: 'var(--panel-3)', color: 'var(--gold)', boxShadow: 'inset 0 0 0 1px var(--line)' }
            : { color: 'var(--text-mute)' }}
        >
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Toggle ----------
export function Toggle(props: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      onClick={() => props.onChange(!props.on)}
      className="flex items-center gap-2.5"
      aria-pressed={props.on}
    >
      {props.label && <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{props.label}</span>}
      <span
        className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
        style={{ background: props.on ? 'var(--gold)' : 'var(--panel-3)', boxShadow: 'inset 0 0 0 1px var(--line)' }}
      >
        <span
          className="absolute h-4 w-4 rounded-full bg-white shadow transition-transform"
          style={{ transform: props.on ? 'translateX(18px)' : 'translateX(2px)' }}
        />
      </span>
    </button>
  );
}

// ---------- Section header ----------
export function SectionLabel(props: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 mt-4 flex items-center justify-between first:mt-0">
      <span className="lbl">{props.children}</span>
      {props.right}
    </div>
  );
}

// ---------- Histogram ----------
export function Histogram(props: { data: HistogramDataSource | null; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const W = (c.width = c.clientWidth * 2 || 560);
    const H = (c.height = (props.height || 56) * 2);
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    if (!props.data) return;
    const draw = (arr: Float32Array, color: string, fill: boolean) => {
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * W;
        const y = H - Math.pow(arr[i], 0.5) * (H - 4);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      if (fill) { ctx.fillStyle = color; ctx.fill(); }
      else { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke(); }
    };
    ctx.globalCompositeOperation = 'lighter';
    draw(props.data.r, 'rgba(255,82,82,0.5)', true);
    draw(props.data.g, 'rgba(120,255,140,0.42)', true);
    draw(props.data.b, 'rgba(96,140,255,0.5)', true);
    ctx.globalCompositeOperation = 'source-over';
    draw(props.data.l, 'rgba(255,255,255,0.85)', false);
  }, [props.data, props.height]);
  return (
    <canvas
      ref={ref}
      className="w-full rounded-md"
      style={{ height: props.height || 56, background: 'rgba(0,0,0,0.35)', border: '1px solid var(--line-soft)' }}
    />
  );
}

// ---------- Tone curve editor ----------
export function CurveEditor(props: {
  points: CurvePoint[];
  onChange: (pts: CurvePoint[]) => void;
  stroke?: string;
  onCommit?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragIdx = useRef(-1);
  const { points, onChange } = props;
  const stroke = props.stroke || 'var(--gold)';

  const toLocal = useCallback((e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: clamp((e.clientX - r.left) / r.width, 0, 1),
      y: clamp(1 - (e.clientY - r.top) / r.height, 0, 1),
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toLocal(e);
    let best = -1, bestD = 0.09;
    points.forEach((pt, i) => {
      const d = Math.hypot(pt.x - p.x, pt.y - p.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) {
      dragIdx.current = best;
    } else {
      // add a point
      const sorted = [...points, p].sort((a, b) => a.x - b.x);
      dragIdx.current = sorted.findIndex((q) => q === p);
      onChange(sorted);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragIdx.current < 0) return;
    const p = toLocal(e);
    const idx = dragIdx.current;
    const next = [...points];
    const isEnd = idx === 0 || idx === points.length - 1;
    const minX = idx > 0 ? points[idx - 1].x + 0.015 : 0;
    const maxX = idx < points.length - 1 ? points[idx + 1].x - 0.015 : 1;
    next[idx] = { x: isEnd ? points[idx].x : clamp(p.x, minX, maxX), y: p.y };
    onChange(next);
  };

  const onPointerUp = () => { if (dragIdx.current >= 0) { dragIdx.current = -1; props.onCommit?.(); } };

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toLocal(e);
    const idx = points.findIndex((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < 0.09);
    if (idx > 0 && idx < points.length - 1) {
      onChange(points.filter((_, i) => i !== idx));
      props.onCommit?.();
    }
  };

  const lut = buildCurveLUT(points);
  const path = Array.from({ length: 65 }, (_, i) => {
    const x = i / 64;
    const y = lut[Math.round(x * 255)] / 255;
    return `${i === 0 ? 'M' : 'L'}${(x * 100).toFixed(1)},${((1 - y) * 100).toFixed(1)}`;
  }).join(' ');

  return (
    <div
      ref={ref}
      className="relative aspect-square w-full touch-none overflow-hidden rounded-lg"
      style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid var(--line-soft)' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        {[25, 50, 75].map((v) => (
          <g key={v} stroke="var(--line-soft)" strokeWidth="0.4">
            <line x1={v} y1="0" x2={v} y2="100" />
            <line x1="0" y1={v} x2="100" y2={v} />
          </g>
        ))}
        <line x1="0" y1="100" x2="100" y2="0" stroke="var(--line)" strokeWidth="0.6" strokeDasharray="2 2" />
        <path d={path} fill="none" stroke={stroke} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      {points.map((p, i) => (
        <div
          key={i}
          className="absolute h-3.5 w-3.5 rounded-full"
          style={{
            left: `${p.x * 100}%`, top: `${(1 - p.y) * 100}%`,
            transform: 'translate(-50%,-50%)',
            background: 'var(--panel-2)',
            border: `2px solid ${stroke}`,
            boxShadow: '0 1px 6px rgba(0,0,0,0.6)',
          }}
        />
      ))}
    </div>
  );
}

// ---------- Reset button ----------
export function ResetMini(props: { onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium"
      style={{ color: 'var(--text-mute)', border: '1px solid var(--line-soft)' }}
    >
      <RotateCcw size={10} /> Reset
    </button>
  );
}
