import React from 'react';
import { PasswordEntry } from '../types';
import { BellIcon, XIcon } from './Icons';

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  passwords: PasswordEntry[];
  onSelectPassword: (id: string) => void;
}

const REMINDER_PERIOD_DAYS = 90;
const REMINDER_PERIOD_MS = REMINDER_PERIOD_DAYS * 24 * 60 * 60 * 1000;

const NotificationModal: React.FC<NotificationModalProps> = ({ isOpen, onClose, passwords, onSelectPassword }) => {
  if (!isOpen) return null;

  const now = Date.now();
  const oldPasswords = passwords.filter(p => now - p.createdAt > REMINDER_PERIOD_MS);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md border border-gray-700 overflow-hidden transform transition-all scale-100 opacity-100">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800/50">
          <div className="flex items-center space-x-2">
            <BellIcon className={`w-5 h-5 ${oldPasswords.length > 0 ? 'text-yellow-400' : 'text-gray-400'}`} />
            <h3 className="text-lg font-bold text-white">Notificaciones</h3>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded-full hover:bg-gray-700"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {oldPasswords.length > 0 ? (
            <div className="bg-yellow-500/10 border-l-4 border-yellow-400 text-yellow-300 p-4 rounded-r-lg">
              <p className="font-bold mb-1">Recordatorio de actualización</p>
              <p className="text-sm mb-3">
                Tienes <span className="font-bold text-yellow-200">{oldPasswords.length}</span> contraseña{oldPasswords.length > 1 ? 's' : ''} con más de {REMINDER_PERIOD_DAYS} días de antigüedad.
              </p>
              
              <div className="bg-black/20 rounded-lg p-2 max-h-48 overflow-y-auto custom-scrollbar">
                <ul className="space-y-1">
                  {oldPasswords.map(p => (
                    <li key={p.id} className="flex items-center justify-between group">
                        <span className="text-sm text-yellow-100/80 truncate max-w-[180px]">{p.site}</span>
                        <button 
                            onClick={() => {
                                onSelectPassword(p.id);
                                onClose();
                            }} 
                            className="text-xs text-yellow-400 hover:text-yellow-200 underline px-2 py-1 rounded hover:bg-yellow-500/10 transition-colors"
                        >
                            Revisar
                        </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-gray-400">
               <div className="bg-gray-700/50 p-4 rounded-full mb-3">
                   <BellIcon className="w-8 h-8 text-gray-500" />
               </div>
               <p className="text-center font-medium">No tienes notificaciones pendientes</p>
               <p className="text-center text-sm text-gray-500 mt-1">Todo está al día</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 bg-gray-800/30 flex justify-end">
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Cerrar
          </button>
        </div>

      </div>
    </div>
  );
};

export default NotificationModal;
