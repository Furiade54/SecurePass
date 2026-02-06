import React, { useState, useRef } from 'react';
import { PasswordEntry } from '../types';
import { EncryptionService } from '../utils/encryption';
import { ImportExportIcon } from './Icons';

interface ImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (passwords: PasswordEntry[]) => void;
  passwords: PasswordEntry[];
}

const ImportExportModal: React.FC<ImportExportModalProps> = ({ 
  isOpen, 
  onClose, 
  onImport, 
  passwords 
}) => {
  const [mode, setMode] = useState<'select' | 'export' | 'import'>('select');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'overwrite'>('merge');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cargar preferencia de importación guardada
  const [lastImportMode, setLastImportMode] = useState<'merge' | 'overwrite'>(
    () => {
      const saved = localStorage.getItem('vault_last_import_mode');
      return (saved as 'merge' | 'overwrite') || 'merge';
    }
  );

  const resetForm = () => {
    setPassword('');
    setConfirmPassword('');
    setError('');
    setSuccess('');
    setMode('select');
    setImportMode(lastImportMode);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleExport = async () => {
    if (!password) {
      setError('Por favor ingresa una contraseña para proteger el archivo');
      return;
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }

    try {
      // Crear objeto de datos para exportar
      const exportData = {
        version: '1.0',
        timestamp: Date.now(),
        passwords: passwords,
        metadata: {
          totalPasswords: passwords.length,
          categories: Array.from(new Set(passwords.map(p => p.category))),
          exportDate: new Date().toISOString()
        }
      };

      // Encriptar datos
      const jsonData = JSON.stringify(exportData);
      const encrypted = EncryptionService.encrypt(jsonData, password);

      // Crear archivo para descargar
      const fileName = `vault-backup-${new Date().toISOString().split('T')[0]}.vault`;
      const blob = new Blob([JSON.stringify(encrypted)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSuccess('Archivo exportado exitosamente');
      setTimeout(() => handleClose(), 2000);
    } catch (error) {
      setError('Error al exportar: ' + (error as Error).message);
    }
  };

  const handleImport = async () => {
    if (!password) {
      setError('Por favor ingresa la contraseña del archivo');
      return;
    }

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('Por favor selecciona un archivo');
      return;
    }

    try {
      const text = await file.text();
      const encrypted = JSON.parse(text);
      
      // Desencriptar datos
      const decryptedJson = EncryptionService.decrypt(encrypted, password);
      const importData = JSON.parse(decryptedJson);

      // Validar formato
      if (!importData.passwords || !Array.isArray(importData.passwords)) {
        throw new Error('Formato de archivo inválido');
      }

      // Guardar preferencia de importación
      localStorage.setItem('vault_last_import_mode', importMode);
      setLastImportMode(importMode);

      // Procesar contraseñas importadas
      const importedPasswords: PasswordEntry[] = importData.passwords.map((p: any) => ({
        id: p.id || crypto.randomUUID(),
        site: p.site,
        username: p.username,
        password: p.password,
        category: p.category || 'Uncategorized',
        createdAt: p.createdAt || Date.now()
      }));

      onImport(importedPasswords);
      setSuccess('Archivo importado exitosamente');
      setTimeout(() => handleClose(), 2000);
    } catch (error) {
      setError('Error al importar: ' + (error as Error).message);
    }
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-6">
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md text-gray-200 animate-fade-in-up">
        <h2 className="text-2xl font-bold mb-6 flex items-center">
          <ImportExportIcon className="w-6 h-6 mr-2 text-cyan-400" />
          {mode === 'select' && 'Importar/Exportar'}
          {mode === 'export' && 'Exportar Bóveda'}
          {mode === 'import' && 'Importar Bóveda'}
        </h2>

        {mode === 'select' && (
          <div className="space-y-4">
            <p className="text-gray-400 mb-4">
              ¿Qué deseas hacer con tu bóveda de contraseñas?
            </p>
            <button
              onClick={() => setMode('export')}
              className="w-full px-4 py-3 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold"
            >
              Exportar (Crear backup)
            </button>
            <button
              onClick={() => setMode('import')}
              className="w-full px-4 py-3 rounded-md bg-gray-600 hover:bg-gray-500 transition-colors font-semibold"
            >
              Importar (Restaurar backup)
            </button>
            <button
              onClick={handleClose}
              className="w-full px-4 py-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors"
            >
              Cancelar
            </button>
          </div>
        )}

        {mode === 'export' && (
          <div className="space-y-4">
            <p className="text-gray-400 mb-4">
              Se creará un archivo encriptado con todas tus contraseñas.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Contraseña para proteger el archivo
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition"
                placeholder="Elige una contraseña segura"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Confirmar contraseña
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition"
                placeholder="Repite la contraseña"
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            {success && <p className="text-green-400 text-sm">{success}</p>}
            <div className="flex space-x-3">
              <button
                onClick={() => setMode('select')}
                className="flex-1 px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 transition-colors"
              >
                Atrás
              </button>
              <button
                onClick={handleExport}
                className="flex-1 px-4 py-2 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold"
              >
                Exportar
              </button>
            </div>
          </div>
        )}

        {mode === 'import' && (
          <div className="space-y-4">
            <p className="text-gray-400 mb-4">
              Selecciona un archivo de backup para importar.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Archivo de backup (.vault)
              </label>
              <button
                onClick={handleFileSelect}
                className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 hover:bg-gray-600 transition-colors text-left"
              >
                {fileInputRef.current?.files?.[0]?.name || 'Seleccionar archivo...'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".vault"
                onChange={() => {}}
                className="hidden"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Contraseña del archivo
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition"
                placeholder="Ingresa la contraseña del backup"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">
                Modo de importación
              </label>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="merge"
                    checked={importMode === 'merge'}
                    onChange={(e) => setImportMode(e.target.value as 'merge' | 'overwrite')}
                    className="mr-2"
                  />
                  <span>Agregar a las existentes (Merge)</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    value="overwrite"
                    checked={importMode === 'overwrite'}
                    onChange={(e) => setImportMode(e.target.value as 'merge' | 'overwrite')}
                    className="mr-2"
                  />
                  <span>Reemplazar todas (Overwrite)</span>
                </label>
              </div>
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            {success && <p className="text-green-400 text-sm">{success}</p>}
            <div className="flex space-x-3">
              <button
                onClick={() => setMode('select')}
                className="flex-1 px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 transition-colors"
              >
                Atrás
              </button>
              <button
                onClick={handleImport}
                className="flex-1 px-4 py-2 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold"
              >
                Importar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportExportModal; 