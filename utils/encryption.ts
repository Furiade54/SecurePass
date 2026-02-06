import CryptoJS from 'crypto-js';

export interface EncryptedData {
  data: string;
  iv: string;
  salt: string;
}

export class EncryptionService {
  private static readonly KEY_SIZE = 256;
  private static readonly IV_SIZE = 16;
  private static readonly SALT_SIZE = 32;
  private static readonly ITERATIONS = 5000; // Reduced for performance (was 100,000)
  private static readonly LEGACY_ITERATIONS = 100000; // For backward compatibility

  /**
   * Derive a key from a password using PBKDF2
   */
  private static deriveKey(password: string, salt: string, iterations: number = this.ITERATIONS): CryptoJS.lib.WordArray {
    return CryptoJS.PBKDF2(password, salt, {
      keySize: this.KEY_SIZE / 32,
      iterations: iterations,
      hasher: CryptoJS.algo.SHA256
    });
  }

  /**
   * Encrypt data with AES-256-CBC
   */
  static encrypt(data: string, password: string): EncryptedData {
    const salt = CryptoJS.lib.WordArray.random(this.SALT_SIZE);
    const key = this.deriveKey(password, CryptoJS.enc.Hex.stringify(salt), this.ITERATIONS);
    const iv = CryptoJS.lib.WordArray.random(this.IV_SIZE);
    
    const encrypted = CryptoJS.AES.encrypt(data, key, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7
    });

    return {
      data: encrypted.toString(),
      iv: CryptoJS.enc.Hex.stringify(iv),
      salt: CryptoJS.enc.Hex.stringify(salt)
    };
  }

  /**
   * Decrypt data with AES-256-CBC
   */
  static decrypt(encryptedData: EncryptedData, password: string): string {
    // Helper function to try decryption with specific iterations
    const tryDecrypt = (iterations: number): string => {
      const key = this.deriveKey(password, encryptedData.salt, iterations);
      const decrypted = CryptoJS.AES.decrypt(encryptedData.data, key, {
        iv: CryptoJS.enc.Hex.parse(encryptedData.iv),
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      });
      return decrypted.toString(CryptoJS.enc.Utf8);
    };

    try {
      // Try with current optimized iterations first
      const result = tryDecrypt(this.ITERATIONS);
      if (result) return result;
      throw new Error('Decryption resulted in empty string');
    } catch (error) {
      try {
        // Fallback to legacy iterations
        const legacyResult = tryDecrypt(this.LEGACY_ITERATIONS);
        if (legacyResult) return legacyResult;
        throw new Error('Legacy decryption failed');
      } catch (legacyError) {
        throw new Error('Decryption failed. Invalid password or corrupted data.');
      }
    }
  }

  /**
   * Generate a secure random key
   */
  static generateSecureKey(): string {
    return CryptoJS.lib.WordArray.random(32).toString();
  }

  /**
   * Hash a password for gesture pattern storage
   */
  static hashGesturePattern(pattern: number[]): string {
    const patternString = pattern.join(',');
    return CryptoJS.SHA256(patternString).toString();
  }

  /**
   * Verify gesture pattern
   */
  static verifyGesturePattern(pattern: number[], hash: string): boolean {
    const patternHash = this.hashGesturePattern(pattern);
    return patternHash === hash;
  }
} 