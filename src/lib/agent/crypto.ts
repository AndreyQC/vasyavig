import {invoke} from "@tauri-apps/api/core";

/**
 * Тонкие обёртки crypto-команд Rust для формы настроек.
 * Секреты не логируются; сгенерированный Fernet-ключ показывается один раз
 * и в конфиг не пишется — только в env пользователя.
 */

export type CryptoResult = {ok: true; value: string} | {ok: false; error: string};

function fail(error: unknown): CryptoResult {
  return {ok: false, error: String(error)};
}

/** Новый Fernet-ключ (base64-url, 32 bytes). */
export async function generateFernetKey(): Promise<CryptoResult> {
  try {
    const value = await invoke<string>("generate_fernet_key");
    return {ok: true, value};
  } catch (e) {
    return fail(e);
  }
}

/** Зашифровать ключ значением env-переменной `envVar` -> crypto-токен. */
export async function encryptText(plaintext: string, envVar: string): Promise<CryptoResult> {
  try {
    const value = await invoke<string>("encrypt_text", {plaintext, envVar});
    return {ok: true, value};
  } catch (e) {
    return fail(e);
  }
}

/** Расшифровать crypto-токен (диагностика; в UI обычно не нужно). */
export async function resolveCryptoToken(token: string): Promise<CryptoResult> {
  try {
    const value = await invoke<string>("resolve_crypto_token", {token});
    return {ok: true, value};
  } catch (e) {
    return fail(e);
  }
}
