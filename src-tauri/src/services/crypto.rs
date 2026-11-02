//! Шифрование/расшифровка значений в формате `crypto__<ENV>__<ciphertext>`.
//!
//! Реализация Fernet (AES-128-CBC + HMAC-SHA256), совместимая с Python
//! `cryptography.fernet`. Ключ берётся из переменной окружения, имя которой
//! записано в токене; key[:16] — signing key, key[16:] — encryption key.
//!
//! Только чистые Rust-крейты (без системного OpenSSL), чтобы сборка на
//! Windows не зависела от C-тулчейна. Значения и ключи не логируются.

use aes::cipher::block_padding::Pkcs7;
use aes::cipher::{BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine as _;
use cbc::cipher::generic_array::GenericArray;
use cbc::{Decryptor, Encryptor};
use hmac::{Hmac, Mac};
use sha2::Sha256;

pub const CIPHER_PREFIX: &str = "crypto";
const VERSION: u8 = 0x80;

type HmacSha256 = Hmac<Sha256>;

/// Проверяет, что строка имеет вид `crypto__<ENV>__<ciphertext>`.
pub fn is_crypto_token(s: &str) -> bool {
    let parts: Vec<&str> = s.trim().split("__").collect();
    parts.len() == 3 && parts[0] == CIPHER_PREFIX && !parts[1].is_empty() && !parts[2].is_empty()
}

/// Расшифровывает `crypto__<ENV>__<ciphertext>`; ключ Fernet — из `ENV`.
pub fn decrypt_crypto_token(encrypted_data: &str) -> Result<String, String> {
    let trimmed = encrypted_data.trim();
    if !is_crypto_token(trimmed) {
        return Err("Строка не в ожидаемом crypto-формате".to_string());
    }

    let parts: Vec<&str> = trimmed.split("__").collect();
    let key_env_variable = parts[1];
    let token = parts[2];

    let raw_key = std::env::var(key_env_variable)
        .map_err(|_| format!("Для расшифровки нужна переменная окружения {key_env_variable}"))?;

    let plaintext = fernet_decrypt(token, raw_key.trim())?;

    String::from_utf8(plaintext)
        .map_err(|_| "Расшифрованные данные не являются валидным UTF-8".to_string())
}

/// Если строка — crypto-токен, расшифровывает; иначе возвращает как есть.
pub fn resolve_value(s: &str) -> Result<String, String> {
    if is_crypto_token(s) {
        decrypt_crypto_token(s)
    } else {
        Ok(s.trim().to_string())
    }
}

/// Генерирует новый Fernet-ключ: base64-url, 32 bytes (как Python `Fernet.generate_key()`).
pub fn generate_fernet_key() -> String {
    let mut key = [0u8; 32];
    rand::fill(&mut key);
    URL_SAFE.encode(key)
}

/// Шифрует plaintext ключом из `env_var`; результат — `crypto__<ENV>__<ciphertext>`.
pub fn encrypt_text(plaintext: &str, env_var: &str) -> Result<String, String> {
    let env_var = env_var.trim();
    if env_var.is_empty() {
        return Err("Не указана переменная окружения для Fernet-ключа".to_string());
    }
    let raw_key = std::env::var(env_var)
        .map_err(|_| format!("Для шифрования нужна переменная окружения {env_var}"))?;

    let ciphertext = fernet_encrypt(plaintext.as_bytes(), raw_key.trim())?;
    Ok(format!("{CIPHER_PREFIX}__{env_var}__{ciphertext}"))
}

fn decode_b64(input: &str) -> Result<Vec<u8>, String> {
    let trimmed = input.trim();
    URL_SAFE
        .decode(trimmed)
        .or_else(|_| URL_SAFE_NO_PAD.decode(trimmed))
        .map_err(|_| "Значение не является валидным base64url".to_string())
}

/// Fernet-encrypt: base64url(VERSION || timestamp || iv || ciphertext || hmac).
fn fernet_encrypt(plaintext: &[u8], key_b64: &str) -> Result<String, String> {
    let key = decode_key(key_b64)?;
    let sign_key = &key[0..16];
    let enc_key = &key[16..32];

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "Системное время до эпохи Unix".to_string())?
        .as_secs();

    let mut iv = [0u8; 16];
    rand::fill(&mut iv);

    let enc_key_ga = GenericArray::from_slice(enc_key);
    let iv_ga = GenericArray::from_slice(&iv);
    let cipher = Encryptor::<aes::Aes128>::new(enc_key_ga, iv_ga);
    let ciphertext = cipher.encrypt_padded_vec_mut::<Pkcs7>(plaintext);

    // payload = VERSION || timestamp || iv || ciphertext
    let mut payload = Vec::with_capacity(1 + 8 + 16 + ciphertext.len() + 32);
    payload.push(VERSION);
    payload.extend_from_slice(&timestamp.to_be_bytes());
    payload.extend_from_slice(&iv);
    payload.extend_from_slice(&ciphertext);

    let mut mac = HmacSha256::new_from_slice(sign_key)
        .map_err(|_| "Ошибка инициализации HMAC".to_string())?;
    mac.update(&payload);
    payload.extend_from_slice(&mac.finalize().into_bytes());

    Ok(URL_SAFE.encode(&payload))
}

/// Fernet-decrypt: проверяет HMAC (constant-time), затем AES-CBC-PKCS7.
fn fernet_decrypt(token: &str, key_b64: &str) -> Result<Vec<u8>, String> {
    let key = decode_key(key_b64)?;
    let sign_key = &key[0..16];
    let enc_key = &key[16..32];

    let data = decode_b64(token)?;

    if data.len() < 33 {
        return Err("Токен слишком короткий".to_string());
    }
    if data[0] != VERSION {
        return Err("Неподдерживаемая версия Fernet-токена".to_string());
    }

    let hmac_offset = data.len() - 32;
    let payload = &data[0..hmac_offset];
    let hmac = &data[hmac_offset..];

    let mut mac = HmacSha256::new_from_slice(sign_key)
        .map_err(|_| "Ошибка инициализации HMAC".to_string())?;
    mac.update(payload);
    mac.verify_slice(hmac)
        .map_err(|_| "HMAC Fernet-токена не совпадает: невалидный ключ или токен".to_string())?;

    // iv = data[9..25], ciphertext = data[25..hmac_offset]
    let iv = &data[9..25];
    let ciphertext = &data[25..hmac_offset];

    let enc_key_ga = GenericArray::from_slice(enc_key);
    let iv_ga = GenericArray::from_slice(iv);
    let cipher = Decryptor::<aes::Aes128>::new(enc_key_ga, iv_ga);
    cipher
        .decrypt_padded_vec_mut::<Pkcs7>(ciphertext)
        .map_err(|_| "Ошибка AES-расшифровки".to_string())
}

fn decode_key(key_b64: &str) -> Result<Vec<u8>, String> {
    let key =
        decode_b64(key_b64).map_err(|_| "Fernet-ключ не является валидным base64".to_string())?;
    if key.len() != 32 {
        return Err(format!(
            "Fernet-ключ должен быть 32 bytes после декодирования, получено {}",
            key.len()
        ));
    }
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_crypto_token() {
        assert!(is_crypto_token("crypto__TEST_KEY__abc123"));
        assert!(!is_crypto_token("plain-text"));
        assert!(!is_crypto_token("crypto__missing_part"));
        assert!(!is_crypto_token("crypto____empty"));
    }

    #[test]
    fn resolves_plain_value_as_is() {
        assert_eq!(
            resolve_value(" https://api.openai.com/v1 ").unwrap(),
            "https://api.openai.com/v1"
        );
    }

    #[test]
    fn roundtrip_encrypt_decrypt() {
        let key = generate_fernet_key();
        std::env::set_var("TEST_FERNET_KEY", &key);

        let plaintext = "sk-abc123";
        let encrypted = encrypt_text(plaintext, "TEST_FERNET_KEY").unwrap();
        assert!(is_crypto_token(&encrypted));
        assert!(encrypted.starts_with("crypto__TEST_FERNET_KEY__"));

        assert_eq!(decrypt_crypto_token(&encrypted).unwrap(), plaintext);
        assert_eq!(resolve_value(&encrypted).unwrap(), plaintext);
    }

    #[test]
    fn decrypts_real_python_fernet_token() {
        // Сгенерировано Python `cryptography.fernet`:
        // KEY: 0MemqdrH9H_zImU1u0IrDjRighe-D1rUSN3r3cJJJMY=
        // TOKEN: gAAAAABqXFdc... -> "https://api.openai.com/v1"
        std::env::set_var(
            "PY_REAL_KEY",
            "0MemqdrH9H_zImU1u0IrDjRighe-D1rUSN3r3cJJJMY=",
        );
        let encrypted = "crypto__PY_REAL_KEY__gAAAAABqXFdc8d8sh8VYEj-zzvaOcP7XKWk9CNDD4Sv7xPCa-eUCleRQJKSn6lHzU8TblxVvkJ5EgqHMmGhu8FxMBJye02XmAdcZOlp5pWjytMfmsqB_Qzc=";
        assert_eq!(
            decrypt_crypto_token(encrypted).unwrap(),
            "https://api.openai.com/v1"
        );
    }

    #[test]
    fn rejects_wrong_env_key() {
        let key = generate_fernet_key();
        std::env::set_var("TAMPER_KEY_OK", &key);
        std::env::set_var("TAMPER_KEY_WRONG", generate_fernet_key());

        let encrypted = encrypt_text("secret", "TAMPER_KEY_OK").unwrap();
        let wrong_token = encrypted.replace("TAMPER_KEY_OK", "TAMPER_KEY_WRONG");
        assert!(decrypt_crypto_token(&wrong_token).is_err());
    }

    #[test]
    fn encrypt_requires_env_key() {
        std::env::remove_var("MISSING_FERNET_KEY");
        assert!(encrypt_text("secret", "MISSING_FERNET_KEY").is_err());
        assert!(encrypt_text("secret", "  ").is_err());
        assert!(resolve_value("not a token").is_ok());
    }

    #[test]
    fn rejects_tampered_ciphertext() {
        let key = generate_fernet_key();
        std::env::set_var("TAMPER_CT_KEY", &key);
        let encrypted = encrypt_text("payload", "TAMPER_CT_KEY").unwrap();
        let prefix = "crypto__TAMPER_CT_KEY__";
        let token = encrypted.trim_start_matches(prefix);
        let mut data = decode_b64(token).unwrap();
        let last = data.len() - 1;
        data[last] ^= 0x01;
        let tampered = format!("{prefix}{}", URL_SAFE.encode(data));
        assert!(decrypt_crypto_token(&tampered).is_err());
    }
}
