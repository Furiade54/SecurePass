
import React, { useState, useEffect, useMemo } from 'react';
import { PasswordEntry } from './types';
import { CopyIcon, CheckIcon, EyeIcon, EyeOffIcon, PlusIcon, LockClosedIcon, MenuIcon, XIcon, SparklesIcon, ExternalLinkIcon, ImportExportIcon, BellIcon } from './components/Icons';
import GestureUnlockScreen from './components/GestureUnlockScreen';
import PasswordModal from './components/PasswordModal';
import PasswordGeneratorModal from './components/PasswordGeneratorModal';
import NotificationModal from './components/NotificationModal';
import MessageModal from './components/MessageModal';
import { FixedSizeList as List } from 'react-window';
import ImportExportModal from './components/ImportExportModal';
import { SecureStorageService } from './utils/secureStorage';
import { EncryptionService } from './utils/encryption';

// --- Child Components ---

const PasswordItem: React.FC<{ entry: PasswordEntry; onEdit: (entry: PasswordEntry) => void; onDelete: (id: string) => void; }> = ({ entry, onEdit, onDelete }) => {
    const [isRevealed, setIsRevealed] = useState(false);
    const [copied, setCopied] = useState<'username' | 'password' | null>(null);

    const handleCopy = (text: string, type: 'username' | 'password') => {
        navigator.clipboard.writeText(text);
        setCopied(type);
        setTimeout(() => setCopied(null), 2000);
    };

    return (
        <div className="bg-gray-800 p-2 rounded-lg flex items-center justify-between transition-all hover:bg-gray-700/50 hover:shadow-lg mb-2">
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
            </div>
            <div className="flex items-center space-x-0 ml-1">
                <button onClick={() => setIsRevealed(!isRevealed)} className="p-0 text-gray-400 hover:text-white transition-colors" title={isRevealed ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{isRevealed ? <EyeOffIcon className="w-5 h-5"/> : <EyeIcon className="w-5 h-5"/>}</button>
                <button onClick={() => handleCopy(entry.username, 'username')} className="p-1 text-gray-400 hover:text-white transition-colors" title="Copiar usuario">{copied === 'username' ? <CheckIcon className="w-5 h-5 text-green-400"/> : <CopyIcon className="w-5 h-5"/>}</button>
                <button onClick={() => handleCopy(entry.password, 'password')} className="p-1 text-gray-400 hover:text-white transition-colors" title="Copiar contraseña">{copied === 'password' ? <CheckIcon className="w-5 h-5 text-green-400"/> : <CopyIcon className="w-5 h-5"/>}</button>
                <button onClick={() => onEdit(entry)} className="p-1 text-gray-400 hover:text-white transition-colors" title="Editar"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L14.732 3.732z"></path></svg></button>
                <button onClick={() => onDelete(entry.id)} className="p-1 text-red-500 hover:text-red-400 transition-colors" title="Eliminar"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg></button>
            </div>
        </div>
    );
};

const Disclaimer: React.FC = () => (
    <div className="bg-red-900/50 border-l-4 border-red-500 text-red-300 p-4 my-4 rounded-r-lg text-xs">
        <strong>Disclaimer:</strong> Aplicacion construida por Felipe, primera version de prueba
    </div>
);

// --- Main App Component ---
const App: React.FC = () => {
    const [passwords, setPasswords] = useState<PasswordEntry[]>([]);
    const [hasStoredGesture, setHasStoredGesture] = useState(false);
    const [isLocked, setIsLocked] = useState(true);

    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    const [isGeneratorModalOpen, setIsGeneratorModalOpen] = useState(false);
    const [isImportExportModalOpen, setIsImportExportModalOpen] = useState(false);
    const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);
    const [editingEntry, setEditingEntry] = useState<PasswordEntry | null>(null);
    const [generatedPasswordForModal, setGeneratedPasswordForModal] = useState<string>('');
    const [searchTerm, setSearchTerm] = useState('');
    const [messageModal, setMessageModal] = useState({ 
        isOpen: false, 
        title: '', 
        message: '', 
        type: 'info' as 'info' | 'error' | 'success' | 'warning',
        onConfirm: undefined as (() => void) | undefined,
        confirmText: undefined as string | undefined,
        cancelText: undefined as string | undefined
    });
    
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
    }, [passwords, isLocked, hasStoredGesture]);

    // We no longer persist the raw gesture pattern to localStorage
    // Instead we only save the hash when setting the gesture


    const handleSetGesture = (pattern: number[]) => {
        const patternString = pattern.join(',');
        
        // Initialize secure storage with the pattern as master password
        secureStorage.initialize({ masterPassword: patternString });
        
        // Save hash to know we have a setup
        const hash = EncryptionService.hashGesturePattern(pattern);
        localStorage.setItem('securepass_gesture_hash', hash);
        
        setHasStoredGesture(true);
        setIsLocked(false);

        // Reload passwords (since we might be recovering existing data with internal key)
        const loadedPasswords = secureStorage.get<PasswordEntry[]>('securepass_passwords', []);
        setPasswords(loadedPasswords);
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
            // Load passwords from secure storage
            const loadedPasswords = secureStorage.get<PasswordEntry[]>('securepass_passwords', []);
            setPasswords(loadedPasswords);
        } else {
             setMessageModal({ 
                 isOpen: true, 
                 title: 'Error', 
                 message: 'Error al desbloquear el almacenamiento seguro', 
                 type: 'error',
                 onConfirm: undefined,
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
            
            // Clear gesture hash only
            localStorage.removeItem('securepass_gesture_hash');
            // We do NOT remove securepass_passwords anymore
        };

        if (hasLegacyData) {
             setMessageModal({
                 isOpen: true,
                 title: '⚠️ ¡ADVERTENCIA DE SEGURIDAD CRÍTICA! ⚠️',
                 message: "Detectamos que tienes datos guardados con una versión anterior de la aplicación que AÚN NO HAN SIDO MIGRADOS.\n\nSi reseteas tu patrón ahora sin haber desbloqueado la aplicación al menos una vez, PERDERÁS EL ACCESO A TODAS TUS CONTRASEÑAS PERMANENTEMENTE.\n\nRecomendación: Pulsa 'Cancelar', desbloquea con tu patrón actual para asegurar tus datos, y luego intenta resetear.\n\n¿Estás seguro de que quieres continuar y arriesgarte a perder tus datos?",
                 type: 'error',
                 onConfirm: performReset,
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
                 confirmText: 'Resetear',
                 cancelText: 'Cancelar'
             });
        }
    };
    
    const handleLock = () => {
        setIsLocked(true);
        setIsSidebarOpen(false);
    };

    const handleSavePassword = (entryData: Omit<PasswordEntry, 'id' | 'createdAt'> & { id?: string }) => {
        if (entryData.id) { // Editing existing
            setPasswords(passwords.map(p => p.id === entryData.id ? { ...p, ...entryData } : p));
        } else { // Adding new
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
            }
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
        setIsImportExportModalOpen(true);
        setIsSidebarOpen(false);
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

    const categories = useMemo(() => ['all', ...Array.from(new Set(passwords.map(p => p.category).filter(Boolean)))], [passwords]);
    
    const hasNotifications = useMemo(() => {
        const now = Date.now();
        const REMINDER_PERIOD_MS = 90 * 24 * 60 * 60 * 1000;
        return passwords.some(p => now - p.createdAt > REMINDER_PERIOD_MS);
    }, [passwords]);

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
                <aside className={`absolute md:relative inset-y-0 left-0 z-30 w-64 bg-gray-300/20 backdrop-blur-sm border-r border-gray-600/30 p-4 h-screen md:h-screen flex flex-col transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`} style={{overflowY: 'auto'}}>
                    <div className="flex justify-between items-center mb-8 flex-shrink-0">
                        <h1 className="text-2xl font-bold text-white">Secure<span className="text-cyan-400">Pass</span></h1>
                        <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-1">
                            <XIcon className="w-6 h-6"/>
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
                                <SparklesIcon className="w-5 h-5 mr-3"/> Genera contraseñas
                            </button>
                            <button onClick={handleOpenImportExport} className="w-full flex items-center px-3 py-2 rounded-md hover:bg-gray-700 transition-colors">
                                <ImportExportIcon className="w-5 h-5 mr-3"/> Importar/Exportar
                            </button>
                            <button onClick={handleLock} className="w-full flex items-center px-3 py-2 rounded-md hover:bg-gray-700 transition-colors">
                                <LockClosedIcon className="w-5 h-5 mr-3"/> Bloquear bóveda
                            </button>
                            <Disclaimer />
                        </div>
                    </nav>
                </aside>

                {/* Main Content */}
                <main className="flex-1 flex flex-col overflow-hidden">
                    <header className="sticky top-0 z-20 flex-shrink-0 bg-gray-800/50 backdrop-blur-sm border-b border-gray-700/50 p-4 flex items-center justify-between">
                         <button onClick={() => setIsSidebarOpen(true)} className="md:hidden p-1 -ml-1 mr-2">
                            <MenuIcon className="w-6 h-6"/>
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
                        
                        <button 
                            onClick={() => setIsNotificationModalOpen(true)}
                            className={`ml-3 p-2 rounded-full transition-colors relative ${hasNotifications ? 'bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                            title="Notificaciones"
                        >
                            <BellIcon className="w-6 h-6" />
                            {hasNotifications && (
                                <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-yellow-500 rounded-full border-2 border-gray-800"></span>
                            )}
                        </button>

                        <button onClick={handleOpenAddModal} className="ml-3 bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-full flex items-center transition-all">
                            <PlusIcon className="w-5 h-5"/>
                            <span className="hidden sm:inline ml-2">Agregar nueva</span>
                        </button>
                    </header>
                    <div className="flex-1 overflow-y-auto p-6">
                        <div className="space-y-8">
                            {filteredPasswords.length > 0 ? (
                                <List
                                    height={600} // Puedes ajustar este valor según el diseño
                                    itemCount={filteredPasswords.length}
                                    itemSize={100} // Alto fijo de cada PasswordItem (ajustar si es necesario)
                                    width={"100%"}
                                    style={{overflowX: 'hidden'}}
                                >
                                    {({ index, style }: { index: number; style: React.CSSProperties }) => {
                                        const entry = filteredPasswords[index];
                                        return (
                                            <div style={style} key={entry.id}>
                                                <PasswordItem entry={entry} onEdit={handleEdit} onDelete={handleDelete} />
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
            />

            <PasswordGeneratorModal
                isOpen={isGeneratorModalOpen}
                onClose={() => { setIsGeneratorModalOpen(false); if(isPasswordModalOpen || editingEntry) { setIsPasswordModalOpen(true); } }}
                onPasswordGenerated={handlePasswordGenerated}
            />

            <NotificationModal
                isOpen={isNotificationModalOpen}
                onClose={() => setIsNotificationModalOpen(false)}
                passwords={passwords}
                onSelectPassword={handleSelectPasswordForEdit}
            />

            <ImportExportModal
                isOpen={isImportExportModalOpen}
                onClose={() => setIsImportExportModalOpen(false)}
                onImport={(importedPasswords: PasswordEntry[]) => {
                    // Obtener la preferencia de importación guardada
                    const importMode = localStorage.getItem('vault_last_import_mode') as 'merge' | 'overwrite' || 'merge';
                    
                    if (importMode === 'overwrite') {
                        // Reemplazar todas las contraseñas existentes
                        setPasswords(importedPasswords);
                    } else {
                        // Merge: agregar las nuevas, evitando duplicados por ID
                        const existingIds = new Set(passwords.map(p => p.id));
                        const newPasswords = importedPasswords.filter((p: PasswordEntry) => !existingIds.has(p.id));
                        setPasswords([...passwords, ...newPasswords]);
                    }
                }}
                passwords={passwords}
            />
        </>
    );
};

export default App;
