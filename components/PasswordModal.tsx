
import React, { useState, useEffect } from 'react';
import { PasswordEntry } from '../types';
import { SparklesIcon, EyeIcon, EyeOffIcon } from './Icons';

interface PasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (entry: Omit<PasswordEntry, 'id' | 'createdAt'> & { id?: string }) => void;
  onOpenGenerator: () => void;
  generatedPassword?: string;
  existingEntry?: PasswordEntry | null;
}

const PasswordModal: React.FC<PasswordModalProps> = ({ isOpen, onClose, onSave, onOpenGenerator, generatedPassword, existingEntry }) => {
  const [site, setSite] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [category, setCategory] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (isOpen) {
        if (existingEntry) {
            setSite(existingEntry.site);
            setUsername(existingEntry.username);
            setPassword(existingEntry.password);
            setCategory(existingEntry.category);
        } else {
            setSite('');
            setUsername('');
            setPassword('');
            setCategory('');
        }
    }
  }, [isOpen, existingEntry]);
  
  useEffect(() => {
    if (generatedPassword) {
      setPassword(generatedPassword);
    }
  }, [generatedPassword]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (site && username && password) {
      onSave({ id: existingEntry?.id, site, username, password, category: category || 'Uncategorized' });
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-40 p-4">
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md text-gray-200 animate-fade-in-up">
        <h2 className="text-2xl font-bold mb-6">{existingEntry ? 'Editar contraseña' : 'Agregar nueva contraseña'}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="Sitio o nombre de la app (ej: Google)"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition"
            required
          />
          <input
            type="text"
            placeholder="Usuario o correo electrónico"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition"
            required
          />
          <div className="relative">
             <input
                type={showPassword ? "text" : "password"}
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition"
                required
             />
             <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-10 flex items-center pr-2 text-cyan-400 hover:text-cyan-300"
                tabIndex={-1}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
             >
                {showPassword ? <EyeOffIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
             </button>
             <button type="button" onClick={onOpenGenerator} className="absolute inset-y-0 right-0 flex items-center pr-3 text-cyan-400 hover:text-cyan-300">
                <SparklesIcon className="w-5 h-5" />
             </button>
          </div>
          <input
            type="text"
            placeholder="Categoría (ej: Trabajo, Social)"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition"
          />
          <div className="flex justify-end space-x-3 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 transition-colors font-semibold">Cancelar</button>
            <button type="submit" className="px-4 py-2 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold">Guardar</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PasswordModal;
