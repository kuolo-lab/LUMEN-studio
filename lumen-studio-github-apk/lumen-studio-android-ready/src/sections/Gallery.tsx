import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Star, Trash2, Share2, Download, SlidersHorizontal, FolderPlus, X,
  ArrowUpDown, ImagePlus, Info, Camera as CameraIcon, FileDigit, Layers,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { photos, savePhotoRecord, type PhotoRecord } from '../lib/db';
import { fmtBytes } from '../lib/adjust';
import { shareBlob, downloadBlob } from '../lib/engine';

type SortKey = 'date' | 'size' | 'name';

export default function Gallery() {
  const { galleryVersion, openInEditor, openInStudio, toast, bumpGallery } = useStore();
  const [all, setAll] = useState<PhotoRecord[]>([]);
  const [query, setQuery] = useState('');
  const [album, setAlbum] = useState<string>('__all');
  const [sort, setSort] = useState<SortKey>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [viewer, setViewer] = useState<PhotoRecord | null>(null);
  const [viewerUrl, setViewerUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const list = await photos.all();
    setAll(list);
  }, []);

  useEffect(() => { void reload(); }, [reload, galleryVersion]);

  const albums = useMemo(() => {
    const s = new Set<string>();
    all.forEach((p) => s.add(p.album));
    return ['__all', '__fav', ...Array.from(s)];
  }, [all]);

  const list = useMemo(() => {
    let out = all;
    if (album === '__fav') out = out.filter((p) => p.favorite);
    else if (album !== '__all') out = out.filter((p) => p.album === album);
    if (query) out = out.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
    out = [...out].sort((a, b) => {
      let v = 0;
      if (sort === 'date') v = a.createdAt - b.createdAt;
      else if (sort === 'size') v = a.blob.size - b.blob.size;
      else v = a.name.localeCompare(b.name);
      return sortAsc ? v : -v;
    });
    return out;
  }, [all, album, query, sort, sortAsc]);

  const openViewer = (p: PhotoRecord) => {
    setViewer(p);
    setViewerUrl(URL.createObjectURL(p.blob));
  };
  const closeViewer = () => {
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    setViewer(null); setViewerUrl('');
  };

  const onImport = async (files: FileList | null) => {
    if (!files) return;
    let n = 0;
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      await savePhotoRecord({ blob: f, source: 'import', name: f.name.replace(/\.[^.]+$/, '') });
      n++;
    }
    if (n) { toast(`Imported ${n} image${n === 1 ? '' : 's'}`); bumpGallery(); }
  };

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="safe-t px-3 pb-2 pt-3" style={{ background: 'var(--bg-2)', borderBottom: '1px solid var(--line-soft)' }}>
        <div className="mb-2 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
            <Search size={14} style={{ color: 'var(--text-mute)' }} />
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search photos…"
              className="w-full bg-transparent text-xs outline-none" style={{ color: 'var(--text)' }}
            />
          </div>
          <button className="icon-btn" onClick={() => fileRef.current?.click()} title="Import images"><ImagePlus size={17} /></button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void onImport(e.target.files); e.target.value = ''; }} />
        </div>
        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
          {albums.map((a) => (
            <button key={a} className={`chip ${album === a ? 'on' : ''}`} onClick={() => setAlbum(a)}>
              {a === '__fav' && <Star size={11} />}{a === '__all' ? 'All' : a === '__fav' ? 'Favorites' : a}
            </button>
          ))}
          <button className="chip" onClick={async () => {
            const name = prompt('New album name');
            if (!name) return;
            if (viewer) { await photos.put({ ...viewer, album: name }); }
            setAlbum(name);
          }}><FolderPlus size={11} /> New</button>
          <span className="mx-1 h-4 w-px flex-none" style={{ background: 'var(--line)' }} />
          <button className="chip font-num" onClick={() => { setSort(sort === 'date' ? 'size' : sort === 'size' ? 'name' : 'date'); }}>
            <ArrowUpDown size={11} /> {sort}
          </button>
          <button className="chip font-num" onClick={() => setSortAsc(!sortAsc)}>{sortAsc ? '↑' : '↓'}</button>
        </div>
      </div>

      {/* grid */}
      <div className="flex-1 overflow-y-auto p-1.5">
        {list.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="panel flex h-16 w-16 items-center justify-center rounded-2xl"><CameraIcon size={24} style={{ color: 'var(--gold)' }} /></div>
            <div>
              <div className="text-sm font-medium">No photos yet</div>
              <p className="mt-1 max-w-[240px] text-xs leading-relaxed" style={{ color: 'var(--text-mute)' }}>
                Shoot with the LUMEN camera, edit in the darkroom, or import images from your device.
              </p>
            </div>
            <div className="flex gap-2">
              <button className="btn-gold px-4 py-2 text-xs" onClick={() => fileRef.current?.click()}>Import images</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5">
            {list.map((p) => (
              <button key={p.id} className="group relative aspect-square overflow-hidden rounded-md outline-none" onClick={() => openViewer(p)} style={{ background: 'var(--panel)' }}>
                <img src={p.thumb} alt={p.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-active:scale-95" />
                {p.meta?.raw && (
                  <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded px-1 py-0.5 text-[8px] font-bold" style={{ background: 'rgba(0,0,0,0.7)', color: 'var(--gold)' }}>
                    <FileDigit size={9} /> NEG
                  </span>
                )}
                {p.favorite && <Star size={11} className="absolute right-1 top-1" style={{ color: 'var(--gold)', fill: 'var(--gold)' }} />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* viewer */}
      {viewer && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(4,5,6,0.97)' }}>
          <div className="safe-t flex items-center justify-between px-3 py-2">
            <button className="icon-btn" onClick={closeViewer}><X size={19} /></button>
            <div className="min-w-0 flex-1 px-2 text-center">
              <div className="truncate text-xs font-medium">{viewer.name}</div>
              <div className="font-num text-[10px]" style={{ color: 'var(--text-mute)' }}>
                {viewer.width}×{viewer.height} · {fmtBytes(viewer.blob.size)} · {viewer.format.toUpperCase()}{viewer.meta?.raw ? ' · LOSSLESS NEGATIVE' : ''}
              </div>
            </div>
            <button className={`icon-btn ${viewer.favorite ? 'on' : ''}`} onClick={async () => {
              const upd = { ...viewer, favorite: !viewer.favorite };
              await photos.put(upd); setViewer(upd); void reload();
            }}><Star size={17} style={viewer.favorite ? { fill: 'currentColor' } : {}} /></button>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center p-2">
            <img src={viewerUrl} alt="" className="max-h-full max-w-full object-contain" style={{ boxShadow: '0 10px 60px rgba(0,0,0,0.6)' }} />
          </div>

          {/* details */}
          <div className="mx-3 mb-2 rounded-xl p-3" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
            <div className="font-num grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] sm:grid-cols-4" style={{ color: 'var(--text-mute)' }}>
              <span>ISO <b style={{ color: 'var(--text-dim)' }}>{viewer.meta?.iso ?? '—'}</b></span>
              <span>Shutter <b style={{ color: 'var(--text-dim)' }}>{viewer.meta?.exposureTimeMs ? (viewer.meta.exposureTimeMs >= 1000 ? (viewer.meta.exposureTimeMs / 1000) + 's' : '1/' + Math.round(1000 / viewer.meta.exposureTimeMs)) : '—'}</b></span>
              <span>WB <b style={{ color: 'var(--text-dim)' }}>{viewer.meta?.whiteBalance ?? '—'}</b></span>
              <span>Source <b style={{ color: 'var(--text-dim)' }}>{viewer.source}</b></span>
              <span className="col-span-2 truncate">Lens <b style={{ color: 'var(--text-dim)' }}>{viewer.meta?.lens ?? '—'}</b></span>
              <span className="col-span-2">Captured <b style={{ color: 'var(--text-dim)' }}>{new Date(viewer.createdAt).toLocaleString()}</b></span>
              {viewer.meta?.apertureNote && <span className="col-span-2 truncate">Note <b style={{ color: 'var(--text-dim)' }}>{viewer.meta.apertureNote}</b></span>}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Info size={11} style={{ color: 'var(--text-mute)' }} />
              <span className="text-[10px]" style={{ color: 'var(--text-mute)' }}>
                EXIF is read at capture for camera shots. Originals stay untouched; edits are saved as new files.
              </span>
            </div>
          </div>

          {/* actions */}
          <div className="safe-b flex items-center justify-around px-4 pb-4 pt-1">
            <ViewerAction icon={<SlidersHorizontal size={19} />} label="Edit" onClick={() => { const p = viewer; closeViewer(); openInEditor(p); }} />
            <ViewerAction icon={<Layers size={19} />} label="Studio" onClick={() => { const p = viewer; closeViewer(); openInStudio(p); }} />
            <ViewerAction icon={<Share2 size={19} />} label="Share" onClick={async () => {
              const ok = await shareBlob(`${viewer.name}.${viewer.format === 'jpeg' ? 'jpg' : viewer.format}`, viewer.blob);
              if (!ok) { downloadBlob(`${viewer.name}.${viewer.format === 'jpeg' ? 'jpg' : viewer.format}`, viewer.blob); toast('Sharing unavailable — downloaded instead', 'info'); }
            }} />
            <ViewerAction icon={<Download size={19} />} label="Save" onClick={() => { downloadBlob(`${viewer.name}.${viewer.format === 'jpeg' ? 'jpg' : viewer.format}`, viewer.blob); toast('Original downloaded'); }} />
            <ViewerAction icon={<Trash2 size={19} />} label="Delete" danger onClick={async () => {
              if (!confirm(`Delete "${viewer.name}" permanently?`)) return;
              await photos.remove(viewer.id);
              closeViewer(); bumpGallery(); toast('Photo deleted');
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

function ViewerAction(props: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className="flex flex-col items-center gap-1" onClick={props.onClick}>
      <span className="flex h-11 w-11 items-center justify-center rounded-full" style={{
        background: 'var(--panel-2)', border: '1px solid var(--line)',
        color: props.danger ? 'var(--danger)' : 'var(--text-dim)',
      }}>{props.icon}</span>
      <span className="text-[9px] font-medium" style={{ color: 'var(--text-mute)' }}>{props.label}</span>
    </button>
  );
}
