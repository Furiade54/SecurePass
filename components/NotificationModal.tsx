import React, { useMemo } from 'react';
import { PasswordEntry } from '../types';
import { BellIcon, XIcon, LockClosedIcon, CopyIcon, CheckIcon, TrashIcon, LightBulbIcon } from './Icons';

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  passwords: PasswordEntry[];
  ignoredNotifications?: Record<string, string[]>;
  lastBackupDate?: number | null;
  onIgnoreNotification?: (id: string, type: string) => void;
  onSelectPassword: (id: string) => void;
}

const REMINDER_PERIOD_DAYS = 90;
const REMINDER_PERIOD_MS = REMINDER_PERIOD_DAYS * 24 * 60 * 60 * 1000;

const NotificationModal: React.FC<NotificationModalProps> = ({ isOpen, onClose, passwords, ignoredNotifications = {}, lastBackupDate, onIgnoreNotification, onSelectPassword }) => {
  if (!isOpen) return null;

  const { oldPasswords, weakPasswords, duplicateGroups, backupAlert } = useMemo(() => {
    const now = Date.now();
    const old = passwords.filter(p => {
        const isIgnored = ignoredNotifications[p.id]?.includes('old');
        return !isIgnored && (now - p.createdAt > REMINDER_PERIOD_MS);
    });
    const weak = passwords.filter(p => {
        const isIgnored = ignoredNotifications[p.id]?.includes('weak');
        return !isIgnored && (p.password.length < 8);
    });
    
    const groups = new Map<string, PasswordEntry[]>();
    passwords.forEach(p => {
        const isIgnored = ignoredNotifications[p.id]?.includes('duplicate');
        if (!isIgnored) {
            const list = groups.get(p.password) || [];
            list.push(p);
            groups.set(p.password, list);
        }
    });
    
    // Filter only groups with > 1 entry
    const duplicates = Array.from(groups.values()).filter(group => group.length > 1);

    // Backup Alert Logic
    let backupNeeded = false;
    let backupMessage = '';
    
    if (lastBackupDate === undefined || lastBackupDate === null) {
        backupNeeded = true;
        backupMessage = 'Nunca has realizado una copia de seguridad. Tus datos solo se guardan en este dispositivo.';
    } else {
        const daysSinceBackup = (now - lastBackupDate) / (1000 * 60 * 60 * 24);
        if (daysSinceBackup > 7) {
            backupNeeded = true;
            backupMessage = `Hace ${Math.floor(daysSinceBackup)} días que no realizas una copia de seguridad.`;
        }
    }

    return { oldPasswords: old, weakPasswords: weak, duplicateGroups: duplicates, backupAlert: { needed: backupNeeded, message: backupMessage } };
  }, [passwords, ignoredNotifications, lastBackupDate]);

  const hasNotifications = oldPasswords.length > 0 || weakPasswords.length > 0 || duplicateGroups.length > 0 || backupAlert.needed;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-700 overflow-hidden transform transition-all scale-100 opacity-100 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800/50 flex-shrink-0">
          <div className="flex items-center space-x-2">
            <BellIcon className={`w-5 h-5 ${hasNotifications ? 'text-red-400' : 'text-gray-400'}`} />
            <h3 className="text-lg font-bold text-white">Centro de Notificaciones</h3>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded-full hover:bg-gray-700"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto custom-scrollbar flex-grow space-y-6">
          {hasNotifications ? (
            <>
              {/* Backup Alert */}
              {backupAlert.needed && (
                <div className="bg-blue-500/10 border-l-4 border-blue-500 text-blue-300 p-4 rounded-r-lg animate-fade-in-up mb-6">
                  <div className="flex items-center mb-2">
                    <LightBulbIcon className="w-5 h-5 mr-2 text-blue-400" />
                    <p className="font-bold">Consejo de Seguridad: Copias de Seguridad</p>
                  </div>
                  <p className="text-sm mb-3 text-blue-200/80">
                    {backupAlert.message}
                  </p>
                  <p className="text-xs text-blue-200/60 mb-2">
                    Recuerda que SecurePass almacena tus contraseñas localmente. Si pierdes tu dispositivo o limpias los datos del navegador sin tener un backup, perderás tu información.
                  </p>
                </div>
              )}

              {/* Duplicate Passwords Alert */}
              {duplicateGroups.length > 0 && (
                <div className="bg-red-500/10 border-l-4 border-red-500 text-red-300 p-4 rounded-r-lg animate-fade-in-up">
                  <div className="flex items-center mb-2">
                    <CopyIcon className="w-5 h-5 mr-2 text-red-400" />
                    <p className="font-bold">Contraseñas Duplicadas</p>
                  </div>
                  <p className="text-sm mb-3 text-red-200/80">
                    El uso de la misma contraseña en múltiples sitios aumenta el riesgo de seguridad.
                  </p>
                  <div className="space-y-3">
                    {duplicateGroups.map((group, idx) => (
                      <div key={idx} className="bg-black/20 rounded-lg p-3">
                        <p className="text-xs text-red-400 mb-2 font-mono bg-black/30 inline-block px-2 py-1 rounded">
                          {group[0].password.replace(/./g, '•')}
                        </p>
                        <ul className="space-y-1">
                          {group.map(p => (
                            <li key={p.id} className="flex items-center justify-between">
                              <span className="text-sm text-white truncate max-w-[150px]">{p.site}</span>
                              <div className="flex items-center space-x-3">
                                <button 
                                  onClick={() => { onSelectPassword(p.id); onClose(); }} 
                                  className="text-xs text-red-400 hover:text-red-200 underline"
                                >
                                  Cambiar
                                </button>
                                {onIgnoreNotification && (
                                  <button
                                    onClick={() => onIgnoreNotification(p.id, 'duplicate')}
                                    className="text-gray-500 hover:text-gray-300"
                                    title="Ignorar esta notificación"
                                  >
                                    <TrashIcon className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Weak Passwords Alert */}
              {weakPasswords.length > 0 && (
                <div className="bg-orange-500/10 border-l-4 border-orange-500 text-orange-300 p-4 rounded-r-lg animate-fade-in-up delay-75">
                  <div className="flex items-center mb-2">
                    <LockClosedIcon className="w-5 h-5 mr-2 text-orange-400" />
                    <p className="font-bold">Contraseñas Débiles</p>
                  </div>
                  <p className="text-sm mb-3 text-orange-200/80">
                    Se detectaron {weakPasswords.length} contraseñas cortas (menos de 8 caracteres).
                  </p>
                  <div className="bg-black/20 rounded-lg p-2 max-h-40 overflow-y-auto custom-scrollbar">
                    <ul className="space-y-1">
                      {weakPasswords.map(p => (
                        <li key={p.id} className="flex items-center justify-between p-2 hover:bg-white/5 rounded transition-colors">
                          <div className="flex flex-col min-w-0">
                            <span className="text-sm text-white truncate">{p.site}</span>
                            <span className="text-xs text-gray-400 truncate">{p.username}</span>
                          </div>
                          <div className="flex items-center space-x-3 ml-2">
                            <button 
                              onClick={() => { onSelectPassword(p.id); onClose(); }} 
                              className="text-xs text-orange-400 hover:text-orange-200 underline whitespace-nowrap"
                            >
                              Mejorar
                            </button>
                            {onIgnoreNotification && (
                              <button
                                onClick={() => onIgnoreNotification(p.id, 'weak')}
                                className="text-gray-500 hover:text-gray-300"
                                title="Ignorar esta notificación"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Old Passwords Alert */}
              {oldPasswords.length > 0 && (
                <div className="bg-yellow-500/10 border-l-4 border-yellow-400 text-yellow-300 p-4 rounded-r-lg animate-fade-in-up delay-100">
                  <div className="flex items-center mb-2">
                    <BellIcon className="w-5 h-5 mr-2 text-yellow-400" />
                    <p className="font-bold">Recordatorio de Actualización</p>
                  </div>
                  <p className="text-sm mb-3 text-yellow-200/80">
                    Tienes {oldPasswords.length} contraseñas que no has actualizado en más de {REMINDER_PERIOD_DAYS} días.
                  </p>
                  <div className="bg-black/20 rounded-lg p-2 max-h-40 overflow-y-auto custom-scrollbar">
                    <ul className="space-y-1">
                      {oldPasswords.map(p => (
                        <li key={p.id} className="flex items-center justify-between p-2 hover:bg-white/5 rounded transition-colors">
                          <span className="text-sm text-white truncate max-w-[180px]">{p.site}</span>
                          <div className="flex items-center space-x-3">
                            <button 
                              onClick={() => { onSelectPassword(p.id); onClose(); }} 
                              className="text-xs text-yellow-400 hover:text-yellow-200 underline"
                            >
                              Revisar
                            </button>
                            {onIgnoreNotification && (
                              <button
                                onClick={() => onIgnoreNotification(p.id, 'old')}
                                className="text-gray-500 hover:text-gray-300"
                                title="Ignorar esta notificación"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400 animate-fade-in">
               <div className="bg-green-500/10 p-4 rounded-full mb-4">
                   <CheckIcon className="w-12 h-12 text-green-500" />
               </div>
               <p className="text-xl font-bold text-white mb-2">¡Todo excelente!</p>
               <p className="text-center text-sm text-gray-400 max-w-xs">
                 No se detectaron problemas de seguridad. Todas tus contraseñas son únicas, fuertes y están actualizadas.
               </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 bg-gray-800/30 flex justify-end flex-shrink-0">
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
