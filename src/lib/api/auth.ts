/**
 * Auth token holder.
 *
 * The token is what the original app stored under the store key `"token"` and
 * sent as a raw `Authorization` header (no "Bearer" prefix). Here it lives in
 * memory, with an optional pluggable async loader so a persistent store (Tauri
 * plugin-store, localStorage, …) can hydrate it at startup WITHOUT this module
 * taking a hard dependency on any storage backend.
 *
 * Usage:
 *   import { setTokenLoader, loadToken, setToken } from "./auth";
 *   setTokenLoader(async () => (await store.get<string>("token")) ?? null);
 *   await loadToken();            // hydrate once at boot
 *   setToken(loginResult.LoginAccessToken); // after a successful login
 */

let inMemoryToken: string | null = null;

/** Pluggable async source for the persisted token. Defaults to localStorage. */
let tokenLoader: () => Promise<string | null> = async () => {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem("token");
    }
  } catch {
    /* localStorage may be unavailable (SSR / locked-down WebView). */
  }
  return null;
};

/** Optional sink so writes can be persisted alongside the in-memory copy. */
let tokenSaver: ((token: string | null) => void | Promise<void>) | null =
  async (token) => {
    try {
      if (typeof localStorage === "undefined") return;
      if (token === null) localStorage.removeItem("token");
      else localStorage.setItem("token", token);
    } catch {
      /* ignore persistence failures */
    }
  };

/** Replace the persisted-token loader (e.g. to read from a Tauri store). */
export function setTokenLoader(loader: () => Promise<string | null>): void {
  tokenLoader = loader;
}

/** Replace the persisted-token saver. Pass `null` to disable persistence. */
export function setTokenSaver(
  saver: ((token: string | null) => void | Promise<void>) | null,
): void {
  tokenSaver = saver;
}

/** Read the current in-memory token synchronously (null when logged out). */
export function getToken(): string | null {
  return inMemoryToken;
}

/** True when a token is held in memory. */
export function isAuthenticated(): boolean {
  return inMemoryToken !== null && inMemoryToken.length > 0;
}

/** Set (or clear) the token; also persists via the configured saver. */
export function setToken(token: string | null): void {
  inMemoryToken = token && token.length > 0 ? token : null;
  void tokenSaver?.(inMemoryToken);
}

/** Hydrate the in-memory token from the persisted store. Returns the token. */
export async function loadToken(): Promise<string | null> {
  const persisted = await tokenLoader();
  inMemoryToken = persisted && persisted.length > 0 ? persisted : null;
  return inMemoryToken;
}

/** Clear the token (logout). */
export function clearToken(): void {
  setToken(null);
}
