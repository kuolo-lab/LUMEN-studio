import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Upload, Pencil, Trash2, Layers3, Check, X } from 'lucide-react';
import { useStore } from '../lib/store';
import { BUILTIN_PRESETS, PRESET_CATEGORIES, type Preset } from '../lib/presets';
import { customPresets, photos, savePhotoRecord } from '../lib/db';
import { decodeToCanvas, renderAdjustments, canvasToBlob, downloadBlob } from '../lib/engine';
import { type Adjustments, deepCloneAdj, lerpAdj, uid } from '../lib/adjust';
import { Slider } from '../components/ui';

export default function Presets() {
  const { applyPresetToEditor, editorPhoto, toast, bumpGallery, setTab } = useStore();
  const [allPresets, setAllPresets] = useState<Preset[]>([]);
  const [cat, setCat] = useState('Cinematic');
  const [selected, setSelected] = useState<Preset | null>(null);
  const [intensity, setIntensity] = useState(100);
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [batchBusy, setBatchBusy] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const baseImg = useRef<ImageData | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const batchRef = useRef<HTMLInputElement>(null);

  // load preset list
  const reload = useCallback(async () => {
    const cp = await customPresets.all();
    setAllPresets([...cp, ...BUILTIN_PRESETS]);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  // build preview base image (editor photo > latest gallery > sample)
  useEffect(() => {
    (async () => {
      try {
        let blob: Blob | undefined = editorPhoto?.blob;
        if (!blob) {
          const lib = await photos.all();
          if (lib.length) blob = lib.sort((a, b) => b.createdAt - a.createdAt)[0].blob;
        }
        if (!blob) blob = await fetch('sample/demo.jpg').then((r) => r.blob());
        if (!blob) return;
        const c = await decodeToCanvas(blob, 360);
        baseImg.current = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
        baseImg.current.width && setBaseUrl(c.toDataURL('image/jpeg', 0.75));
        setThumbs({});
      } catch { /* no preview available */ }
    })();
  }, [editorPhoto]);

  // render thumbnails for visible category
  const catPresets = allPresets.filter((p) => p.category === cat || (cat === 'Custom' && !p.builtin));
  useEffect(() => {
    let alive = true;
    (async () => {
      const base = baseImg.current;
      if (!base) return;
      for (const p of catPresets) {
        if (!alive || thumbs[p.id]) continue;
        const src = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
        const out = await renderAdjustments(src, p.adj, { lutOnly: true });
        const c = document.createElement('canvas');
        c.width = out.width; c.height = out.height;
        c.getContext('2d')!.putImageData(out, 0, 0);
        if (!alive) return;
        setThumbs((t) => ({ ...t, [p.id]: c.toDataURL('image/jpeg', 0.7) }));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catPresets.map((p) => p.id).join(','), baseUrl]);

  const applyNow = (p: Preset, t: number) => {
    const adj: Adjustments = lerpAdj(p.adj, t);
    applyPresetToEditor(adj, t >= 0.999 ? p.name : `${p.name} ${Math.round(t * 100)}%`);
    setTab('editor');
  };

  const batchApply = async (files: FileList | null, p: Preset, t: number) => {
    if (!files || !files.length) return;
    const adj = lerpAdj(p.adj, t);
    let n = 0;
    setBatchBusy('0%');
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const c = await decodeToCanvas(f, 3600);
        const id = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
        const out = await renderAdjustments(id, adj, { onProgress: (pr) => setBatchBusy(`${f.name.slice(0, 16)} · ${Math.round(pr * 100)}%`) });
        const cc = document.createElement('canvas');
        cc.width = out.width; cc.height = out.height;
        cc.getContext('2d')!.putImageData(out, 0, 0);
        const blob = await canvasToBlob(cc, 'image/jpeg', 0.93);
        await savePhotoRecord({ blob, source: 'edit', name: `${f.name.replace(/\.[^.]+$/, '')}_${p.name.replace(/\s+/g, '')}` });
        n++;
      } catch { toast(`Skipped ${f.name}`, 'err'); }
    }
    setBatchBusy(null);
    bumpGallery();
    toast(`Preset "${p.name}" applied to ${n} photo${n === 1 ? '' : 's'}`);
  };

  const exportPreset = (p: Preset) => {
    const json = JSON.stringify({ lumenPreset: 1, name: p.name, category: p.category, adj: { ...p.adj, lut: null } }, null, 2);
    downloadBlob(`${p.name.replace(/\s+/g, '_')}.lumen.json`, new Blob([json], { type: 'application/json' }));
    toast('Preset exported as JSON');
  };

  const importPreset = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      if (!data.lumenPreset || !data.adj) throw new Error('bad file');
      const p: Preset = { id: uid(), name: data.name || f.name, category: 'Custom', adj: { ...deepCloneAdj(data.adj), lut: null } };
      await customPresets.put(p);
      await reload();
      setCat('Custom');
      toast(`Imported preset "${p.name}"`);
    } catch { toast('Not a valid LUMEN preset file', 'err'); }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="safe-t px-3 pb-2 pt-3" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--line-soft)' }}>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold tracking-wide">LOOK LIBRARY</div>
            <div className="text-[10px]" style={{ color: 'var(--text-mute)' }}>Original LUMEN presets — real adjustment stacks, free forever</div>
          </div>
          <button className="chip" onClick={() => importRef.current?.click()}><Upload size={11} /> Import</button>
          <input ref={importRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importPreset(f); e.target.value = ''; }} />
        </div>
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-1">
          {['Custom', ...PRESET_CATEGORIES].map((c) => (
            <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
          {catPresets.map((p) => (
            <div key={p.id} className="group overflow-hidden rounded-xl" style={{ border: `1px solid ${selected?.id === p.id ? 'var(--gold-2)' : 'var(--line)'}` }}>
              <button className="relative block w-full" onClick={() => setSelected(p)}>
                <div className="aspect-[4/3] w-full" style={{ background: 'var(--panel)' }}>
                  {thumbs[p.id] ? <img src={thumbs[p.id]} alt="" className="h-full w-full object-cover" /> : baseUrl && <img src={baseUrl} alt="" className="h-full w-full object-cover opacity-30" />}
                </div>
                {selected?.id === p.id && <span className="absolute right-1.5 top-1.5 rounded-full p-1" style={{ background: 'var(--gold)', color: '#141210' }}><Check size={11} /></span>}
              </button>
              <div className="flex items-center justify-between px-2 py-1.5" style={{ background: 'var(--panel)' }}>
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-medium">{p.name}</div>
                  {!p.builtin && <div className="text-[8px] font-bold" style={{ color: 'var(--gold)' }}>CUSTOM</div>}
                </div>
                <div className="flex items-center gap-0.5">
                  {!p.builtin && <>
                    <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={async () => {
                      const name = prompt('Rename preset', p.name);
                      if (!name) return;
                      await customPresets.put({ ...p, name });
                      await reload();
                    }}><Pencil size={11} /></button>
                    <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={async () => {
                      if (!confirm(`Delete preset "${p.name}"?`)) return;
                      await customPresets.remove(p.id); await reload();
                    }}><Trash2 size={11} /></button>
                  </>}
                  <button className="icon-btn" style={{ width: 24, height: 24 }} title="Export preset" onClick={() => exportPreset(p)}><Download size={11} /></button>
                </div>
              </div>
            </div>
          ))}
          {catPresets.length === 0 && (
            <div className="col-span-2 py-10 text-center text-xs" style={{ color: 'var(--text-mute)' }}>
              No custom presets yet. Design a look in the editor and tap the Save button, or import a .lumen.json file.
            </div>
          )}
        </div>
      </div>

      {/* apply bar */}
      {selected && (
        <div className="safe-b anim-sheet px-4 pb-3 pt-2" style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)' }}>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium">Apply <span className="text-gold">{selected.name}</span></span>
            <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setSelected(null)}><X size={13} /></button>
          </div>
          <Slider label="Intensity" value={intensity} min={0} max={100} defaultValue={100} unit="%" onChange={setIntensity} />
          <div className="mt-1 flex gap-2">
            <button className="btn-gold flex flex-1 items-center justify-center gap-2 py-2.5 text-xs" onClick={() => applyNow(selected, intensity / 100)}>
              <Check size={14} /> Apply in editor
            </button>
            <button className="btn-ghost flex items-center gap-2 px-4 py-2.5 text-xs" onClick={() => batchRef.current?.click()}>
              <Layers3 size={14} /> Batch apply to photos
            </button>
            <input ref={batchRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void batchApply(e.target.files, selected, intensity / 100); e.target.value = ''; }} />
          </div>
          {batchBusy && <div className="font-num mt-2 text-center text-[10px]" style={{ color: 'var(--gold)' }}>Processing: {batchBusy}</div>}
        </div>
      )}
    </div>
  );
}
