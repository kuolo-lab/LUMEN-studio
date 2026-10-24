import {
  type Adjustments, type LutData, HSL_BANDS,
  buildCurveLUT, smoothstep, hslToRgb, clamp,
  adjHasHsl, adjHasGrading, adjHasMixer,
} from './adjust';

// ---------------- Geometry ----------------

export interface Geometry {
  crop: { x: number; y: number; w: number; h: number } | null; // normalized, post-rotation space
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  straighten: number; // degrees -45..45
}

export const identityGeometry = (): Geometry => ({
  crop: null, rotate: 0, flipH: false, flipV: false, straighten: 0,
});

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function applyGeometry(src: HTMLCanvasElement, geo: Geometry): HTMLCanvasElement {
  const sw = src.width, sh = src.height;
  const rot = geo.rotate;
  const swapped = rot === 90 || rot === 270;
  const dw = swapped ? sh : sw;
  const dh = swapped ? sw : sh;
  const tmp = makeCanvas(dw, dh);
  const ctx = tmp.getContext('2d')!;
  ctx.save();
  ctx.translate(dw / 2, dh / 2);
  const rad = (rot * Math.PI) / 180;
  ctx.rotate(rad);
  // straighten (cover corners)
  const st = (geo.straighten * Math.PI) / 180;
  if (Math.abs(st) > 0.001) {
    const c = Math.abs(Math.cos(rot === 0 || rot === 180 ? st : rad + st));
    ctx.rotate(st);
    const cover = Math.abs(Math.cos(st)) + Math.max(sw / sh, sh / sw) * Math.abs(Math.sin(st));
    ctx.scale(cover * (geo.flipH ? -1 : 1), cover * (geo.flipV ? -1 : 1));
    void c;
  } else {
    ctx.scale(geo.flipH ? -1 : 1, geo.flipV ? -1 : 1);
  }
  ctx.drawImage(src, -sw / 2, -sh / 2);
  ctx.restore();
  if (!geo.crop) return tmp;
  const { x, y, w, h } = geo.crop;
  const cx = Math.round(x * dw), cy = Math.round(y * dh);
  const cw = Math.max(8, Math.round(w * dw)), ch = Math.max(8, Math.round(h * dh));
  const out = makeCanvas(Math.min(cw, dw - cx), Math.min(ch, dh - cy));
  out.getContext('2d')!.drawImage(tmp, cx, cy, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

// ---------------- IO helpers ----------------

export async function decodeToCanvas(blob: Blob, maxDim = 0): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob).catch(() => null);
  let w: number, h: number, source: CanvasImageSource;
  if (bmp) { w = bmp.width; h = bmp.height; source = bmp; }
  else {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const el = new Image();
      el.onload = () => res(el);
      el.onerror = rej;
      el.src = URL.createObjectURL(blob);
    });
    w = img.naturalWidth; h = img.naturalHeight; source = img;
  }
  let scale = 1;
  if (maxDim > 0 && Math.max(w, h) > maxDim) scale = maxDim / Math.max(w, h);
  const c = makeCanvas(w * scale, h * scale);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, c.width, c.height);
  if (bmp) bmp.close();
  return c;
}

export function canvasToBlob(c: HTMLCanvasElement, type: string, q = 0.92): Promise<Blob> {
  return new Promise((res, rej) => {
    c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, q);
  });
}

export function downloadBlob(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

export async function shareBlob(name: string, blob: Blob): Promise<boolean> {
  const nav = navigator as any;
  const file = new File([blob], name, { type: blob.type });
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try { await nav.share({ files: [file], title: name }); return true; } catch { return false; }
  }
  return false;
}

// ---------------- Histogram ----------------

export interface HistogramData { l: Float32Array; r: Float32Array; g: Float32Array; b: Float32Array }

export function histogramOf(img: ImageData): HistogramData {
  const l = new Uint32Array(256), r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const R = d[i], G = d[i + 1], B = d[i + 2];
    r[R]++; g[G]++; b[B]++;
    l[(R * 54 + G * 183 + B * 19) >> 8]++;
  }
  const norm = (a: Uint32Array) => {
    let m = 1;
    for (let i = 8; i < 250; i++) if (a[i] > m) m = a[i];
    const f = new Float32Array(256);
    for (let i = 0; i < 256; i++) f[i] = a[i] / m;
    return f;
  };
  return { l: norm(l), r: norm(r), g: norm(g), b: norm(b) };
}

// ---------------- Blur (separable box, O(n)) ----------------

function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      acc += src[row + clamp(x + r + 1, 0, w - 1)] - src[row + clamp(x - r, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      acc += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

// ---------------- LUT (.cube) ----------------

export function parseCubeLUT(text: string, name: string): LutData | null {
  const lines = text.split(/\r?\n/);
  let size = 0;
  const vals: number[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const up = line.toUpperCase();
    if (up.startsWith('LUT_3D_SIZE')) { size = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (up.startsWith('TITLE') || up.startsWith('DOMAIN') || up.startsWith('LUT_') || up.startsWith('DATA_MIN') || up.startsWith('DATA_MAX')) continue;
    const parts = line.split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.every((v) => !Number.isNaN(v))) vals.push(parts[0], parts[1], parts[2]);
  }
  if (!size || size < 2 || vals.length !== size * size * size * 3) return null;
  return { size, data: new Float32Array(vals), name };
}

function sampleLut(lut: LutData, r: number, g: number, b: number, out: [number, number, number]) {
  const n = lut.size, d = lut.data;
  const x = clamp(r, 0, 1) * (n - 1), y = clamp(g, 0, 1) * (n - 1), z = clamp(b, 0, 1) * (n - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1), z1 = Math.min(n - 1, z0 + 1);
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const idx = (ri: number, gi: number, bi: number) => (ri + gi * n + bi * n * n) * 3;
  for (let c = 0; c < 3; c++) {
    const c000 = d[idx(x0, y0, z0) + c], c100 = d[idx(x1, y0, z0) + c];
    const c010 = d[idx(x0, y1, z0) + c], c110 = d[idx(x1, y1, z0) + c];
    const c001 = d[idx(x0, y0, z1) + c], c101 = d[idx(x1, y0, z1) + c];
    const c011 = d[idx(x0, y1, z1) + c], c111 = d[idx(x1, y1, z1) + c];
    const c00 = c000 + (c100 - c000) * fx, c10 = c010 + (c110 - c010) * fx;
    const c01 = c001 + (c101 - c001) * fx, c11 = c011 + (c111 - c011) * fx;
    const c0 = c00 + (c10 - c00) * fy, c1 = c01 + (c11 - c01) * fy;
    out[c] = c0 + (c1 - c0) * fz;
  }
}

// ---------------- Main pipeline ----------------

function buildLumaCurve(adj: Adjustments): Float32Array {
  // single 256-entry tone curve: exposure, brightness, contrast, tonals, fade, dehaze
  const lut = new Float32Array(256);
  const ev = Math.pow(2, adj.exposure);
  const bri = (adj.brightness / 100) * 0.42;
  const con = adj.contrast / 100;
  const sh = adj.shadows / 100, hi = adj.highlights / 100;
  const wh = adj.whites / 100, bl = adj.blacks / 100;
  const fade = clamp(adj.fade / 100, 0, 1);
  const dh = adj.dehaze / 100;
  for (let i = 0; i < 256; i++) {
    let v = i / 255;
    v *= ev;
    v = clamp(v, 0, 1);
    v += bri;
    // contrast (pivot 0.45)
    v = clamp(0.45 + (v - 0.45) * (1 + con * 1.35), 0, 1);
    // tonal regions
    const wShadow = 1 - smoothstep(0, 0.55, v);
    const wHigh = smoothstep(0.42, 1, v);
    const wWhite = smoothstep(0.66, 1, v);
    const wBlack = 1 - smoothstep(0, 0.34, v);
    v += (sh >= 0 ? sh * 0.42 * wShadow * (1 - v) : sh * 0.42 * wShadow * v);
    v += (hi >= 0 ? hi * 0.42 * wHigh * (1 - v) : hi * 0.42 * wHigh * v);
    v += (wh >= 0 ? wh * 0.3 * wWhite * (1 - v) : wh * 0.3 * wWhite * v);
    v += (bl >= 0 ? bl * 0.3 * wBlack * (1 - v) : bl * 0.3 * wBlack * v);
    // fade (lift blacks)
    if (fade > 0) v = v * (1 - 0.2 * fade) + 0.09 * fade;
    // dehaze
    if (dh > 0) {
      v = 0.5 + (v - 0.5) * (1 + 0.65 * dh);
    } else if (dh < 0) {
      v = 0.5 + (v - 0.5) * (1 + 0.45 * dh) - dh * 0.05;
    }
    lut[i] = clamp(v, 0, 1);
  }
  return lut;
}

// noise tile for grain
const NOISE = (() => {
  const N = 512;
  const t = new Float32Array(N * N);
  let seed = 22222;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < t.length; i++) t[i] = rnd() * 2 - 1;
  return t;
})();

export interface RenderOpts {
  lutOnly?: boolean;      // skip detail pass (for fast slider previews)
  onProgress?: (p: number) => void;
}

export async function renderAdjustments(src: ImageData, adj: Adjustments, opts: RenderOpts = {}): Promise<ImageData> {
  const w = src.width, h = src.height;
  const s = src.data;
  const out = new ImageData(w, h);
  const o = out.data;

  // ---- build lookup tables ----
  const lumaCurve = buildLumaCurve(adj);
  const cm = buildCurveLUT(adj.curveMaster);
  const cr = buildCurveLUT(adj.curveR);
  const cg = buildCurveLUT(adj.curveG);
  const cb = buildCurveLUT(adj.curveB);

  const t92 = adj.temperature / 100, ti = adj.tint / 100;
  const gR = 1 + 0.28 * t92 + 0.06 * ti;
  const gG = 1 - 0.14 * ti + 0.02 * t92;
  const gB = 1 - 0.3 * t92 + 0.06 * ti;

  const LR = new Uint8ClampedArray(256), LG = new Uint8ClampedArray(256), LB = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const base = cm[Math.round(lumaCurve[i] * 255)];
    LR[i] = cr[Math.round(clamp(base * gR, 0, 255))];
    LG[i] = cg[Math.round(clamp(base * gG, 0, 255))];
    LB[i] = cb[Math.round(clamp(base * gB, 0, 255))];
  }

  const hasHsl = adjHasHsl(adj) && !adj.bw;
  const hasGrading = adjHasGrading(adj);
  const hasMixer = adjHasMixer(adj) && !adj.bw;
  const hasDetail = adj.clarity !== 0 || adj.texture !== 0 || adj.sharpness > 0.5 || adj.noiseReduction > 0.5;
  const doDetail = hasDetail && !opts.lutOnly;

  const sat = adj.saturation / 100;
  const vib = adj.vibrance / 100;
  const dhBoost = 1 + 0.3 * Math.max(0, adj.dehaze / 100);
  const hasSat = sat !== 0 || vib !== 0 || dhBoost !== 1;

  // grading zone colour vectors (in 0..255 offsets)
  const zoneVec = (z: { hue: number; amount: number; sat: number }) => {
    const [r, g, b] = hslToRgb(z.hue, 0.25 + 0.75 * (z.sat / 100), 0.5);
    const a = (z.amount / 100) * 64;
    return [(r - 0.5) * 2 * a, (g - 0.5) * 2 * a, (b - 0.5) * 2 * a];
  };
  const zs = zoneVec(adj.gradeShadows), zm = zoneVec(adj.gradeMidtones), zh = zoneVec(adj.gradeHighlights);

  const mixer = adj.mixer;
  const bwSum = Math.max(1, adj.bwMix.r + adj.bwMix.g + adj.bwMix.b);
  const lutC = adj.lut?.cube ?? null;
  const lutAmt = adj.lut ? adj.lut.intensity / 100 : 0;
  const lutTmp: [number, number, number] = [0, 0, 0];

  // hsl band params
  const bandHue = HSL_BANDS.map((b) => b.hue);
  const bandAdj = HSL_BANDS.map((b) => adj.hsl[b.key]);

  // vignette prep
  const vig = adj.vignette / 100;
  const vigFeather = 0.35 + 0.65 * (adj.vignetteFeather / 100);
  const cx = w / 2, cy = h / 2;
  const maxD = Math.sqrt(cx * cx + cy * cy);

  const grain = clamp(adj.grain / 100, 0, 1);
  const grainScale = 1 + (adj.grainSize / 100) * 6;
  const hasVigOrGrain = vig !== 0 || grain > 0.01;

  const CHUNK = 24; // rows per microtask slice
  let rows = 0;

  for (let y = 0; y < h; y++) {
    const dy = (y - cy) / maxD;
    const dy2 = dy * dy;
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      let r = LR[s[i]], g = LG[s[i + 1]], b = LB[s[i + 2]];

      if (hasHsl) {
        // rgb -> hsl
        const rn = r / 255, gn = g / 255, bn = b / 255;
        const mx = Math.max(rn, gn, bn), mn = Math.min(rn, gn, bn);
        let hh = 0;
        const dch = mx - mn;
        const ll = (mx + mn) / 2;
        if (dch > 0.003) {
          let ss = dch / (1 - Math.abs(2 * ll - 1) || 1);
          ss = clamp(ss, 0, 1);
          if (mx === rn) hh = 60 * (((gn - bn) / dch) % 6);
          else if (mx === gn) hh = 60 * ((bn - rn) / dch + 2);
          else hh = 60 * ((rn - gn) / dch + 4);
          if (hh < 0) hh += 360;
          let dh2 = 0, ds = 0, dl = 0, wSum = 0;
          for (let bi = 0; bi < 8; bi++) {
            const ad = bandAdj[bi];
            if (ad.h === 0 && ad.s === 0 && ad.l === 0) continue;
            let dhue = Math.abs(hh - bandHue[bi]);
            if (dhue > 180) dhue = 360 - dhue;
            const wgt = Math.max(0, 1 - dhue / 52);
            if (wgt <= 0) continue;
            dh2 += ad.h * wgt; ds += (ad.s / 100) * wgt; dl += (ad.l / 100) * wgt; wSum += wgt;
          }
          if (wSum > 0) {
            hh = (((hh + dh2) % 360) + 360) % 360;
            ss = clamp(ss * (1 + ds), 0, 1);
            const ll2 = clamp(ll * (1 + dl * 0.6) + dl * 0.12, 0, 1);
            const [rr, gg, bb] = hslToRgb(hh, ss, ll2);
            r = rr * 255; g = gg * 255; b = bb * 255;
          }
        }
      }

      // luma 0..255
      let l = r * 0.2126 + g * 0.7152 + b * 0.0722;

      if (adj.bw) {
        const lv = clamp(((r * adj.bwMix.r + g * adj.bwMix.g + b * adj.bwMix.b) / bwSum), 0, 255);
        r = g = b = lv;
        l = lv;
      } else if (hasSat) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const satP = (mx - mn) / 255;
        const vf = 1 + vib * (1 - satP) * 1.15;
        const sf = Math.max(0, (1 + sat) * vf * dhBoost);
        r = l + (r - l) * sf;
        g = l + (g - l) * sf;
        b = l + (b - l) * sf;
      }

      if (hasGrading) {
        const ln = clamp(l, 0, 255) / 255;
        const wS = 1 - smoothstep(0.05, 0.62, ln);
        const wM = Math.max(0, 1 - Math.abs(ln - 0.48) / 0.48);
        const wH = smoothstep(0.38, 0.95, ln);
        r += zs[0] * wS + zm[0] * wM + zh[0] * wH;
        g += zs[1] * wS + zm[1] * wM + zh[1] * wH;
        b += zs[2] * wS + zm[2] * wM + zh[2] * wH;
      }

      if (hasMixer) {
        const nr = (r * mixer.rr + g * mixer.rg + b * mixer.rb) / 100;
        const ng = (r * mixer.gr + g * mixer.gg + b * mixer.gb) / 100;
        const nb = (r * mixer.br + g * mixer.bg + b * mixer.bb) / 100;
        r = nr; g = ng; b = nb;
      }

      if (lutC && lutAmt > 0) {
        sampleLut(lutC, clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255, lutTmp);
        r = r + (lutTmp[0] * 255 - r) * lutAmt;
        g = g + (lutTmp[1] * 255 - g) * lutAmt;
        b = b + (lutTmp[2] * 255 - b) * lutAmt;
      }

      if (hasVigOrGrain) {
        if (vig !== 0) {
          const dx = (x - cx) / maxD;
          const dd = Math.sqrt(dx * dx + dy2);
          const f = 1 - vig * 0.85 * smoothstep(vigFeather * 0.55, 1.05, dd);
          r *= f; g *= f; b *= f;
        }
        if (grain > 0.01) {
          const gx = Math.round(x / grainScale) & 511;
          const gy = Math.round(y / grainScale) & 511;
          const n = NOISE[gy * 512 + gx];
          const ln = clamp(l, 0, 255) / 255;
          const amp = grain * 30 * (1 - Math.abs(ln - 0.5) * 0.85);
          r += n * amp; g += n * amp * 0.98; b += n * amp;
        }
      }

      o[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      o[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      o[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      o[i + 3] = s[i + 3];
    }
    if (++rows >= CHUNK) {
      rows = 0;
      opts.onProgress?.(y / h / 2);
      await new Promise((r2) => setTimeout(r2, 0));
    }
  }

  // ---- detail pass: clarity / texture / sharpen / noise reduction ----
  if (doDetail) {
    const len = w * h;
    const luma = new Float32Array(len);
    for (let p = 0, i = 0; p < len; p++, i += 4) {
      luma[p] = o[i] * 0.2126 + o[i + 1] * 0.7152 + o[i + 2] * 0.0722;
    }
    const maxDim = Math.max(w, h);
    const rFine = Math.max(1, maxDim * 0.0012);
    const rMid = Math.max(2, maxDim * 0.0045);
    const blur1 = boxBlur(luma, w, h, rFine);
    const blur2 = boxBlur(luma, w, h, rMid);

    const cla = (adj.clarity / 100) * 1.05;
    const tex = (adj.texture / 100) * 0.85;
    const shp = Math.max(0, adj.sharpness / 100) * 1.1;
    const nr = Math.max(0, adj.noiseReduction / 100);

    let rows2 = 0;
    for (let y = 0; y < h; y++) {
      let p = y * w;
      let i = p * 4;
      for (let x = 0; x < w; x++, p++, i += 4) {
        const L = luma[p];
        const dMid = L - blur2[p];
        const dFine = L - blur1[p];
        let add = dMid * cla + dFine * tex + dFine * shp;
        if (nr > 0) {
          const g2 = 1 / (1 + Math.abs(dFine) * 0.22);
          add -= dFine * nr * g2 * 0.95;
        }
        if (add !== 0) {
          let r = o[i] + add, g = o[i + 1] + add, b = o[i + 2] + add;
          o[i] = r < 0 ? 0 : r > 255 ? 255 : r;
          o[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
          o[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
        }
      }
      if (++rows2 >= CHUNK) {
        rows2 = 0;
        opts.onProgress?.(0.5 + (y / h) / 2);
        await new Promise((r2) => setTimeout(r2, 0));
      }
    }
  }

  opts.onProgress?.(1);
  return out;
}

// scale an ImageData-bearing canvas to a max dimension (returns new canvas)
export function scaleCanvas(src: HTMLCanvasElement, maxDim: number): HTMLCanvasElement {
  if (Math.max(src.width, src.height) <= maxDim) return src;
  const f = maxDim / Math.max(src.width, src.height);
  const out = makeCanvas(src.width * f, src.height * f);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

export const fmtShutter = (ms: number): string => {
  if (ms >= 1000) return (ms / 1000).toFixed(ms >= 10000 ? 0 : 1) + '"';
  return '1/' + Math.round(1000 / ms);
};
