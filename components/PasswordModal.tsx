import React, { useState, useEffect, useMemo } from 'react';
import { PasswordEntry, MfaEntry } from '../types';
import { SparklesIcon, EyeIcon, EyeOffIcon, KeyIcon, ShieldCheckIcon, LinkIcon, XIcon, SearchIcon, ChevronDownIcon, CheckIcon, TagIcon } from './Icons';
import { generateTotpSync, parseOtpAuthUri, generateRandomSecret, formatTotpCode, getTotpRemainingSeconds } from '../utils/totp';

interface PasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (entry: Omit<PasswordEntry, 'id' | 'createdAt'> & { id?: string }) => void;
  onOpenGenerator: () => void;
  generatedPassword?: string;
  existingEntry?: PasswordEntry | null;
  categories: string[];
  mfaEntries?: MfaEntry[];
}

const PasswordModal: React.FC<PasswordModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onOpenGenerator,
  generatedPassword,
  existingEntry,
  categories,
  mfaEntries = []
}) => {
  const [site, setSite] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [category, setCategory] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showTotpField, setShowTotpField] = useState(false);
  const [mfaMode, setMfaMode] = useState<'existing' | 'manual'>('existing');
  const [selectedMfaId, setSelectedMfaId] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [isMfaPickerModalOpen, setIsMfaPickerModalOpen] = useState(false);
  const [mfaSearchTerm, setMfaSearchTerm] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setShowSuggestions(false);
      if (existingEntry) {
        setSite(existingEntry.site);
        setUsername(existingEntry.username);
        setPassword(existingEntry.password);
        setCategory(existingEntry.category);
        const secret = existingEntry.totpSecret || '';
        setTotpSecret(secret);
        setShowTotpField(Boolean(secret));

        if (secret && mfaEntries.length > 0) {
          const clean = secret.replace(/[\s\-_=]/g, '').toUpperCase();
          const matched = mfaEntries.find(
            (m) => m.secret.replace(/[\s\-_=]/g, '').toUpperCase() === clean
          );
          if (matched) {
            setSelectedMfaId(matched.id);
            setMfaMode('existing');
          } else {
            setSelectedMfaId('');
            setMfaMode('manual');
          }
        } else {
          setSelectedMfaId('');
          setMfaMode(mfaEntries.length > 0 ? 'existing' : 'manual');
        }
      } else {
        setSite('');
        setUsername('');
        setPassword('');
        setCategory('');
        setTotpSecret('');
        setSelectedMfaId('');
        setShowTotpField(false);
        setMfaMode(mfaEntries.length > 0 ? 'existing' : 'manual');
      }
    } else {
      setShowSuggestions(false);
    }
  }, [isOpen, existingEntry, mfaEntries]);

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
    setSelectedMfaId('');
  };

  const handleSelectExistingMfa = (mfaId: string) => {
    setSelectedMfaId(mfaId);
    if (!mfaId) {
      setTotpSecret('');
      setIsMfaPickerModalOpen(false);
      return;
    }
    const found = mfaEntries.find((m) => m.id === mfaId);
    if (found) {
      setTotpSecret(found.secret.replace(/[\s\-_=]/g, '').toUpperCase());
      if (!site && found.issuer) setSite(found.issuer);
      if (!username && found.account) setUsername(found.account);
    }
    setIsMfaPickerModalOpen(false);
  };

  const handleGenerateTotpSecret = () => {
    const secret = generateRandomSecret(20);
    setTotpSecret(secret);
    setSelectedMfaId('');
    setShowTotpField(true);
    setMfaMode('manual');
  };

  const handleRemoveTotp = () => {
    setTotpSecret('');
    setSelectedMfaId('');
    setShowTotpField(false);
  };

  const matchedExistingMfa = useMemo(() => {
    if (!totpSecret) return null;
    const clean = totpSecret.replace(/[\s\-_=]/g, '').toUpperCase();
    return mfaEntries.find(
      (m) => m.secret.replace(/[\s\-_=]/g, '').toUpperCase() === clean
    ) || null;
  }, [totpSecret, mfaEntries]);

  const filteredMfaEntries = useMemo(() => {
    if (!mfaSearchTerm.trim()) return mfaEntries;
    const term = mfaSearchTerm.toLowerCase();
    return mfaEntries.filter(
      (m) =>
        m.issuer.toLowerCase().includes(term) ||
        (m.account && m.account.toLowerCase().includes(term))
    );
  }, [mfaEntries, mfaSearchTerm]);

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
        className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md text-gray-200 animate-fade-in-up max-h-[90vh] overflow-y-auto"
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
            <div className="relative">
              <input
                type="text"
                placeholder="Categoría (ej: Trabajo, Social)"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => {
                  if (categories.length > 0) {
                    setShowSuggestions(true);
                  }
                }}
                className="w-full p-3 pr-10 bg-gray-700 rounded-md border border-gray-600 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition"
              />
              {categories.length > 0 && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowSuggestions((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-cyan-400 transition-colors"
                  title="Ver categorías existentes"
                >
                  <TagIcon className="w-4 h-4" />
                </button>
              )}
            </div>

            {showSuggestions && filteredCategories.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-20 bg-gray-900 border border-gray-700/90 rounded-xl shadow-2xl overflow-hidden p-1.5 backdrop-blur-md animate-fade-in">
                <div className="px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider text-cyan-400 border-b border-gray-800/80 flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5">
                    <TagIcon className="w-3 h-3 text-cyan-400" />
                    Categorías guardadas
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowSuggestions(false)}
                    className="text-gray-400 hover:text-white text-[11px]"
                  >
                    ✕
                  </button>
                </div>
                <ul className="max-h-40 overflow-y-auto space-y-0.5">
                  {filteredCategories.map((cat, index) => {
                    const isCurrent = category.trim().toLowerCase() === cat.trim().toLowerCase();
                    return (
                      <li
                        key={index}
                        onClick={() => {
                          setCategory(cat);
                          setShowSuggestions(false);
                        }}
                        className={`flex items-center justify-between px-2.5 py-2 rounded-lg text-xs cursor-pointer transition-colors ${isCurrent
                            ? 'bg-cyan-950/60 text-cyan-300 font-semibold border border-cyan-500/30'
                            : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                          }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <TagIcon className={`w-3.5 h-3.5 flex-shrink-0 ${isCurrent ? 'text-cyan-400' : 'text-gray-400'}`} />
                          <span className="truncate">{cat}</span>
                        </div>
                        {isCurrent && (
                          <span className="text-[10px] text-cyan-400 bg-cyan-950 px-1.5 py-0.5 rounded border border-cyan-500/30">
                            Actual
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          {/* MFA / TOTP Section */}
          <div className="pt-1">
            {!showTotpField ? (
              <button
                type="button"
                onClick={() => {
                  setShowTotpField(true);
                  if (mfaEntries.length > 0) {
                    setMfaMode('existing');
                  } else {
                    setMfaMode('manual');
                  }
                }}
                className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5 transition-colors p-2 rounded-md hover:bg-gray-700/50 w-full justify-center border border-dashed border-gray-600 hover:border-cyan-500/50"
              >
                <ShieldCheckIcon className="w-4 h-4" />
                <span>+ Asignar código MFA / Doble Factor (TOTP)</span>
              </button>
            ) : (
              <div className="p-3.5 bg-gray-900/80 rounded-lg border border-cyan-500/30 space-y-3">
                <div className="flex items-center justify-between border-b border-gray-700/60 pb-2">
                  <span className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
                    <ShieldCheckIcon className="w-4 h-4 text-cyan-400" />
                    Autenticación MFA / Doble Factor (TOTP)
                  </span>
                  <button
                    type="button"
                    onClick={handleRemoveTotp}
                    className="text-[11px] text-gray-400 hover:text-red-400 flex items-center gap-1 transition-colors"
                    title="Desvincular o quitar código MFA de esta contraseña"
                  >
                    <XIcon className="w-3 h-3" />
                    Quitar MFA
                  </button>
                </div>

                {/* Mode Selector Tabs (Existing vs New Key) */}
                {mfaEntries.length > 0 && (
                  <div className="grid grid-cols-2 gap-1 bg-gray-800 p-1 rounded-md border border-gray-700">
                    <button
                      type="button"
                      onClick={() => setMfaMode('existing')}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-xs font-medium transition-colors ${mfaMode === 'existing'
                          ? 'bg-cyan-600 text-white shadow-sm'
                          : 'text-gray-400 hover:text-gray-200'
                        }`}
                    >
                      <LinkIcon className="w-3.5 h-3.5" />
                      <span>Enlazar existente ({mfaEntries.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMfaMode('manual')}
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-xs font-medium transition-colors ${mfaMode === 'manual'
                          ? 'bg-cyan-600 text-white shadow-sm'
                          : 'text-gray-400 hover:text-gray-200'
                        }`}
                    >
                      <KeyIcon className="w-3.5 h-3.5" />
                      <span>Ingresar clave manual</span>
                    </button>
                  </div>
                )}

                {/* Mode 1: Select from Existing MFA Entries (Modal Trigger) */}
                {mfaMode === 'existing' && mfaEntries.length > 0 ? (
                  <div className="space-y-2">
                    <label className="text-[11px] font-medium text-gray-300 block">
                      Selecciona una cuenta MFA guardada en la bóveda:
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setMfaSearchTerm('');
                        setIsMfaPickerModalOpen(true);
                      }}
                      className="w-full p-2.5 bg-gray-800 hover:bg-gray-750 active:bg-gray-700 rounded-md border border-gray-600 hover:border-cyan-500 text-xs text-white flex items-center justify-between transition-all group"
                    >
                      <div className="flex items-center gap-2 truncate text-left">
                        <ShieldCheckIcon className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                        {matchedExistingMfa ? (
                          <span className="truncate">
                            <strong className="text-cyan-300 font-semibold">{matchedExistingMfa.issuer}</strong>
                            {matchedExistingMfa.account && (
                              <span className="text-gray-400 ml-1.5">({matchedExistingMfa.account})</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-400 italic">-- Seleccionar cuenta MFA existente --</span>
                        )}
                      </div>
                      <ChevronDownIcon className="w-4 h-4 text-gray-400 group-hover:text-cyan-400 flex-shrink-0 transition-colors" />
                    </button>

                    {matchedExistingMfa && (
                      <div className="text-[11px] text-cyan-400/90 flex items-center justify-between bg-cyan-950/30 p-2 rounded border border-cyan-500/20">
                        <div className="flex items-center gap-1.5 truncate">
                          <LinkIcon className="w-3.5 h-3.5 flex-shrink-0 text-cyan-400" />
                          <span className="truncate">
                            Enlazado a: <strong>{matchedExistingMfa.issuer}</strong>{' '}
                            {matchedExistingMfa.account && `(${matchedExistingMfa.account})`}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setMfaSearchTerm('');
                            setIsMfaPickerModalOpen(true);
                          }}
                          className="text-[10px] text-cyan-300 underline hover:text-cyan-200 ml-2 whitespace-nowrap"
                        >
                          Cambiar
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Mode 2: Manual Key Input / Generate */
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-medium text-gray-300 flex items-center gap-1.5">
                        <KeyIcon className="w-3.5 h-3.5 text-cyan-400" />
                        Clave Secreta Base32 o URL otpauth://:
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
                    {matchedExistingMfa && (
                      <p className="text-[11px] text-cyan-400 flex items-center gap-1">
                        <ShieldCheckIcon className="w-3 h-3" />
                        Esta clave coincide con la cuenta MFA: <strong>{matchedExistingMfa.issuer}</strong>
                      </p>
                    )}
                  </div>
                )}

                {/* Live TOTP Code Preview */}
                {liveTotpPreview && (
                  <div className="flex items-center justify-between bg-black/50 px-3.5 py-2.5 rounded-md border border-cyan-500/40 mt-2">
                    <div>
                      <span className="text-[10px] text-cyan-400 block font-semibold">
                        Código MFA en tiempo real:
                      </span>
                      <span className="font-mono text-xl font-bold text-white tracking-widest">
                        {formatTotpCode(liveTotpPreview)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-gray-400 block">Renovación:</span>
                      <span className="text-xs font-mono font-bold text-cyan-400">
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

      {/* Dedicated Custom Modal for MFA Selection */}
      {isMfaPickerModalOpen && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 z-[60] animate-fade-in"
          onClick={() => setIsMfaPickerModalOpen(false)}
        >
          <div
            className="bg-gray-900 border border-gray-700/80 rounded-2xl shadow-2xl w-full max-w-md text-gray-100 flex flex-col max-h-[85vh] overflow-hidden animate-fade-in-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <ShieldCheckIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white leading-tight">
                    Seleccionar Cuenta MFA
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Elige la cuenta de doble factor a vincular
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMfaPickerModalOpen(false)}
                className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Search Bar */}
            <div className="p-3 sm:p-4 border-b border-gray-800 bg-gray-950/40">
              <div className="relative">
                <SearchIcon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Buscar por servicio o usuario..."
                  value={mfaSearchTerm}
                  onChange={(e) => setMfaSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-gray-800 border border-gray-700 rounded-xl text-xs sm:text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 transition-colors"
                  autoFocus
                />
                {mfaSearchTerm && (
                  <button
                    type="button"
                    onClick={() => setMfaSearchTerm('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                  >
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* List of MFA Entries */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5">
              {/* Desvincular / Clear option */}
              <button
                type="button"
                onClick={() => handleSelectExistingMfa('')}
                className={`w-full p-3 rounded-xl border text-left flex items-center justify-between transition-all ${!totpSecret
                    ? 'bg-cyan-950/40 border-cyan-500/50 text-cyan-300'
                    : 'bg-gray-800/60 border-gray-700/60 hover:bg-gray-800 text-gray-300'
                  }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-400 text-xs">
                    ✕
                  </div>
                  <div>
                    <span className="font-semibold text-xs sm:text-sm block">
                      -- Ninguna (Desvincular cuenta MFA) --
                    </span>
                    <span className="text-[11px] text-gray-400">
                      No usar código de doble factor en esta contraseña
                    </span>
                  </div>
                </div>
                {!totpSecret && (
                  <div className="w-5 h-5 rounded-full bg-cyan-500 text-black flex items-center justify-center flex-shrink-0">
                    <CheckIcon className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                )}
              </button>

              {filteredMfaEntries.length > 0 ? (
                filteredMfaEntries.map((mfa) => {
                  const isSelected =
                    selectedMfaId === mfa.id ||
                    (matchedExistingMfa && matchedExistingMfa.id === mfa.id);
                  const currentCode = generateTotpSync(mfa.secret, {
                    time: currentTime,
                    period: mfa.period || 30,
                    digits: mfa.digits || 6,
                    algorithm: mfa.algorithm || 'SHA-1',
                  });

                  return (
                    <button
                      key={mfa.id}
                      type="button"
                      onClick={() => handleSelectExistingMfa(mfa.id)}
                      className={`w-full p-3 sm:p-3.5 rounded-xl border text-left flex items-center justify-between transition-all group ${isSelected
                          ? 'bg-cyan-950/50 border-cyan-500 shadow-sm text-white'
                          : 'bg-gray-800/80 border-gray-700/70 hover:bg-gray-800 hover:border-cyan-500/50 text-gray-200'
                        }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-2">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm ${isSelected ? 'bg-cyan-500 text-black' : 'bg-gray-700 text-cyan-400 group-hover:bg-cyan-500/20'
                          }`}>
                          <ShieldCheckIcon className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 truncate">
                          <p className={`font-bold text-xs sm:text-sm truncate ${isSelected ? 'text-cyan-300' : 'text-white'}`}>
                            {mfa.issuer}
                          </p>
                          {mfa.account ? (
                            <p className="text-[11px] sm:text-xs text-gray-400 truncate">
                              {mfa.account}
                            </p>
                          ) : (
                            <p className="text-[10px] text-gray-500 italic">Cuenta protegida</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 flex-shrink-0">
                        {currentCode && (
                          <div className="hidden xs:flex flex-col items-end">
                            <span className="font-mono text-xs font-bold text-cyan-300 tracking-wider">
                              {formatTotpCode(currentCode)}
                            </span>
                            <span className="text-[9px] text-gray-500">
                              {getTotpRemainingSeconds(mfa.period || 30)}s
                            </span>
                          </div>
                        )}
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all ${isSelected
                            ? 'bg-cyan-500 border-cyan-500 text-black'
                            : 'border-gray-600 bg-gray-700/50 text-transparent group-hover:border-cyan-400'
                          }`}>
                          <CheckIcon className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="text-center py-8 text-gray-400 text-xs">
                  No se encontraron cuentas MFA con ese nombre
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 sm:p-4 border-t border-gray-800 flex justify-end bg-gray-900/90">
              <button
                type="button"
                onClick={() => setIsMfaPickerModalOpen(false)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs sm:text-sm font-semibold rounded-xl transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PasswordModal;
