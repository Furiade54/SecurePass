import React, { useState, useEffect, useMemo } from 'react';
import { PasswordEntry } from '../types';
import { SparklesIcon, EyeIcon, EyeOffIcon, KeyIcon, ShieldCheckIcon } from './Icons';
import { generateTotpSync, parseOtpAuthUri, generateRandomSecret, formatTotpCode, getTotpRemainingSeconds } from '../utils/totp';

interface PasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (entry: Omit<PasswordEntry, 'id' | 'createdAt'> & { id?: string }) => void;
  onOpenGenerator: () => void;
  generatedPassword?: string;
  existingEntry?: PasswordEntry | null;
  categories: string[];
}

const PasswordModal: React.FC<PasswordModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onOpenGenerator,
  generatedPassword,
  existingEntry,
  categories
}) => {
  const [site, setSite] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [category, setCategory] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showTotpField, setShowTotpField] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      if (existingEntry) {
        setSite(existingEntry.site);
        setUsername(existingEntry.username);
        setPassword(existingEntry.password);
        setCategory(existingEntry.category);
        setTotpSecret(existingEntry.totpSecret || '');
        setShowTotpField(Boolean(existingEntry.totpSecret));
      } else {
        setSite('');
        setUsername('');
        setPassword('');
        setCategory('');
        setTotpSecret('');
        setShowTotpField(false);
      }
    }
  }, [isOpen, existingEntry]);

  useEffect(() => {
    if (generatedPassword) {
      setPassword(generatedPassword);
    }
  }, [generatedPassword]);

  const handleTotpInputChange = (value: string) => {
    const parsed = parseOtpAuthUri(value);
    if (parsed) {
      setTotpSecret(parsed.secret);
      if (!site && parsed.issuer) setSite(parsed.issuer);
      if (!username && parsed.account) setUsername(parsed.account);
    } else {
      setTotpSecret(value.replace(/[\s\-_=]/g, '').toUpperCase());
    }
  };

  const handleGenerateTotpSecret = () => {
    const secret = generateRandomSecret(20);
    setTotpSecret(secret);
    setShowTotpField(true);
  };

  const liveTotpPreview = useMemo(() => {
    if (!totpSecret) return null;
    const clean = totpSecret.replace(/[\s\-_=]/g, '').toUpperCase();
    try {
      const code = generateTotpSync(clean, { time: currentTime });
      return code;
    } catch {
      return null;
    }
  }, [totpSecret, currentTime]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (site && username && password) {
      onSave({
        id: existingEntry?.id,
        site,
        username,
        password,
        category: category || 'Uncategorized',
        totpSecret: totpSecret.trim() ? totpSecret.replace(/[\s\-_=]/g, '').toUpperCase() : undefined
      });
      onClose();
    }
  };

  const filteredCategories = categories.filter((c) =>
    c.toLowerCase().includes(category.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-40 p-4"
      onClick={() => setShowSuggestions(false)}
    >
      <div
        className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md text-gray-200 animate-fade-in-up"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-2xl font-bold mb-6">
          {existingEntry ? 'Editar contraseña' : 'Agregar nueva contraseña'}
        </h2>
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
              type={showPassword ? 'text' : 'password'}
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
            <button
              type="button"
              onClick={onOpenGenerator}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-cyan-400 hover:text-cyan-300"
              title="Generar contraseña aleatoria"
            >
              <SparklesIcon className="w-5 h-5" />
            </button>
          </div>

          <div className="relative">
            <input
              type="text"
              placeholder="Categoría (ej: Trabajo, Social)"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition"
            />
            {showSuggestions && filteredCategories.length > 0 && (
              <ul className="absolute z-10 w-full mt-1 bg-gray-700 border border-gray-600 rounded-md shadow-lg max-h-40 overflow-y-auto">
                {filteredCategories.map((cat, index) => (
                  <li
                    key={index}
                    onClick={() => {
                      setCategory(cat);
                      setShowSuggestions(false);
                    }}
                    className="px-3 py-2 cursor-pointer hover:bg-gray-600 text-gray-200 transition-colors"
                  >
                    {cat}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* MFA / TOTP Secret Section */}
          <div className="pt-1">
            {!showTotpField ? (
              <button
                type="button"
                onClick={() => setShowTotpField(true)}
                className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5 transition-colors"
              >
                <ShieldCheckIcon className="w-4 h-4" />
                <span>+ Agregar código MFA / Doble Factor (TOTP)</span>
              </button>
            ) : (
              <div className="p-3.5 bg-gray-750 bg-gray-900/60 rounded-lg border border-cyan-500/30 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
                    <KeyIcon className="w-3.5 h-3.5 text-cyan-400" />
                    Clave Secreta MFA (Base32 o URI otpauth://)
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateTotpSecret}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                  >
                    <SparklesIcon className="w-3 h-3" />
                    Generar
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Ej: JBSWY3DPEHPK3PXP o pega otpauth://..."
                  value={totpSecret}
                  onChange={(e) => handleTotpInputChange(e.target.value)}
                  className="w-full p-2.5 bg-gray-800 rounded-md border border-gray-600 font-mono text-xs text-white placeholder-gray-500 uppercase focus:border-cyan-500 outline-none"
                />

                {liveTotpPreview && (
                  <div className="flex items-center justify-between bg-black/40 px-3 py-2 rounded-md border border-cyan-500/30">
                    <div>
                      <span className="text-[10px] text-cyan-400 block font-semibold">
                        Código MFA actual:
                      </span>
                      <span className="font-mono text-lg font-bold text-white tracking-widest">
                        {formatTotpCode(liveTotpPreview)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-gray-400 block">Renovación:</span>
                      <span className="text-xs font-bold text-cyan-400">
                        {getTotpRemainingSeconds(30)}s
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 transition-colors font-semibold"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold"
            >
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PasswordModal;
