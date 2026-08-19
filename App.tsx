
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PasswordEntry, MfaEntry } from './types';
import { CopyIcon, CheckIcon, EyeIcon, EyeOffIcon, PlusIcon, LockClosedIcon, MenuIcon, XIcon, SparklesIcon, ExternalLinkIcon, ImportExportIcon, BellIcon, DotsVerticalIcon, PencilIcon, TrashIcon, ShieldCheckIcon, QrCodeIcon } from './components/Icons';
import GestureUnlockScreen from './components/GestureUnlockScreen';
import PasswordModal from './components/PasswordModal';
import PasswordGeneratorModal from './components/PasswordGeneratorModal';
import NotificationModal from './components/NotificationModal';
import MessageModal from './components/MessageModal';
import { FixedSizeList as List } from 'react-window';
import ImportExportModal from './components/ImportExportModal';
import MfaAuthenticatorModal from './components/MfaAuthenticatorModal';
import { SecureStorageService } from './utils/secureStorage';
import { EncryptionService } from './utils/encryption';
import { generateTotpSync, getTotpRemainingSeconds, formatTotpCode } from './utils/totp';

// --- Child Components ---

const PasswordItem: React.FC<{
    entry: PasswordEntry;
    onEdit: (entry: PasswordEntry) => void;
    onDelete: (id: string) => void;
    onShareQR: (entry: PasswordEntry) => void;
}> = ({ entry, onEdit, onDelete, onShareQR }) => {
    const [isRevealed, setIsRevealed] = useState(false);
    const [copied, setCopied] = useState<'username' | 'password' | 'mfa' | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [mfaCode, setMfaCode] = useState<string>('');
    const [mfaRemaining, setMfaRemaining] = useState<number>(30);
    const menuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!entry.totpSecret) {
            setMfaCode('');
            return;
        }
        const updateTotp = () => {
            try {
                const code = generateTotpSync(entry.totpSecret!);
                setMfaCode(code);
                setMfaRemaining(getTotpRemainingSeconds(30));
            } catch {
                setMfaCode('');
            }
        };
        updateTotp();
        const interval = setInterval(updateTotp, 1000);
        return () => clearInterval(interval);
    }, [entry.totpSecret]);

    useEffect(() => {
        if (!menuOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMenuOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEsc);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEsc);
        };
    }, [menuOpen]);

    const handleCopy = (text: string, type: 'username' | 'password' | 'mfa') => {
        navigator.clipboard.writeText(text);
        setCopied(type);
        setTimeout(() => setCopied(null), 2000);
    };

    const copyUsername = () => {
        handleCopy(entry.username, 'username');
        setMenuOpen(false);
    };

    const copyPassword = () => {
        handleCopy(entry.password, 'password');
        setMenuOpen(false);
    };

    const copyMfa = () => {
        if (mfaCode) {
            handleCopy(mfaCode.replace(/\s+/g, ''), 'mfa');
        }
        setMenuOpen(false);
    };

    const handleShareQR = () => {
        onShareQR(entry);
        setMenuOpen(false);
    };

    const toggleReveal = () => {
        setIsRevealed((v) => !v);
        setMenuOpen(false);
    };

    const openEdit = () => {
        onEdit(entry);
        setMenuOpen(false);
    };

    const openDelete = () => {
        onDelete(entry.id);
        setMenuOpen(false);
    };

    return (
        <div className="bg-gray-800 p-2.5 rounded-lg flex items-center justify-between transition-all hover:bg-gray-700/50 hover:shadow-lg mb-2">
            <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-6">
                    <p className="text-lg font-bold text-cyan-400 truncate whitespace-nowrap">{entry.site}</p>
                    <a
                        href={/^https?:\/\//.test(entry.site) ? entry.site : `https://${entry.site}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 text-cyan-400 hover:text-cyan-300 transition-colors"
                        title="Ir al sitio"
                        tabIndex={0}
                        aria-label="Ir al sitio"
                        onClick={e => e.stopPropagation()}
                    >
                        <ExternalLinkIcon className="w-4 h-4" />
                    </a>
                </div>
                <p className="text-sm text-gray-400 truncate">{entry.username}</p>
                <p className="text-sm font-mono text-gray-300 mt-1">{isRevealed ? entry.password : '••••••••••••'}</p>
                {entry.totpSecret && mfaCode && (
                    <div className="flex items-center gap-2 mt-1.5 pt-1 border-t border-gray-700/40">
                        <span className="text-[10px] uppercase font-bold text-cyan-400 flex items-center gap-1">
                            <ShieldCheckIcon className="w-3.5 h-3.5" /> MFA:
                        </span>
                        <button
                            onClick={() => handleCopy(mfaCode, 'mfa')}
                            className="flex items-center gap-1.5 px-2 py-0.5 bg-black/40 hover:bg-black/60 rounded border border-cyan-500/30 text-xs font-mono font-bold text-cyan-300 transition-colors"
                            title="Copiar código MFA"
                        >
                            <span>{formatTotpCode(mfaCode)}</span>
                            {copied === 'mfa' ? <CheckIcon className="w-3.5 h-3.5 text-green-400" /> : <CopyIcon className="w-3.5 h-3.5 text-gray-400" />}
                        </button>
                        <span className={`text-[10px] font-mono font-semibold px-1 rounded ${mfaRemaining <= 5 ? 'text-red-400 animate-pulse' : 'text-gray-400'}`}>
                            {mfaRemaining}s
                        </span>
                    </div>
                )}
            </div>
            <div className="relative ml-1" ref={menuRef}>
                <button
                    onClick={() => setMenuOpen((v) => !v)}
                    className="p-2 text-gray-400 hover:text-white hover:bg-gray-700/60 rounded-md transition-colors"
                    title="Más opciones"
                    aria-label="Más opciones"
                    aria-expanded={menuOpen}
                >
                    <DotsVerticalIcon className="w-5 h-5" />
                </button>
                {menuOpen && (
                    <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-gray-600/60 bg-gray-900/95 backdrop-blur-sm shadow-2xl z-40 overflow-hidden animate-in fade-in zoom-in-95 duration-150 origin-top-right">
                        <ul className="py-1 text-sm text-gray-200">
                            <li>
                                <button
                                    onClick={toggleReveal}
                                    className="flex w-full items-center gap-3 px-3 py-2 hover:bg-gray-700/60 transition-colors text-left"
                                >
                                    {isRevealed ? <EyeOffIcon className="w-4 h-4 text-gray-400" /> : <EyeIcon className="w-4 h-4 text-gray-400" />}
                                    <span>{isRevealed ? 'Ocultar contraseña' : 'Mostrar contraseña'}</span>
                                </button>
                            </li>
                            <li>
                                <button
                                    onClick={copyUsername}
                                    className="flex w-full items-center gap-3 px-3 py-2 hover:bg-gray-700/60 transition-colors text-left"
                                >
                                    {copied === 'username' ? <CheckIcon className="w-4 h-4 text-green-400" /> : <CopyIcon className="w-4 h-4 text-gray-400" />}
                                    <span>Copiar usuario</span>
                                </button>
                            </li>
                            <li>
                                <button
                                    onClick={copyPassword}
                                    className="flex w-full items-center gap-3 px-3 py-2 hover:bg-gray-700/60 transition-colors text-left"
                                >
                                    {copied === 'password' ? <CheckIcon className="w-4 h-4 text-green-400" /> : <CopyIcon className="w-4 h-4 text-gray-400" />}
                                    <span>Copiar contraseña</span>
                                </button>
                            </li>
                            {entry.totpSecret && mfaCode && (
                                <li>
                                    <button
                                        onClick={copyMfa}
                                        className="flex w-full items-center gap-3 px-3 py-2 hover:bg-gray-700/60 transition-colors text-left text-cyan-300"
                                    >
                                        {copied === 'mfa' ? <CheckIcon className="w-4 h-4 text-green-400" /> : <ShieldCheckIcon className="w-4 h-4 text-cyan-400" />}
                                        <span>Copiar código MFA</span>
                                    </button>
                                </li>
                            )}
                            <li>
                                <button
                                    onClick={handleShareQR}
                                    className="flex w-full items-center gap-3 px-3 py-2 hover:bg-gray-700/60 transition-colors text-left text-cyan-300"
                                >
                                    <QrCodeIcon className="w-4 h-4 text-cyan-400" />
                                    <span>Compartir por QR</span>
                                </button>
                            </li>
                            <li className="border-t border-gray-700/60 my-1" />
                            <li>
                                <button
                                    onClick={openEdit}
                                    className="flex w-full items-center gap-3 px-3 py-2 hover:bg-gray-700/60 transition-colors text-left"
                                >
                                    <PencilIcon className="w-4 h-4 text-gray-400" />
                                    <span>Editar</span>
                                </button>
                            </li>
                            <li>
                                <button
                                    onClick={openDelete}
                                    className="flex w-full items-center gap-3 px-3 py-2 hover:bg-red-500/10 transition-colors text-left text-red-400"
                                >
                                    <TrashIcon className="w-4 h-4" />
                                    <span>Eliminar</span>
                                </button>
                            </li>
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
};

const Disclaimer: React.FC = () => (
    <div className="bg-green-900/50 border-l-4 border-red-500 text-Green-300 p-4 my-4 rounded-r-lg text-xs">
        <strong>Disclaimer:</strong> Mejora QR para compartir contraseñas a otros dispositivos Importar/Exportar
    </div>
);

// --- Main App Component ---
const App: React.FC = () => {
    const [passwords, setPasswords] = useState<PasswordEntry[]>([]);
    const [mfaEntries, setMfaEntries] = useState<MfaEntry[]>([]);
    const [hasStoredGesture, setHasStoredGesture] = useState(false);
    const [isLocked, setIsLocked] = useState(true);

    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    const [isGeneratorModalOpen, setIsGeneratorModalOpen] = useState(false);
    const [isImportExportModalOpen, setIsImportExportModalOpen] = useState(false);
    const [importExportInitialMode, setImportExportInitialMode] = useState<'select' | 'export' | 'import' | 'shareQR' | 'scanQR' | null>(null);
    const [importExportInitialSelectedIds, setImportExportInitialSelectedIds] = useState<string[]>([]);
    const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);
    const [isMfaModalOpen, setIsMfaModalOpen] = useState(false);
    const [editingEntry, setEditingEntry] = useState<PasswordEntry | null>(null);
    const [generatedPasswordForModal, setGeneratedPasswordForModal] = useState<string>('');
    const [searchTerm, setSearchTerm] = useState('');
    const [messageModal, setMessageModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        type: 'info' as 'info' | 'error' | 'success' | 'warning',
        onConfirm: undefined as (() => void) | undefined,
        onCancel: undefined as (() => void) | undefined,
        confirmText: undefined as string | undefined,
        cancelText: undefined as string | undefined
    });
    const [ignoredNotifications, setIgnoredNotifications] = useState<Record<string, string[]>>({});
    const [lastBackupDate, setLastBackupDate] = useState<number | null>(null);

    const secureStorage = SecureStorageService.getInstance();

    // Load initial state
    useEffect(() => {
        const checkStorage = async () => {
            // Check if we have a stored gesture hash or encrypted data
            const storedHash = localStorage.getItem('securepass_gesture_hash');
            if (storedHash) {
                setHasStoredGesture(true);
                setIsLocked(true);
            } else {
                setHasStoredGesture(false);
                setIsLocked(false);
            }
        };
        checkStorage();
    }, []);

    // Load ignored notifications and backup date from storage
    useEffect(() => {
        if (!isLocked && secureStorage.isStorageLocked() === false) {
            const storedIgnored = secureStorage.get<Record<string, string[]>>('securepass_ignored_notifications', {});
            setIgnoredNotifications(storedIgnored);
            const storedBackupDate = secureStorage.get<number | null>('securepass_last_backup_date', null);
            setLastBackupDate(storedBackupDate);
            const loadedMfa = secureStorage.get<MfaEntry[]>('securepass_mfa_entries', []);
            setMfaEntries(loadedMfa);
        }
    }, [isLocked, secureStorage]);

    // Persist data to secure storage when passwords change
    useEffect(() => {
        // Only save if we are unlocked AND we have a valid gesture stored (not in reset state)
        if (!isLocked && secureStorage.isStorageLocked() === false && hasStoredGesture) {
            try {
                secureStorage.set('securepass_passwords', passwords);
            } catch (error) {
                console.error('Error saving passwords to secure storage:', error);
            }
        }
    }, [passwords, isLocked, hasStoredGesture, secureStorage]);

    // Persist MFA entries to secure storage when changed
    useEffect(() => {
        if (!isLocked && secureStorage.isStorageLocked() === false && hasStoredGesture) {
            try {
                secureStorage.set('securepass_mfa_entries', mfaEntries);
            } catch (error) {
                console.error('Error saving MFA entries to secure storage:', error);
            }
        }
    }, [mfaEntries, isLocked, hasStoredGesture, secureStorage]);

    // Persist ignored notifications and backup date when changed
    useEffect(() => {
        if (!isLocked && secureStorage.isStorageLocked() === false && hasStoredGesture) {
            try {
                secureStorage.set('securepass_ignored_notifications', ignoredNotifications);
                secureStorage.set('securepass_last_backup_date', lastBackupDate);
            } catch (error) {
                console.error('Error saving data to secure storage:', error);
            }
        }
    }, [ignoredNotifications, lastBackupDate, isLocked, hasStoredGesture, secureStorage]);

    const handleSetGesture = (pattern: number[]) => {
        const patternString = pattern.join(',');

        // Initialize secure storage with the gesture pattern as the unlock key
        secureStorage.initialize({ masterPassword: patternString });

        // Save hash to know we have a setup
        const hash = EncryptionService.hashGesturePattern(pattern);
        localStorage.setItem('securepass_gesture_hash', hash);

        setHasStoredGesture(true);
        setIsLocked(false);

        // Reload passwords and MFA entries
        const loadedPasswords = secureStorage.get<PasswordEntry[]>('securepass_passwords', []);
        setPasswords(loadedPasswords);
        const loadedMfa = secureStorage.get<MfaEntry[]>('securepass_mfa_entries', []);
        setMfaEntries(loadedMfa);
    };

    const handleUnlock = (pattern: number[]) => {
        const patternString = pattern.join(',');

        // Verify gesture hash first
        const storedHash = localStorage.getItem('securepass_gesture_hash');
        if (storedHash) {
            const currentHash = EncryptionService.hashGesturePattern(pattern);
            if (currentHash !== storedHash) {
                setMessageModal({
                    isOpen: true,
                    title: 'Acceso Denegado',
                    message: 'Patrón incorrecto',
                    type: 'error',
                    onConfirm: undefined,
                    onCancel: undefined,
                    confirmText: undefined,
                    cancelText: undefined
                });
                return;
            }
        }

        // Try to unlock storage
        const success = secureStorage.unlock(patternString);

        if (success) {
            setIsLocked(false);
            // Load passwords and MFA entries from secure storage
            const loadedPasswords = secureStorage.get<PasswordEntry[]>('securepass_passwords', []);
            setPasswords(loadedPasswords);
            const loadedMfa = secureStorage.get<MfaEntry[]>('securepass_mfa_entries', []);
            setMfaEntries(loadedMfa);
        } else {
            setMessageModal({
                isOpen: true,
                title: 'Error',
                message: 'Error al desbloquear el almacenamiento seguro',
                type: 'error',
                onConfirm: undefined,
                onCancel: undefined,
                confirmText: undefined,
                cancelText: undefined
            });
        }
    };

    const handleResetGesture = () => {
        // Check for unmigrated legacy data risk
        // If we have passwords stored but NO internal key, it means data is still encrypted with the old gesture (Legacy Mode)
        const hasLegacyData = localStorage.getItem('securepass_passwords') && !localStorage.getItem('securepass_internal_key');

        const performReset = () => {
            setHasStoredGesture(false);
            setIsLocked(false);
            setPasswords([]);
            setMfaEntries([]);

            // Clear gesture hash only
            localStorage.removeItem('securepass_gesture_hash');
        };

        if (hasLegacyData) {
            setMessageModal({
                isOpen: true,
                title: '⚠️ ¡ADVERTENCIA DE SEGURIDAD CRÍTICA! ⚠️',
                message: "Detectamos que tienes datos guardados con una versión anterior de la aplicación que AÚN NO HAN SIDO MIGRADOS.\n\nSi reseteas tu patrón ahora sin haber desbloqueado la aplicación al menos una vez, PERDERÁS EL ACCESO A TODAS TUS CONTRASEÑAS PERMANENTEMENTE.\n\nRecomendación: Pulsa 'Cancelar', desbloquea con tu patrón actual para asegurar tus datos, y luego intenta resetear.\n\n¿Estás seguro de que quieres continuar y arriesgarte a perder tus datos?",
                type: 'error',
                onConfirm: performReset,
                onCancel: undefined,
                confirmText: 'Sí, arriesgarse',
                cancelText: 'Cancelar'
            });
        } else {
            setMessageModal({
                isOpen: true,
                title: 'Resetear Patrón',
                message: "¿Deseas resetear el patrón de desbloqueo? Tus contraseñas guardadas se conservarán y podrás acceder a ellas con el nuevo patrón.",
                type: 'warning',
                onConfirm: performReset,
                onCancel: undefined,
                confirmText: 'Resetear',
                cancelText: 'Cancelar'
            });
        }
    };

    const handleLock = () => {
        setIsLocked(true);
        setIsSidebarOpen(false);
    };

    const findDuplicateEntry = (entryData: Omit<PasswordEntry, 'id' | 'createdAt'> & { id?: string }): PasswordEntry | null => {
        const siteNorm = entryData.site.trim().toLowerCase();
        const userNorm = entryData.username.trim().toLowerCase();
        return passwords.find((p) => {
            const sameContent = p.site.trim().toLowerCase() === siteNorm && p.username.trim().toLowerCase() === userNorm;
            const isSelf = entryData.id ? p.id === entryData.id : false;
            return sameContent && !isSelf;
        }) || null;
    };

    const applySavePassword = (entryData: Omit<PasswordEntry, 'id' | 'createdAt'> & { id?: string }) => {
        if (entryData.id) {
            setPasswords(passwords.map(p => p.id === entryData.id ? { ...p, ...entryData } : p));
        } else {
            const newEntry: PasswordEntry = {
                ...entryData,
                id: crypto.randomUUID(),
                createdAt: Date.now(),
            };
            setPasswords([newEntry, ...passwords]);
        }
        setEditingEntry(null);
        setGeneratedPasswordForModal('');
    };

    const handleSavePassword = (entryData: Omit<PasswordEntry, 'id' | 'createdAt'> & { id?: string }) => {
        const duplicate = findDuplicateEntry(entryData);

        if (duplicate) {
            const isEdit = Boolean(entryData.id);
            setMessageModal({
                isOpen: true,
                title: isEdit
                    ? 'Conflicto: combinación sitio + usuario ya existe'
                    : 'Entrada duplicada detectada',
                message: isEdit
                    ? `Ya existe otra contraseña para el sitio '${duplicate.site}' con el usuario '${duplicate.username}'.\n\nSi guardas los cambios con estos datos, se fusionarán con la entrada existente.`
                    : `Ya existe una contraseña para el sitio '${duplicate.site}' con el usuario '${duplicate.username}'.\n\nRecomendamos actualizar la entrada existente para mantener la bóveda ordenada. ¿Qué deseas hacer?`,
                type: 'warning',
                confirmText: 'Actualizar existente',
                cancelText: 'Guardar como nueva',
                onConfirm: () => {
                    const mergedData = { ...entryData, id: duplicate.id };
                    applySavePassword(mergedData);
                },
                onCancel: () => {
                    applySavePassword(entryData);
                },
            });
            setIsPasswordModalOpen(false);
            return;
        }

        applySavePassword(entryData);
    };

    const handleEdit = (entry: PasswordEntry) => {
        setEditingEntry(entry);
        setIsPasswordModalOpen(true);
    };

    const handleDelete = (id: string) => {
        setMessageModal({
            isOpen: true,
            title: 'Eliminar Contraseña',
            message: '¿Estás seguro de que deseas eliminar esta contraseña?',
            type: 'warning',
            confirmText: 'Eliminar',
            cancelText: 'Cancelar',
            onConfirm: () => {
                setPasswords(passwords.filter(p => p.id !== id));
            },
            onCancel: undefined,
        });
    };

    const handleSaveMfaEntry = (entryData: Omit<MfaEntry, 'id' | 'createdAt'> & { id?: string }) => {
        if (entryData.id) {
            setMfaEntries(prev => prev.map(m => m.id === entryData.id ? { ...m, ...entryData } : m));
        } else {
            const newEntry: MfaEntry = {
                ...entryData,
                id: crypto.randomUUID(),
                createdAt: Date.now()
            };
            setMfaEntries(prev => [newEntry, ...prev]);
        }
    };

    const handleDeleteMfaEntry = (id: string) => {
        setMessageModal({
            isOpen: true,
            title: 'Eliminar Cuenta MFA',
            message: '¿Estás seguro de que deseas eliminar este código de autenticación en dos pasos?',
            type: 'warning',
            confirmText: 'Eliminar',
            cancelText: 'Cancelar',
            onConfirm: () => {
                setMfaEntries(prev => prev.filter(m => m.id !== id));
            },
            onCancel: undefined
        });
    };

    const handleOpenAddModal = () => {
        setEditingEntry(null);
        setGeneratedPasswordForModal('');
        setIsPasswordModalOpen(true);
    };

    const handleOpenGenerator = () => {
        setIsPasswordModalOpen(false);
        setIsGeneratorModalOpen(true);
    };

    const handleOpenImportExport = () => {
        setImportExportInitialMode(null);
        setImportExportInitialSelectedIds([]);
        setIsImportExportModalOpen(true);
        setIsSidebarOpen(false);
    };

    const handleSharePasswordQR = (entry: PasswordEntry) => {
        setImportExportInitialMode('shareQR');
        setImportExportInitialSelectedIds([entry.id]);
        setIsImportExportModalOpen(true);
    };

    const handlePasswordGenerated = (password: string) => {
        setGeneratedPasswordForModal(password);
        setIsGeneratorModalOpen(false);
        setIsPasswordModalOpen(true);
    };

    const handleSelectPasswordForEdit = (id: string) => {
        const entry = passwords.find(p => p.id === id);
        if (entry) {
            handleEdit(entry);
        }
    };

    const handleIgnoreNotification = (id: string, type: string) => {
        setIgnoredNotifications(prev => {
            const currentIgnored = prev[id] || [];
            if (!currentIgnored.includes(type)) {
                return { ...prev, [id]: [...currentIgnored, type] };
            }
            return prev;
        });
    };

    const handleExportSuccess = () => {
        setLastBackupDate(Date.now());
    };

    const categories = useMemo(() => ['all', ...Array.from(new Set(passwords.map(p => p.category).filter(Boolean)))], [passwords]);

    const hasNotifications = useMemo(() => {
        const now = Date.now();
        const REMINDER_PERIOD_MS = 90 * 24 * 60 * 60 * 1000;

        // Check for old passwords
        const hasOld = passwords.some(p => {
            const isIgnored = ignoredNotifications[p.id]?.includes('old');
            return !isIgnored && (now - p.createdAt > REMINDER_PERIOD_MS);
        });

        // Check for weak passwords (less than 8 chars)
        const hasWeak = passwords.some(p => {
            const isIgnored = ignoredNotifications[p.id]?.includes('weak');
            return !isIgnored && (p.password.length < 8);
        });

        // Check for duplicate passwords
        const passwordCounts = new Map<string, number>();
        passwords.forEach(p => {
            const isIgnored = ignoredNotifications[p.id]?.includes('duplicate');
            if (!isIgnored) {
                passwordCounts.set(p.password, (passwordCounts.get(p.password) || 0) + 1);
            }
        });
        const hasDuplicates = Array.from(passwordCounts.values()).some(count => count > 1);

        // Check for backup status
        let hasBackupAlert = false;
        if (lastBackupDate === undefined || lastBackupDate === null) {
            hasBackupAlert = true;
        } else {
            const daysSinceBackup = (now - lastBackupDate) / (1000 * 60 * 60 * 24);
            if (daysSinceBackup > 7) {
                hasBackupAlert = true;
            }
        }

        return hasOld || hasWeak || hasDuplicates || hasBackupAlert;
    }, [passwords, ignoredNotifications, lastBackupDate]);

    const filteredPasswords = useMemo(() => {
        return passwords.filter(p => {
            const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
            const matchesSearch = searchTerm === '' || p.site.toLowerCase().includes(searchTerm.toLowerCase()) || p.username.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesCategory && matchesSearch;
        });
    }, [passwords, selectedCategory, searchTerm]);

    if (isLocked || !hasStoredGesture) {
        return (
            <>
                <MessageModal
                    isOpen={messageModal.isOpen}
                    onClose={() => setMessageModal(prev => ({ ...prev, isOpen: false }))}
                    title={messageModal.title}
                    message={messageModal.message}
                    type={messageModal.type}
                    onConfirm={messageModal.onConfirm}
                    confirmText={messageModal.confirmText}
                    cancelText={messageModal.cancelText}
                />
                <GestureUnlockScreen onUnlock={handleUnlock} onSetGesture={handleSetGesture} onResetGesture={handleResetGesture} hasGesture={hasStoredGesture} />
            </>
        );
    }

    return (
        <>
            <MessageModal
                isOpen={messageModal.isOpen}
                onClose={() => setMessageModal(prev => ({ ...prev, isOpen: false }))}
                title={messageModal.title}
                message={messageModal.message}
                type={messageModal.type}
                onConfirm={messageModal.onConfirm}
                confirmText={messageModal.confirmText}
                cancelText={messageModal.cancelText}
            />
            <div className="flex h-screen bg-gray-900 text-gray-200">
                {/* Overlay para cerrar sidebar en móvil */}
                {isSidebarOpen && (
                    <div
                        className="fixed inset-0 bg-black bg-opacity-50 z-20 md:hidden"
                        onClick={() => setIsSidebarOpen(false)}
                    />
                )}

                {/* Sidebar */}
                <aside className={`absolute md:relative inset-y-0 left-0 z-30 w-64 bg-gray-300/20 backdrop-blur-sm border-r border-gray-600/30 p-4 h-screen md:h-screen flex flex-col transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`} style={{ overflowY: 'auto' }}>
                    <div className="flex justify-between items-center mb-8 flex-shrink-0">
                        <h1 className="text-2xl font-bold text-white">Secure<span className="text-cyan-400">Pass</span></h1>
                        <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-1">
                            <XIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3 flex-shrink-0">Categorías</h2>
                    <nav className="flex flex-col flex-1 min-h-0">
                        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                            <ul>
                                {categories.map(cat => (
                                    <li key={cat}>
                                        <button onClick={() => { setSelectedCategory(cat); setIsSidebarOpen(false); }} className={`w-full text-left px-3 py-2 rounded-md capitalize transition-colors ${selectedCategory === cat ? 'bg-cyan-500/20 text-cyan-300' : 'hover:bg-gray-700'}`}>{cat}</button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="space-y-2 pt-4 flex-shrink-0">
                            <button onClick={() => { setIsGeneratorModalOpen(true); setIsSidebarOpen(false); }} className="w-full flex items-center px-3 py-2 rounded-md hover:bg-gray-700 transition-colors">
                                <SparklesIcon className="w-5 h-5 mr-3" /> Genera contraseñas
                            </button>
                            <button onClick={handleOpenImportExport} className="w-full flex items-center px-3 py-2 rounded-md hover:bg-gray-700 transition-colors">
                                <ImportExportIcon className="w-5 h-5 mr-3" /> Importar/Exportar
                            </button>
                            <button onClick={() => { setIsMfaModalOpen(true); setIsSidebarOpen(false); }} className="w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-gray-700 transition-colors text-cyan-300 font-semibold bg-cyan-950/30 border border-cyan-500/30">
                                <span className="flex items-center">
                                    <ShieldCheckIcon className="w-5 h-5 mr-3 text-cyan-400" /> Códigos MFA / TOTP
                                </span>
                                {mfaEntries.length > 0 && (
                                    <span className="text-xs bg-cyan-500/30 text-cyan-300 font-bold px-2 py-0.5 rounded-full">
                                        {mfaEntries.length}
                                    </span>
                                )}
                            </button>
                            <button onClick={handleLock} className="w-full flex items-center px-3 py-2 rounded-md hover:bg-gray-700 transition-colors">
                                <LockClosedIcon className="w-5 h-5 mr-3" /> Bloquear bóveda
                            </button>
                            <Disclaimer />
                        </div>
                    </nav>
                </aside>

                {/* Main Content */}
                <main className="flex-1 flex flex-col overflow-hidden">
                    <header className="sticky top-0 z-20 flex-shrink-0 bg-gray-800/50 backdrop-blur-sm border-b border-gray-700/50 p-4 flex items-center justify-between">
                        <button onClick={() => setIsSidebarOpen(true)} className="md:hidden p-1 -ml-1 mr-2">
                            <MenuIcon className="w-6 h-6" />
                        </button>
                        <div className="relative flex-1 max-w-xl">
                            <input type="text" placeholder={`Buscar en ${selectedCategory === 'all' ? 'todas las contraseñas' : selectedCategory}...`}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 bg-gray-700 rounded-full border border-transparent focus:bg-gray-600 focus:ring-2 focus:ring-cyan-500 outline-none transition"
                            />
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                            </div>
                        </div>

                        {/* MFA Authenticator Quick Header Button */}
                        <button
                            onClick={() => setIsMfaModalOpen(true)}
                            className="ml-2 p-2 rounded-full text-cyan-400 hover:text-cyan-300 hover:bg-gray-700 transition-colors relative"
                            title="Generador de Códigos MFA / TOTP (Google/Microsoft Authenticator)"
                        >
                            <ShieldCheckIcon className="w-6 h-6" />
                            {mfaEntries.length > 0 && (
                                <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-cyan-400 rounded-full"></span>
                            )}
                        </button>

                        <button
                            onClick={() => setIsNotificationModalOpen(true)}
                            className={`ml-2 p-2 rounded-full transition-colors relative ${hasNotifications ? 'bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                            title="Notificaciones"
                        >
                            <BellIcon className="w-6 h-6" />
                            {hasNotifications && (
                                <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-yellow-500 rounded-full border-2 border-gray-800"></span>
                            )}
                        </button>

                        <button onClick={handleOpenAddModal} className="ml-3 bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-full flex items-center transition-all">
                            <PlusIcon className="w-5 h-5" />
                            <span className="hidden sm:inline ml-2">Agregar nueva</span>
                        </button>
                    </header>
                    <div className="flex-1 overflow-y-auto p-6">
                        <div className="space-y-8">
                            {filteredPasswords.length > 0 ? (
                                <List
                                    height={600}
                                    itemCount={filteredPasswords.length}
                                    itemSize={115}
                                    width={"100%"}
                                    style={{ overflowX: 'hidden' }}
                                >
                                    {({ index, style }: { index: number; style: React.CSSProperties }) => {
                                        const entry = filteredPasswords[index];
                                        return (
                                            <div style={style} key={entry.id}>
                                                <PasswordItem
                                                    entry={entry}
                                                    onEdit={handleEdit}
                                                    onDelete={handleDelete}
                                                    onShareQR={handleSharePasswordQR}
                                                />
                                            </div>
                                        );
                                    }}
                                </List>
                            ) : (
                                <div className="text-center py-16 text-gray-500">
                                    <h3 className="text-xl font-semibold">No se encontraron contraseñas</h3>
                                    <p className="mt-2">
                                        {searchTerm ? 'Intenta ajustar tu búsqueda o filtro.' : `Haz clic en "Agregar nueva" para guardar tu primera contraseña.`}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </main>
            </div>

            <PasswordModal
                isOpen={isPasswordModalOpen}
                onClose={() => { setIsPasswordModalOpen(false); setEditingEntry(null); }}
                onSave={handleSavePassword}
                onOpenGenerator={handleOpenGenerator}
                generatedPassword={generatedPasswordForModal}
                existingEntry={editingEntry}
                categories={categories.filter(c => c !== 'all')}
            />

            <PasswordGeneratorModal
                isOpen={isGeneratorModalOpen}
                onClose={() => { setIsGeneratorModalOpen(false); if (isPasswordModalOpen || editingEntry) { setIsPasswordModalOpen(true); } }}
                onPasswordGenerated={handlePasswordGenerated}
            />

            <NotificationModal
                isOpen={isNotificationModalOpen}
                onClose={() => setIsNotificationModalOpen(false)}
                passwords={passwords}
                ignoredNotifications={ignoredNotifications}
                lastBackupDate={lastBackupDate}
                onIgnoreNotification={handleIgnoreNotification}
                onSelectPassword={handleSelectPasswordForEdit}
            />

            <ImportExportModal
                isOpen={isImportExportModalOpen}
                onClose={() => {
                    setIsImportExportModalOpen(false);
                    setImportExportInitialMode(null);
                    setImportExportInitialSelectedIds([]);
                }}
                initialMode={importExportInitialMode}
                initialSelectedPasswordIds={importExportInitialSelectedIds}
                onImport={(importedPasswords: PasswordEntry[]) => {
                    const importMode = localStorage.getItem('vault_last_import_mode') as 'merge' | 'overwrite' || 'merge';

                    if (importMode === 'overwrite') {
                        setPasswords(importedPasswords);
                    } else {
                        const existingIds = new Set(passwords.map(p => p.id));
                        const existingKeys = new Set(
                            passwords.map(p => `${p.site.trim().toLowerCase()}|${p.username.trim().toLowerCase()}`)
                        );

                        const updatedList = [...passwords];
                        let mergedCount = 0;
                        let skippedId = 0;

                        for (const imported of importedPasswords) {
                            if (existingIds.has(imported.id)) {
                                skippedId += 1;
                                continue;
                            }
                            const key = `${imported.site.trim().toLowerCase()}|${imported.username.trim().toLowerCase()}`;
                            if (existingKeys.has(key)) {
                                const idx = updatedList.findIndex(
                                    p => `${p.site.trim().toLowerCase()}|${p.username.trim().toLowerCase()}` === key
                                );
                                if (idx !== -1) {
                                    updatedList[idx] = { ...updatedList[idx], ...imported, id: updatedList[idx].id, createdAt: updatedList[idx].createdAt };
                                    mergedCount += 1;
                                }
                                continue;
                            }
                            existingKeys.add(key);
                            updatedList.push(imported);
                        }

                        setPasswords(updatedList);

                        if (mergedCount > 0) {
                            setMessageModal({
                                isOpen: true,
                                title: 'Importación completada',
                                message:
                                    `Se importaron ${importedPasswords.length - skippedId - mergedCount} contraseñas nuevas.\n` +
                                    `${mergedCount} fueron fusionadas con entradas existentes (mismo sitio + usuario).`,
                                type: 'info',
                                onConfirm: undefined,
                                onCancel: undefined,
                                confirmText: 'Entendido',
                                cancelText: undefined,
                            });
                        }
                    }
                }}
                onExportSuccess={handleExportSuccess}
                passwords={passwords}
            />

            <MfaAuthenticatorModal
                isOpen={isMfaModalOpen}
                onClose={() => setIsMfaModalOpen(false)}
                mfaEntries={mfaEntries}
                onSaveMfaEntry={handleSaveMfaEntry}
                onDeleteMfaEntry={handleDeleteMfaEntry}
                passwords={passwords}
            />
        </>
    );
};

export default App;
