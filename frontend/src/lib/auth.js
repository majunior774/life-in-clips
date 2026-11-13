// Stores the access key (the backend's ACCESS_KEY) in this browser only.
// Falls back to memory if browser storage is unavailable (private windows, blocked storage).
const STORAGE_KEY = 'lic.accessKey';
let memoryKey = '';

export function getAccessKey() {
  try {
    return localStorage.getItem(STORAGE_KEY) || memoryKey;
  } catch {
    return memoryKey;
  }
}

export function setAccessKey(key) {
  memoryKey = key;
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // memory fallback already set
  }
}

export function clearAccessKey() {
  memoryKey = '';
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}
