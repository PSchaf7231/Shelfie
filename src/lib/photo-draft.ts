import { MAX_PHOTOS, MAX_PREPARED_PHOTO_BYTES } from "./photo-limits";
import type { Photo } from "./photo-client";

type DraftPhoto = { id: string; blob?: Blob };
export type PhotoDraft = { key: string; revision: number; expiresAt: number; photos: DraftPhoto[] };
const DATABASE = "shelfie-photo-drafts";
const STORE = "drafts";
const DAY = 24 * 60 * 60 * 1000;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("Draft storage unavailable")); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Draft storage unavailable"));
    request.onblocked = () => reject(new Error("Draft storage unavailable"));
  });
}

async function transaction<T>(operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      // Expire old pending images, including drafts from an earlier login.
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (row) { if (!(row.value.expiresAt > Date.now())) row.delete(); row.continue(); }
      };
      const request = operation(store);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(new Error("Draft storage unavailable"));
    });
  } finally { db.close(); }
}

export async function loadPhotoDraft(key: string, revision: number): Promise<PhotoDraft | undefined> {
  const draft = await transaction<PhotoDraft | undefined>(store => store.get(key));
  if (!draft) return;
  if (draft.revision !== revision || !Number.isFinite(draft.expiresAt) || draft.expiresAt <= Date.now() || !Array.isArray(draft.photos) || draft.photos.length > MAX_PHOTOS
    || draft.photos.some(photo => !photo || !/^[a-f0-9-]{36}$/.test(photo.id) || (photo.blob !== undefined && (!(photo.blob instanceof Blob) || !photo.blob.size || photo.blob.size > MAX_PREPARED_PHOTO_BYTES || photo.blob.type !== "image/jpeg")))
    || new Set(draft.photos.map(photo => photo.id)).size !== draft.photos.length) {
    await clearPhotoDraft(key); return;
  }
  return draft;
}

export async function savePhotoDraft(key: string, revision: number, photos: Photo[]) {
  const draft: PhotoDraft = { key, revision, expiresAt: Date.now() + DAY, photos: photos.map(photo => ({ id: photo.id, ...(photo.file ? { blob: photo.file } : {}) })) };
  await transaction(store => store.put(draft));
}

export async function clearPhotoDraft(key: string) { await transaction(store => store.delete(key)); }
