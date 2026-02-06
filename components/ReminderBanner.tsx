
import React from 'react';
import { PasswordEntry } from '../types';
import { BellIcon } from './Icons';

interface ReminderBannerProps {
  passwords: PasswordEntry[];
  onSelectPassword: (id: string) => void;
}

const REMINDER_PERIOD_DAYS = 90;
const REMINDER_PERIOD_MS = REMINDER_PERIOD_DAYS * 24 * 60 * 60 * 1000;

const ReminderBanner: React.FC<ReminderBannerProps> = ({ passwords, onSelectPassword }) => {
  const now = Date.now();
  const oldPasswords = passwords.filter(p => now - p.createdAt > REMINDER_PERIOD_MS);

  if (oldPasswords.length === 0) {
    return null;
  }

  return (
    <div className="bg-yellow-500/10 border-l-4 border-yellow-400 text-yellow-300 p-4 mb-6 rounded-r-lg">
      <div className="flex">
        <div className="py-1">
          <BellIcon className="h-6 w-6 text-yellow-400 mr-4"/>
        </div>
        <div>
          <p className="font-bold">Recordatorio de actualización de contraseña</p>
          <p className="text-sm">
            Tienes {oldPasswords.length} contraseña{oldPasswords.length > 1 ? 's' : ''} con más de {REMINDER_PERIOD_DAYS} días. Considera actualizarlas:
          </p>
           <ul className="list-disc list-inside mt-2 text-sm">
              {oldPasswords.slice(0, 3).map(p => (
                 <li key={p.id}>
                    <button onClick={() => onSelectPassword(p.id)} className="underline hover:text-yellow-100">{p.site}</button>
                 </li>
              ))}
              {oldPasswords.length > 3 && <li>...y {oldPasswords.length - 3} más.</li>}
           </ul>
        </div>
      </div>
    </div>
  );
};

export default ReminderBanner;
