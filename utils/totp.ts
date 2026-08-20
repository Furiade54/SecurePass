/**
 * MFA / TOTP (Time-based One-Time Password) Utility
 * Compliant with RFC 6238 and RFC 4226
 * Compatible with Google Authenticator, Microsoft Authenticator, Authy, etc.
 */

import CryptoJS from 'crypto-js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode a Base32 string into a Uint8Array
 */
export function base32ToBytes(base32: string): Uint8Array {
  // Remove whitespace, hyphens, and padding
  const clean = base32.toUpperCase().replace(/[\s\-_=]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    const val = BASE32_ALPHABET.indexOf(clean[i]);
    if (val === -1) {
      continue; // Skip invalid characters
    }
    value = (value << 5) | val;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Encode bytes to a Base32 string
 */
export function bytesToBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Generate a random Base32 secret key
 */
export function generateRandomSecret(length = 20): string {
  const randomBytes = new Uint8Array(length);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < length; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytesToBase32(randomBytes);
}

export interface TotpOptions {
  period?: number;      // default 30 seconds
  digits?: number;      // default 6 digits
  algorithm?: 'SHA-1' | 'SHA-256' | 'SHA-512'; // default SHA-1
  time?: number;        // epoch timestamp in milliseconds (default Date.now())
}

/**
 * Generate a TOTP code synchronously using CryptoJS
 */
export function generateTotpSync(secretBase32: string, options: TotpOptions = {}): string {
  const period = options.period || 30;
  const digits = options.digits || 6;
  const algorithm = options.algorithm || 'SHA-1';
  const timestamp = options.time !== undefined ? options.time : Date.now();

  const epoch = Math.floor(timestamp / 1000);
  const counter = Math.floor(epoch / period);

  // Convert counter to 8-byte big-endian WordArray
  const counterBytes = new Uint8Array(8);
  let temp = counter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = temp & 0xff;
    temp = Math.floor(temp / 256);
  }

  const keyBytes = base32ToBytes(secretBase32);
  if (keyBytes.length === 0) {
    return '000000'.slice(0, digits);
  }

  // Convert key bytes and counter bytes to CryptoJS WordArray
  const keyWords: number[] = [];
  for (let i = 0; i < keyBytes.length; i += 4) {
    let word = 0;
    for (let j = 0; j < 4; j++) {
      word = (word << 8) | (keyBytes[i + j] || 0);
    }
    keyWords.push(word);
  }
  const keyWordArray = CryptoJS.lib.WordArray.create(keyWords, keyBytes.length);

  const counterWords: number[] = [];
  for (let i = 0; i < 8; i += 4) {
    let word = 0;
    for (let j = 0; j < 4; j++) {
      word = (word << 8) | (counterBytes[i + j] || 0);
    }
    counterWords.push(word);
  }
  const counterWordArray = CryptoJS.lib.WordArray.create(counterWords, 8);

  // HMAC calculation
  let hmac: CryptoJS.lib.WordArray;
  if (algorithm === 'SHA-256') {
    hmac = CryptoJS.HmacSHA256(counterWordArray, keyWordArray);
  } else if (algorithm === 'SHA-512') {
    hmac = CryptoJS.HmacSHA512(counterWordArray, keyWordArray);
  } else {
    hmac = CryptoJS.HmacSHA1(counterWordArray, keyWordArray);
  }

  // Extract raw bytes from WordArray
  const hmacBytes: number[] = [];
  for (let i = 0; i < hmac.sigBytes; i++) {
    const word = hmac.words[i >>> 2];
    const byte = (word >>> (24 - (i % 4) * 8)) & 0xff;
    hmacBytes.push(byte);
  }

  // Dynamic truncation (RFC 4226)
  const offset = hmacBytes[hmacBytes.length - 1] & 0x0f;
  const binary =
    ((hmacBytes[offset] & 0x7f) << 24) |
    ((hmacBytes[offset + 1] & 0xff) << 16) |
    ((hmacBytes[offset + 2] & 0xff) << 8) |
    (hmacBytes[offset + 3] & 0xff);

  const otp = binary % Math.pow(10, digits);
  return otp.toString().padStart(digits, '0');
}

/**
 * Get time remaining in current interval
 */
export function getTotpRemainingSeconds(period = 30): number {
  const epoch = Math.floor(Date.now() / 1000);
  return period - (epoch % period);
}

/**
 * Parse an otpauth:// URI (standard used by Google Authenticator and QR codes)
 */
export interface ParsedOtpAuthUri {
  type: 'totp' | 'hotp';
  label: string;
  issuer: string;
  account: string;
  secret: string;
  algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512';
  digits: number;
  period: number;
}

export function parseMigrationProtobuf(buffer: Uint8Array): ParsedOtpAuthUri[] {
  const results: ParsedOtpAuthUri[] = [];
  let pos = 0;

  function readVarint(): number {
    let result = 0;
    let shift = 0;
    while (pos < buffer.length) {
      const b = buffer[pos++];
      result |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    return result;
  }

  while (pos < buffer.length) {
    const tagByte = buffer[pos++];
    const fieldNum = tagByte >> 3;
    const wireType = tagByte & 0x07;

    if (fieldNum === 1 && wireType === 2) {
      const len = readVarint();
      const end = pos + len;
      let secretBytes: Uint8Array = new Uint8Array(0);
      let name = '';
      let issuer = '';
      let algoNum = 1;
      let digitsNum = 1;
      let typeNum = 2;

      while (pos < end && pos < buffer.length) {
        const subTag = buffer[pos++];
        const subField = subTag >> 3;
        const subWire = subTag & 0x07;

        if (subWire === 0) {
          const val = readVarint();
          if (subField === 4) algoNum = val;
          else if (subField === 5) digitsNum = val;
          else if (subField === 6) typeNum = val;
        } else if (subWire === 2) {
          const subLen = readVarint();
          const subData = buffer.slice(pos, pos + subLen);
          pos += subLen;
          if (subField === 1) {
            secretBytes = subData;
          } else if (subField === 2) {
            name = new TextDecoder().decode(subData);
          } else if (subField === 3) {
            issuer = new TextDecoder().decode(subData);
          }
        } else if (subWire === 1) {
          pos += 8;
        } else if (subWire === 5) {
          pos += 4;
        }
      }
      pos = end;

      if (secretBytes.length > 0) {
        const secret = bytesToBase32(secretBytes);
        let account = name;
        if (name.includes(':')) {
          const parts = name.split(':');
          if (!issuer) issuer = parts[0].trim();
          account = parts.slice(1).join(':').trim();
        }
        if (!issuer) issuer = 'MFA';

        let algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512' = 'SHA-1';
        if (algoNum === 2) algorithm = 'SHA-256';
        if (algoNum === 3) algorithm = 'SHA-512';

        const digits = digitsNum === 2 ? 8 : 6;

        results.push({
          type: typeNum === 1 ? 'hotp' : 'totp',
          label: name || issuer,
          issuer: issuer || 'Servicio',
          account,
          secret,
          algorithm,
          digits,
          period: 30
        });
      }
    } else if (wireType === 0) {
      readVarint();
    } else if (wireType === 2) {
      const len = readVarint();
      pos += len;
    } else if (wireType === 1) {
      pos += 8;
    } else if (wireType === 5) {
      pos += 4;
    } else {
      break;
    }
  }

  return results;
}

export function parseAllOtpAuthUris(uri: string): ParsedOtpAuthUri[] {
  const trimmed = uri.trim();
  if (trimmed.toLowerCase().startsWith('otpauth-migration://')) {
    try {
      const url = new URL(trimmed);
      const dataParam = url.searchParams.get('data');
      if (dataParam) {
        const binaryStr = atob(decodeURIComponent(dataParam));
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const decoded = parseMigrationProtobuf(bytes);
        if (decoded.length > 0) {
          return decoded;
        }
      }
    } catch {
      // ignore
    }
  }

  const single = parseOtpAuthUri(trimmed);
  return single ? [single] : [];
}

export function parseOtpAuthUri(uri: string): ParsedOtpAuthUri | null {
  try {
    const trimmed = uri.trim();
    if (trimmed.toLowerCase().startsWith('otpauth-migration://')) {
      const all = parseAllOtpAuthUris(trimmed);
      return all.length > 0 ? all[0] : null;
    }

    if (!trimmed.toLowerCase().startsWith('otpauth://')) {
      // If user pasted raw secret or key-value string
      const cleanSecret = trimmed.replace(/\s+/g, '').toUpperCase();
      if (/^[A-Z2-7]+=*$/.test(cleanSecret)) {
        return {
          type: 'totp',
          label: 'Cuenta',
          issuer: 'MFA',
          account: '',
          secret: cleanSecret,
          algorithm: 'SHA-1',
          digits: 6,
          period: 30,
        };
      }
      return null;
    }

    const url = new URL(trimmed);
    if (url.protocol !== 'otpauth:') return null;

    const type = url.host.toLowerCase() as 'totp' | 'hotp';
    const fullLabel = decodeURIComponent(url.pathname.replace(/^\//, ''));
    let issuer = url.searchParams.get('issuer') || '';
    let account = '';

    if (fullLabel.includes(':')) {
      const parts = fullLabel.split(':');
      if (!issuer) issuer = parts[0].trim();
      account = parts.slice(1).join(':').trim();
    } else {
      account = fullLabel.trim();
    }

    if (!issuer && account) {
      issuer = account;
    }

    const secret = (url.searchParams.get('secret') || '').replace(/\s+/g, '').toUpperCase();
    if (!secret) return null;

    const rawAlgo = (url.searchParams.get('algorithm') || 'SHA1').toUpperCase();
    let algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512' = 'SHA-1';
    if (rawAlgo === 'SHA256' || rawAlgo === 'SHA-256') algorithm = 'SHA-256';
    if (rawAlgo === 'SHA512' || rawAlgo === 'SHA-512') algorithm = 'SHA-512';

    const digits = parseInt(url.searchParams.get('digits') || '6', 10) || 6;
    const period = parseInt(url.searchParams.get('period') || '30', 10) || 30;

    return {
      type,
      label: fullLabel || issuer,
      issuer: issuer || 'Servicio',
      account,
      secret,
      algorithm,
      digits: digits === 8 ? 8 : 6,
      period: period > 0 ? period : 30,
    };
  } catch {
    return null;
  }
}

/**
 * Build a standard otpauth://totp/ URI for sharing or QR code generation
 */
export function buildOtpAuthUri(params: {
  issuer: string;
  account: string;
  secret: string;
  algorithm?: 'SHA-1' | 'SHA-256' | 'SHA-512';
  digits?: number;
  period?: number;
}): string {
  const issuer = encodeURIComponent(params.issuer.trim() || 'SecurePass');
  const account = encodeURIComponent(params.account.trim() || 'Usuario');
  const secret = params.secret.toUpperCase().replace(/[\s\-_=]/g, '');
  const digits = params.digits || 6;
  const period = params.period || 30;
  const algorithm = (params.algorithm || 'SHA-1').replace('-', '');

  return `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=${algorithm}&digits=${digits}&period=${period}`;
}

/**
 * Formats a 6-digit or 8-digit code with a clean center space (e.g. "123 456")
 */
export function formatTotpCode(code: string): string {
  if (code.length === 6) {
    return `${code.slice(0, 3)} ${code.slice(3)}`;
  }
  if (code.length === 8) {
    return `${code.slice(0, 4)} ${code.slice(4)}`;
  }
  return code;
}
