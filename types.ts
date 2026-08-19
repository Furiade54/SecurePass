export interface PasswordEntry {
  id: string;
  site: string;
  username: string;
  password: string;
  category: string;
  createdAt: number;
  totpSecret?: string;
}

export interface MfaEntry {
  id: string;
  issuer: string;
  account: string;
  secret: string; // Base32
  algorithm?: 'SHA-1' | 'SHA-256' | 'SHA-512';
  digits?: number; // 6 or 8
  period?: number; // 30 or 60
  createdAt: number;
  color?: string;
  associatedPasswordId?: string;
}
