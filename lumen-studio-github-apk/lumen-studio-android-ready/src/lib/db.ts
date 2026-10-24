// Local-first persistence: photos, projects, presets, key-value settings.
import { type Preset } from './presets';
import { uid } from './adjust';

const DB_NAME = 'lumen-studio';
const DB_VER = 1;

export interface PhotoMeta {
  iso?: number | null;
  exposureTimeMs?: number | null;
  whiteBalance?: string | null;
  focalLength?: string | null;
  lens?: string | null;
  raw?: boolean;
  negative?: boolean; // lossless digital negative
  apertureNote?: string | null;
}

export interface PhotoRecord {
  id: string;
  name: string;
  blob: Blob;
  thumb: string; // small dataURL
  width: number;
  height: number;
  format: string; // jpeg | png | webp
  source: 'camera' | 'import' | 'edit';
  favorite: boolean;
  album: string;
  createdAt: number;
  meta: PhotoMeta;
}

export interface ProjectRecord {
  id: string;
  name: string;
  updatedAt: number;
  thumb: string;
  width: number;
  height: number;
  payload: string; // serialized layers
}

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('presets')) db.createObjectStore('presets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((res, rej) => {
    const t = db.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  }));
}

export const photos = {
  async put(p: PhotoRecord) { await tx('photos', 'readwrite', (s) => s.put(p)); },
  async get(id: string) { return (await tx('photos', 'readonly', (s) => s.get(id))) as PhotoRecord | undefined; },
  async all() { return (await tx('photos', 'readonly', (s) => s.getAll())) as PhotoRecord[]; },
  async remove(id: string) { await tx('photos', 'readwrite', (s) => s.delete(id)); },
  async clear() { await tx('photos', 'readwrite', (s) => s.clear()); },
};

export const projects = {
  async put(p: ProjectRecord) { await tx('projects', 'readwrite', (s) => s.put(p)); },
  async get(id: string) { return (await tx('projects', 'readonly', (s) => s.get(id))) as ProjectRecord | undefined; },
  async all() { return (await tx('projects', 'readonly', (s) => s.getAll())) as ProjectRecord[]; },
  async remove(id: string) { await tx('projects', 'readwrite', (s) => s.delete(id)); },
};

export const customPresets = {
  async put(p: Preset) { await tx('presets', 'readwrite', (s) => s.put(p)); },
  async all() { return (await tx('presets', 'readonly', (s) => s.getAll())) as Preset[]; },
  async remove(id: string) { await tx('presets', 'readwrite', (s) => s.delete(id)); },
};

export const kv = {
  async set(key: string, value: unknown) { await tx('kv', 'readwrite', (s) => s.put(value as any, key)); },
  async get<T>(key: string): Promise<T | undefined> { return (await tx('kv', 'readonly', (s) => s.get(key))) as T | undefined; },
};

export async function makeThumb(blob: Blob, size = 320): Promise<{ thumb: string; width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  const f = Math.min(1, size / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * f));
  c.height = Math.max(1, Math.round(bmp.height * f));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const thumb = c.toDataURL('image/jpeg', 0.72);
  const out = { thumb, width: bmp.width, height: bmp.height };
  bmp.close();
  return out;
}

export async function savePhotoRecord(input: {
  blob: Blob; name?: string; source: PhotoRecord['source']; meta?: PhotoMeta; album?: string;
}): Promise<PhotoRecord> {
  const { thumb, width, height } = await makeThumb(input.blob);
  const fmt = input.blob.type.includes('png') ? 'png' : input.blob.type.includes('webp') ? 'webp' : 'jpeg';
  const rec: PhotoRecord = {
    id: uid(),
    name: input.name || `LUMEN_${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)}`,
    blob: input.blob,
    thumb,
    width, height,
    format: fmt,
    source: input.source,
    favorite: false,
    album: input.album || 'All Photos',
    createdAt: Date.now(),
    meta: input.meta || {},
  };
  await photos.put(rec);
  return rec;
}
