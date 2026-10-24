import { type Adjustments, mergeAdj } from './adjust';

export interface Preset {
  id: string;
  name: string;
  category: string;
  adj: Adjustments;
  builtin?: boolean;
}

export const PRESET_CATEGORIES = [
  'Natural', 'Cinematic', 'Portrait', 'Street', 'Landscape', 'Night',
  'Black & White', 'Vintage Film', 'Warm', 'Cool', 'Moody', 'Soft & Faded',
  'High Contrast', 'Golden Hour', 'Matte', 'Monochrome',
];

const grade = (s: [number, number], m: [number, number], h: [number, number]) => ({
  gradeShadows: { hue: s[0], amount: s[1], sat: 55 },
  gradeMidtones: { hue: m[0], amount: m[1], sat: 50 },
  gradeHighlights: { hue: h[0], amount: h[1], sat: 55 },
});

const curve = (pts: [number, number][]): { x: number; y: number }[] => pts.map(([x, y]) => ({ x, y }));

export const BUILTIN_PRESETS: Preset[] = [
  // ---------- Natural ----------
  { id: 'nat-true', name: 'True Tone', category: 'Natural', builtin: true, adj: mergeAdj({ contrast: 8, vibrance: 14, highlights: -12, shadows: 10, clarity: 6 }) },
  { id: 'nat-air', name: 'Clear Air', category: 'Natural', builtin: true, adj: mergeAdj({ exposure: 0.15, dehaze: 18, vibrance: 10, highlights: -8, shadows: 14 }) },
  // ---------- Cinematic ----------
  { id: 'cin-teal', name: 'Blockbuster', category: 'Cinematic', builtin: true, adj: mergeAdj({
    contrast: 16, saturation: -8, temperature: -6, fade: 8, vignette: -22,
    ...grade([205, 22], [40, 4], [42, 14]),
    curveMaster: curve([[0, 0.02], [0.25, 0.22], [0.75, 0.8], [1, 0.96]]),
  }) },
  { id: 'cin-noir-city', name: 'Neon District', category: 'Cinematic', builtin: true, adj: mergeAdj({
    contrast: 22, temperature: -14, tint: 8, saturation: -4, dehaze: 10, vignette: -28, grain: 12,
    ...grade([250, 18], [300, 6], [35, 10]),
  }) },
  // ---------- Portrait ----------
  { id: 'por-silk', name: 'Silk Skin', category: 'Portrait', builtin: true, adj: mergeAdj({
    exposure: 0.1, contrast: -6, highlights: -18, shadows: 12, texture: -14, clarity: -8, vibrance: 8, temperature: 6, saturation: -4,
  }) },
  { id: 'por-studio', name: 'Studio Bronze', category: 'Portrait', builtin: true, adj: mergeAdj({
    contrast: 10, temperature: 12, tint: 4, vibrance: 12, highlights: -10, vignette: -14,
    ...grade([30, 8], [35, 6], [45, 10]),
  }) },
  // ---------- Street ----------
  { id: 'str-asphalt', name: 'Asphalt', category: 'Street', builtin: true, adj: mergeAdj({
    contrast: 20, saturation: -22, highlights: -14, shadows: -6, clarity: 18, vignette: -18, grain: 16,
    curveMaster: curve([[0, 0.03], [0.2, 0.17], [0.8, 0.84], [1, 0.97]]),
  }) },
  { id: 'str-flash', name: 'Hard Flash', category: 'Street', builtin: true, adj: mergeAdj({
    contrast: 30, exposure: 0.1, blacks: -18, whites: 12, saturation: -12, vignette: -34, grain: 22, sharpness: 20,
  }) },
  // ---------- Landscape ----------
  { id: 'lan-vista', name: 'Vista', category: 'Landscape', builtin: true, adj: mergeAdj({
    dehaze: 24, vibrance: 22, saturation: 6, contrast: 12, highlights: -16, shadows: 16, clarity: 14,
    hsl: { ...mergeAdj({}).hsl, green: { h: 8, s: 10, l: -4 }, blue: { h: -6, s: 14, l: -6 } },
  }) },
  { id: 'lan-alpine', name: 'Alpine', category: 'Landscape', builtin: true, adj: mergeAdj({
    temperature: -8, dehaze: 16, contrast: 10, whites: 10, vibrance: 16,
    ...grade([215, 12], [210, 4], [50, 6]),
  }) },
  // ---------- Night ----------
  { id: 'nig-sodium', name: 'Sodium', category: 'Night', builtin: true, adj: mergeAdj({
    exposure: 0.2, temperature: 10, contrast: 14, highlights: -30, shadows: 18, noiseReduction: 30,
    ...grade([230, 26], [35, 8], [40, 16]),
    hsl: { ...mergeAdj({}).hsl, orange: { h: -6, s: 12, l: 4 } },
  }) },
  { id: 'nig-neon', name: 'Midnight Neon', category: 'Night', builtin: true, adj: mergeAdj({
    temperature: -16, tint: 10, saturation: 16, contrast: 18, blacks: -10, noiseReduction: 22, vignette: -20,
    ...grade([280, 20], [200, 8], [190, 12]),
  }) },
  // ---------- Black & White ----------
  { id: 'bnw-silver', name: 'Silver Gelatin', category: 'Black & White', builtin: true, adj: mergeAdj({
    bw: true, contrast: 18, clarity: 12, grain: 14, bwMix: { r: 30, g: 50, b: 20 },
    curveMaster: curve([[0, 0.01], [0.25, 0.24], [0.75, 0.78], [1, 0.99]]),
  }) },
  { id: 'bnw-noir', name: 'Film Noir', category: 'Black & White', builtin: true, adj: mergeAdj({
    bw: true, contrast: 34, blacks: -16, whites: 10, grain: 26, vignette: -30, bwMix: { r: 40, g: 40, b: 20 },
  }) },
  // ---------- Vintage Film ----------
  { id: 'vin-72', name: 'Summer 72', category: 'Vintage Film', builtin: true, adj: mergeAdj({
    temperature: 14, tint: -4, contrast: -8, fade: 26, saturation: -16, grain: 24, vignette: -16,
    ...grade([45, 10], [40, 6], [55, 14]),
    curveMaster: curve([[0, 0.05], [0.5, 0.48], [1, 0.94]]),
  }) },
  { id: 'vin-slide', name: 'Slide Chrome', category: 'Vintage Film', builtin: true, adj: mergeAdj({
    contrast: 14, saturation: 18, temperature: 6, grain: 10, whites: 6, blacks: -12,
    hsl: { ...mergeAdj({}).hsl, red: { h: -4, s: 8, l: 0 }, blue: { h: 4, s: 6, l: -6 } },
  }) },
  // ---------- Warm ----------
  { id: 'wrm-ember', name: 'Ember', category: 'Warm', builtin: true, adj: mergeAdj({
    temperature: 22, tint: 6, vibrance: 12, contrast: 6, shadows: 8,
    ...grade([25, 14], [35, 8], [45, 12]),
  }) },
  { id: 'wrm-honey', name: 'Honey', category: 'Warm', builtin: true, adj: mergeAdj({
    temperature: 16, exposure: 0.1, saturation: -4, fade: 10, highlights: -8,
    hsl: { ...mergeAdj({}).hsl, orange: { h: 4, s: 8, l: 4 }, yellow: { h: -6, s: 6, l: 2 } },
  }) },
  // ---------- Cool ----------
  { id: 'col-glacier', name: 'Glacier', category: 'Cool', builtin: true, adj: mergeAdj({
    temperature: -24, contrast: 8, saturation: -6, dehaze: 8, highlights: -6,
    ...grade([210, 16], [205, 6], [195, 10]),
  }) },
  { id: 'col-mint', name: 'Winter Mint', category: 'Cool', builtin: true, adj: mergeAdj({
    temperature: -14, tint: -8, exposure: 0.12, fade: 12, saturation: -10, shadows: 10,
  }) },
  // ---------- Moody ----------
  { id: 'mod-forest', name: 'Dark Forest', category: 'Moody', builtin: true, adj: mergeAdj({
    exposure: -0.25, contrast: 14, saturation: -18, temperature: -6, blacks: -14, vignette: -30, clarity: 10,
    hsl: { ...mergeAdj({}).hsl, green: { h: 14, s: -18, l: -10 }, yellow: { h: 20, s: -14, l: -8 } },
    ...grade([160, 10], [140, 4], [60, 6]),
  }) },
  { id: 'mod-ash', name: 'Ash', category: 'Moody', builtin: true, adj: mergeAdj({
    exposure: -0.15, saturation: -34, contrast: 18, fade: 14, grain: 18, vignette: -24,
    curveMaster: curve([[0, 0.04], [0.4, 0.36], [0.8, 0.78], [1, 0.92]]),
  }) },
  // ---------- Soft & Faded ----------
  { id: 'sof-pastel', name: 'Pastel Haze', category: 'Soft & Faded', builtin: true, adj: mergeAdj({
    exposure: 0.25, contrast: -18, fade: 24, saturation: -10, highlights: -20, shadows: 20, temperature: 6,
  }) },
  { id: 'sof-dream', name: 'Daydream', category: 'Soft & Faded', builtin: true, adj: mergeAdj({
    exposure: 0.18, contrast: -12, texture: -20, clarity: -14, saturation: 4, fade: 16, tint: 8,
    ...grade([330, 8], [30, 4], [50, 10]),
  }) },
  // ---------- High Contrast ----------
  { id: 'hct-crush', name: 'Crush', category: 'High Contrast', builtin: true, adj: mergeAdj({
    contrast: 38, blacks: -22, whites: 14, saturation: 8, clarity: 16, vignette: -12,
    curveMaster: curve([[0, 0], [0.3, 0.2], [0.7, 0.82], [1, 1]]),
  }) },
  { id: 'hct-punch', name: 'Punch', category: 'High Contrast', builtin: true, adj: mergeAdj({
    contrast: 26, saturation: 20, vibrance: 10, dehaze: 12, blacks: -10, sharpness: 18,
  }) },
  // ---------- Golden Hour ----------
  { id: 'ghr-magic', name: 'Magic Light', category: 'Golden Hour', builtin: true, adj: mergeAdj({
    temperature: 20, tint: 4, exposure: 0.08, contrast: 10, highlights: -14, vibrance: 18,
    ...grade([35, 16], [40, 10], [50, 20]),
    hsl: { ...mergeAdj({}).hsl, orange: { h: 2, s: 12, l: 4 }, yellow: { h: -8, s: 10, l: 0 } },
  }) },
  { id: 'ghr-dusk', name: 'Last Dusk', category: 'Golden Hour', builtin: true, adj: mergeAdj({
    temperature: 12, exposure: -0.08, contrast: 14, saturation: 8, vignette: -18, fade: 8,
    ...grade([300, 10], [30, 6], [40, 14]),
  }) },
  // ---------- Matte ----------
  { id: 'mat-paper', name: 'Matte Paper', category: 'Matte', builtin: true, adj: mergeAdj({
    fade: 22, contrast: -10, saturation: -12, blacks: 16, grain: 8,
    curveMaster: curve([[0, 0.06], [0.5, 0.5], [1, 0.94]]),
  }) },
  { id: 'mat-canvas', name: 'Gallery Canvas', category: 'Matte', builtin: true, adj: mergeAdj({
    fade: 16, contrast: -6, temperature: 4, texture: -8, grain: 12, whites: -8, blacks: 12,
  }) },
  // ---------- Monochrome ----------
  { id: 'mon-graphite', name: 'Graphite', category: 'Monochrome', builtin: true, adj: mergeAdj({
    bw: true, contrast: 6, fade: 10, grain: 8, clarity: 8, bwMix: { r: 33, g: 34, b: 33 },
  }) },
  { id: 'mon-selenium', name: 'Selenium', category: 'Monochrome', builtin: true, adj: mergeAdj({
    bw: true, contrast: 10, tint: 8, ...grade([280, 8], [270, 4], [45, 6]), bwMix: { r: 28, g: 52, b: 20 },
  }) },
];
