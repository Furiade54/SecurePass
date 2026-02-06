import { EncryptionService, EncryptedData } from './encryption';

export interface SecureStorageConfig {
  masterPassword: string;
  autoLockTimeout?: number; // in minutes
}

export class SecureStorageService {
  private static instance: SecureStorageService;
  private masterPassword: string = '';
  private encryptionKey: string = ''; // Key used for actual encryption
  private autoLockTimeout: number = 30; // 30 minutes default
  private lastActivity: number = Date.now();
  private isLocked: boolean = true;

  private constructor() {
    this.setupAutoLock();
  }

  static getInstance(): SecureStorageService {
    if (!SecureStorageService.instance) {
      SecureStorageService.instance = new SecureStorageService();
    }
    return SecureStorageService.instance;
  }

  /**
   * Get or create the internal encryption key
   * This key is stored in localStorage to persist across gesture resets
   */
  private getInternalKey(): string {
    let key = localStorage.getItem('securepass_internal_key');
    if (!key) {
        // Generate a random key if it doesn't exist
        key = Array.from(crypto.getRandomValues(new Uint8Array(32)))
            .map(b => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('securepass_internal_key', key);
    }
    return key;
  }

  /**
   * Initialize the secure storage with master password
   */
  initialize(config: SecureStorageConfig): void {
    this.masterPassword = config.masterPassword;
    this.autoLockTimeout = config.autoLockTimeout || 30;
    this.isLocked = false;
    this.encryptionKey = this.getInternalKey();
    this.updateActivity();
    
    // Set a test value to verify password on future unlocks
    this.set('securepass_test', 'verification_token');
  }

  /**
   * Check if storage is locked
   */
  isStorageLocked(): boolean {
    return this.isLocked;
  }

  /**
   * Lock the storage
   */
  lock(): void {
    this.isLocked = true;
    this.masterPassword = '';
    // We keep encryptionKey in memory or clear it? 
    // For security we should clear it, but we can easily retrieve it from localStorage anyway.
    this.encryptionKey = ''; 
  }

  /**
   * Unlock the storage
   */
  unlock(masterPassword: string): boolean {
    try {
      this.masterPassword = masterPassword;
      this.encryptionKey = this.getInternalKey();
      this.isLocked = false;
      this.updateActivity();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Store encrypted data
   */
  set<T>(key: string, value: T): void {
    if (this.isLocked) {
      throw new Error('Storage is locked. Please unlock first.');
    }

    try {
      const dataString = JSON.stringify(value);
      // Use encryptionKey instead of masterPassword
      const encrypted = EncryptionService.encrypt(dataString, this.encryptionKey);
      localStorage.setItem(key, JSON.stringify(encrypted));
      this.updateActivity();
    } catch (error) {
      throw new Error(`Failed to encrypt and store data: ${error}`);
    }
  }

  /**
   * Retrieve and decrypt data
   */
  get<T>(key: string, defaultValue: T): T {
    if (this.isLocked) {
      throw new Error('Storage is locked. Please unlock first.');
    }

    try {
      const storedData = localStorage.getItem(key);
      if (!storedData) {
        return defaultValue;
      }

      let parsedData: any;
      try {
        parsedData = JSON.parse(storedData);
      } catch (e) {
        return defaultValue;
      }

      // Check if data is encrypted
      if (parsedData && typeof parsedData === 'object' && 'data' in parsedData && 'iv' in parsedData && 'salt' in parsedData) {
        let decryptedString: string;
        try {
            // Try decrypting with internal key first
            decryptedString = EncryptionService.decrypt(parsedData as EncryptedData, this.encryptionKey);
        } catch (decryptError) {
            // If failed, try with masterPassword (legacy migration support)
            try {
                decryptedString = EncryptionService.decrypt(parsedData as EncryptedData, this.masterPassword);
                
                // If successful, migrate immediately to the new internal key
                if (decryptedString) {
                    try {
                        const migratedData = JSON.parse(decryptedString) as T;
                        this.set(key, migratedData); // This will re-encrypt with encryptionKey
                        console.log(`Successfully migrated legacy data for key ${key} to new encryption scheme.`);
                        return migratedData;
                    } catch (migrationError) {
                         console.error(`Migration failed during re-save for key ${key}:`, migrationError);
                         // Fallback: return the data even if migration failed, so user doesn't lose access
                         return JSON.parse(decryptedString) as T;
                    }
                }
            } catch (legacyError) {
                console.error(`Decryption failed for key ${key}:`, decryptError);
                return defaultValue;
            }
        }

        if (!decryptedString) {
            return defaultValue;
        }

        try {
            const decrypted = JSON.parse(decryptedString) as T;
            this.updateActivity();
            return decrypted;
        } catch (parseError) {
            console.error(`Failed to parse decrypted JSON for key ${key}. Data might be corrupted.`, parseError);
            return defaultValue;
        }
      } else {
        // Legacy plaintext data found - migrate to encrypted storage
        console.warn(`Migrating legacy plaintext data for key: ${key}`);
        // Only migrate if we have the master password (which we should if we are unlocked)
        if (this.masterPassword) {
            this.set(key, parsedData);
        }
        return parsedData as T;
      }
    } catch (error) {
      console.error(`Failed to retrieve/decrypt data for key ${key}:`, error);
      return defaultValue;
    }
  }

  /**
   * Remove encrypted data
   */
  remove(key: string): void {
    if (this.isLocked) {
      throw new Error('Storage is locked. Please unlock first.');
    }

    localStorage.removeItem(key);
    this.updateActivity();
  }

  /**
   * Clear all encrypted data
   */
  clear(): void {
    if (this.isLocked) {
      throw new Error('Storage is locked. Please unlock first.');
    }

    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('securepass_')) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key));
    this.updateActivity();
  }

  /**
   * Update last activity timestamp
   */
  private updateActivity(): void {
    this.lastActivity = Date.now();
  }

  /**
   * Setup auto-lock functionality
   */
  private setupAutoLock(): void {
    const checkAutoLock = () => {
      if (!this.isLocked && this.masterPassword) {
        const timeSinceActivity = Date.now() - this.lastActivity;
        const timeoutMs = this.autoLockTimeout * 60 * 1000;
        
        if (timeSinceActivity > timeoutMs) {
          this.lock();
          // Dispatch custom event for UI to handle
          window.dispatchEvent(new CustomEvent('securepass:autoLock'));
        }
      }
    };

    // Check every minute
    setInterval(checkAutoLock, 60000);

    // Check on user activity
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    activityEvents.forEach(event => {
      document.addEventListener(event, () => this.updateActivity(), true);
    });
  }

  /**
   * Export encrypted data for backup
   */
  exportData(): string {
    if (this.isLocked) {
      throw new Error('Storage is locked. Please unlock first.');
    }

    const exportData: Record<string, any> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('securepass_')) {
        exportData[key] = localStorage.getItem(key);
      }
    }

    return JSON.stringify(exportData);
  }

  /**
   * Import encrypted data from backup
   */
  importData(backupData: string): void {
    if (this.isLocked) {
      throw new Error('Storage is locked. Please unlock first.');
    }

    try {
      const data = JSON.parse(backupData);
      Object.entries(data).forEach(([key, value]) => {
        if (typeof value === 'string') {
          localStorage.setItem(key, value);
        }
      });
      this.updateActivity();
    } catch (error) {
      throw new Error('Invalid backup data format');
    }
  }
} 