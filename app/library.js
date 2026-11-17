// Audio blobs live in IndexedDB, shared by pages on this browser origin.
let database;
export function openLibrary() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('lamp-studio-library', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('tracks', {keyPath: 'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}
async function operation(mode, action) {
  const db = await openLibrary();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tracks', mode);
    const request = action(tx.objectStore('tracks'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Library transaction cancelled'));
  });
}
export const loadTracks = () => operation('readonly', store => store.getAll());
export const saveTrack = record => operation('readwrite', store => store.put(record));
export const deleteTrack = id => operation('readwrite', store => store.delete(id));
