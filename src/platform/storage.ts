import { migrateSave } from '../core/save';
import type { GameState } from '../core/types';

const databaseName = 'pocket-pal';
const databaseVersion = 1;
const storeName = 'saves';
const saveKey = 'current';
const fallbackKey = 'pocket-pal-save-v1';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open save storage.'));
    request.onblocked = () => reject(new Error('Save storage is blocked by another tab.'));
  });
}

function readLocalFallback(): GameState | null {
  try {
    const raw = localStorage.getItem(fallbackKey);
    return raw ? migrateSave(JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export async function loadGame(): Promise<GameState | null> {
  try {
    const database = await openDatabase();
    const stored = await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(saveKey);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not read save data.'));
    });
    database.close();
    if (stored !== undefined) return migrateSave(stored);
  } catch {
    // Fall through to localStorage; the app must remain playable when IDB is blocked.
  }
  return readLocalFallback();
}

export async function saveGame(state: GameState): Promise<'indexeddb' | 'localStorage'> {
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(state, saveKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save game.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Save was interrupted.'));
    });
    database.close();
    return 'indexeddb';
  } catch {
    try {
      localStorage.setItem(fallbackKey, JSON.stringify(state));
      return 'localStorage';
    } catch {
      throw new Error('This browser could not save Pocket Pal. Check available storage.');
    }
  }
}
