// ---------- Adjustment model (non-destructive) ----------

export interface CurvePoint { x: number; y: number }

export const HSL_BANDS = [
  { key: 'red', label: 'Red', hue: 0 },
  { key: 'orange', label: 'Orange', hue: 30 },
  { key: 'yellow', label: 'Yellow', hue: 60 },
  { key: 'green', label: 'Green', hue: 120 },
  { key: 'aqua', label: 'Aqua', hue: 180 },
  { key: 'blue', label: 'Blue', hue: 230 },
  { key: 'purple', label: 'Purple', hue: 275 },
  { key: 'magenta', label: 'Magenta', hue: 320 },
] as const;

export type HslBandKey = (typeof HSL_BANDS)[number]['key'];

export interface HslShift { h: number; s: number; l: number } // h: -60..60 deg, s/l: -100..100

export interface GradeZone { hue: number; amount: number; sat: number } // hue 0..360, amount 0..100, sat 0..100

export interface ChannelMixer {
  rr: number; rg: number; rb: number;
  gr: number; gg: number; gb: number;
  br: number; bg: number; bb: number;
}

export interface LutData { size: number; data: Float32Array; name: string }

export interface Adjustments {
  // light
  exposure: number;     // -4..4 EV
  brightness: number;   // -100..100
  contrast: number;     // -100..100
  highlights: number;   // -100..100
  shadows: number;      // -100..100
  whites: number;       // -100..100
  blacks: number;       // -100..100
  // color
  temperature: number;  // -100..100
  tint: number;         // -100..100
  saturation: number;   // -100..100
  vibrance: number;     // -100..100
  // detail
  clarity: number;      // -100..100
  texture: number;      // -100..100
  sharpness: number;    // 0..150
  noiseReduction: number; // 0..100
  // effects
  vignette: number;     // -100..100
  vignetteFeather: number; // 0..100
  grain: number;        // 0..100
  grainSize: number;    // 0..100
  fade: number;         // 0..100
  dehaze: number;       // -100..100
  // mono
  bw: boolean;
  bwMix: { r: number; g: number; b: number };
  // curves (points normalized 0..1)
  curveMaster: CurvePoint[];
  curveR: CurvePoint[];
  curveG: CurvePoint[];
  curveB: CurvePoint[];
  // hsl per band
  hsl: Record<HslBandKey, HslShift>;
  // color grading (lift/gamma/gain style)
  gradeShadows: GradeZone;
  gradeMidtones: GradeZone;
  gradeHighlights: GradeZone;
  mixer: ChannelMixer;
  // lut
  lut: { name: string; intensity: number; cube: LutData | null } | null;
}

const zeroHsl = (): Record<HslBandKey, HslShift> => {
  const o = {} as Record<HslBandKey, HslShift>;
  for (const b of HSL_BANDS) o[b.key] = { h: 0, s: 0, l: 0 };
  return o;
};

export function defaultAdjustments(): Adjustments {
  return {
    exposure: 0, brightness: 0, contrast: 0,
    highlights: 0, shadows: 0, whites: 0, blacks: 0,
    temperature: 0, tint: 0, saturation: 0, vibrance: 0,
    clarity: 0, texture: 0, sharpness: 0, noiseReduction: 0,
    vignette: 0, vignetteFeather: 55, grain: 0, grainSize: 35,
    fade: 0, dehaze: 0,
    bw: false, bwMix: { r: 35, g: 45, b: 20 },
    curveMaster: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    curveR: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    curveG: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    curveB: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    hsl: zeroHsl(),
    gradeShadows: { hue: 220, amount: 0, sat: 50 },
    gradeMidtones: { hue: 40, amount: 0, sat: 50 },
    gradeHighlights: { hue: 45, amount: 0, sat: 50 },
    mixer: { rr: 100, rg: 0, rb: 0, gr: 0, gg: 100, gb: 0, br: 0, bg: 0, bb: 100 },
    lut: null,
  };
}

export const IDENTITY = defaultAdjustments();

export function deepCloneAdj(a: Adjustments): Adjustments {
  const c = JSON.parse(JSON.stringify(a)) as Adjustments;
  if (a.lut?.cube) c.lut = { name: a.lut.name, intensity: a.lut.intensity, cube: a.lut.cube };
  return c;
}

// Used by presets: partial overrides merged onto identity
export function mergeAdj(partial: Partial<Adjustments>): Adjustments {
  const base = defaultAdjustments();
  const out = { ...base, ...partial } as Adjustments;
  if (partial.hsl) out.hsl = { ...base.hsl, ...partial.hsl };
  if (partial.bwMix) out.bwMix = { ...base.bwMix, ...partial.bwMix };
  if (partial.mixer) out.mixer = { ...base.mixer, ...partial.mixer };
  return out;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Interpolate between identity and target for preset intensity
export function lerpAdj(target: Adjustments, t: number): Adjustments {
  const z = defaultAdjustments();
  if (t >= 0.999) return deepCloneAdj(target);
  const out = deepCloneAdj(target);
  const nums: (keyof Adjustments)[] = [
    'exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
    'temperature', 'tint', 'saturation', 'vibrance', 'clarity', 'texture', 'sharpness',
    'noiseReduction', 'vignette', 'grain', 'fade', 'dehaze',
  ];
  for (const k of nums) (out[k] as number) = lerp(z[k] as number, target[k] as number, t);
  for (const b of HSL_BANDS) {
    const k = b.key;
    out.hsl[k] = {
      h: lerp(0, target.hsl[k].h, t),
      s: lerp(0, target.hsl[k].s, t),
      l: lerp(0, target.hsl[k].l, t),
    };
  }
  (['gradeShadows', 'gradeMidtones', 'gradeHighlights'] as const).forEach((g) => {
    out[g] = { ...target[g], amount: target[g].amount * t };
  });
  const m = out.mixer;
  (Object.keys(m) as (keyof ChannelMixer)[]).forEach((k) => {
    m[k] = lerp((z.mixer as any)[k], target.mixer[k], t);
  });
  out.curveMaster = target.curveMaster.map((p) => ({ x: p.x, y: lerp(p.x, p.y, t) }));
  out.curveR = target.curveR.map((p) => ({ x: p.x, y: lerp(p.x, p.y, t) }));
  out.curveG = target.curveG.map((p) => ({ x: p.x, y: lerp(p.x, p.y, t) }));
  out.curveB = target.curveB.map((p) => ({ x: p.x, y: lerp(p.x, p.y, t) }));
  if (out.lut) out.lut = { ...out.lut, intensity: out.lut.intensity * t };
  if (t < 0.35) out.bw = false;
  return out;
}

export function adjHasHsl(a: Adjustments): boolean {
  return HSL_BANDS.some((b) => {
    const v = a.hsl[b.key];
    return Math.abs(v.h) > 0.2 || Math.abs(v.s) > 0.5 || Math.abs(v.l) > 0.5;
  });
}

export function adjHasGrading(a: Adjustments): boolean {
  return a.gradeShadows.amount > 0.5 || a.gradeMidtones.amount > 0.5 || a.gradeHighlights.amount > 0.5;
}

export function adjHasMixer(a: Adjustments): boolean {
  const m = a.mixer;
  return Math.abs(m.rr - 100) > 0.5 || Math.abs(m.rg) > 0.5 || Math.abs(m.rb) > 0.5 ||
    Math.abs(m.gr) > 0.5 || Math.abs(m.gg - 100) > 0.5 || Math.abs(m.gb) > 0.5 ||
    Math.abs(m.br) > 0.5 || Math.abs(m.bg) > 0.5 || Math.abs(m.bb - 100) > 0.5;
}

export function adjNeedsDetailPass(a: Adjustments): boolean {
  return a.clarity !== 0 || a.texture !== 0 || a.sharpness > 0.5 || a.noiseReduction > 0.5;
}

// ---------- Monotone cubic curve → 256-entry LUT ----------
export function buildCurveLUT(points: CurvePoint[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  if (!points || points.length < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  const pts = [...points].sort((a, b) => a.x - b.x);
  const n = pts.length;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);

  // Fritsch–Carlson monotone cubic slopes
  const d: number[] = [];
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    d.push(dx > 1e-6 ? (ys[i + 1] - ys[i]) / dx : 0);
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(d[i]) < 1e-9) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }

  let seg = 0;
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    while (seg < n - 2 && x > xs[seg + 1]) seg++;
    const x0 = xs[seg], x1 = xs[seg + 1];
    const h = Math.max(1e-6, x1 - x0);
    const t = Math.min(1, Math.max(0, (x - x0) / h));
    const t2 = t * t, t3 = t2 * t;
    const y =
      (2 * t3 - 3 * t2 + 1) * ys[seg] +
      (t3 - 2 * t2 + t) * h * m[seg] +
      (-2 * t3 + 3 * t2) * ys[seg + 1] +
      (t3 - t2) * h * m[seg + 1];
    lut[i] = Math.round(Math.min(1, Math.max(0, y)) * 255);
  }
  return lut;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export function fmtBytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
