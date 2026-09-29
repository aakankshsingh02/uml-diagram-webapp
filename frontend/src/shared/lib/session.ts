const STORAGE_KEY = "uml.sessionToken";

const listeners = new Set<() => void>();
// Used only when storage is unavailable (private mode); the session then lasts until reload.
let memoryToken: string | null = null;

/** Bearer session token issued by the API's /auth/login or /auth/signup. */
export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return memoryToken;
  }
}

export function setSessionToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable; memoryToken keeps the session for this page load.
  }
  listeners.forEach((listener) => listener());
}

/** Notifies on every sign-in/sign-out in this tab, and in other tabs via the storage event. */
export function subscribeSessionToken(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
