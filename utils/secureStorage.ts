import { EncryptionService, EncryptedData } from './encryption';

export interface SecureStorageConfig {
  masterPassword: string;
  autoLockTimeout?: number; // in minutes
}

export class SecureStorageService {
  private static instance: SecureStorageService;
  private masterPassword: string = '';
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
   * Initialize the secure storage with master password
   */
  initialize(config: SecureStorageConfig): void {
    this.masterPassword = config.masterPassword;
    this.autoLockTimeout = config.autoLockTimeout || 30;
    this.isLocked = false;
    this.updateActivity();
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
  }

  /**
   * Unlock the storage
   */
  unlock(masterPassword: string): boolean {
    try {
      // Test decryption with a known value
      const testData = localStorage.getItem('securepass_test');
      if (testData) {
        const encrypted = JSON.parse(testData) as EncryptedData;
        EncryptionService.decrypt(encrypted, masterPassword);
      }
      
      this.masterPassword = masterPassword;
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
      const encrypted = EncryptionService.encrypt(dataString, this.masterPassword);
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
      const encryptedData = localStorage.getItem(key);
      if (!encryptedData) {
        return defaultValue;
      }

      const encrypted = JSON.parse(encryptedData) as EncryptedData;
      const decryptedString = EncryptionService.decrypt(encrypted, this.masterPassword);
      const decrypted = JSON.parse(decryptedString) as T;
      this.updateActivity();
      return decrypted;
    } catch (error) {
      console.error(`Failed to decrypt data for key ${key}:`, error);
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