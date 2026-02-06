
import React, { useState, useEffect, useCallback } from 'react';
import { CopyIcon, CheckIcon, SparklesIcon } from './Icons';

interface PasswordGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPasswordGenerated: (password: string) => void;
}

const PasswordGeneratorModal: React.FC<PasswordGeneratorModalProps> = ({ isOpen, onClose, onPasswordGenerated }) => {
  const [length, setLength] = useState(16);
  const [includeUppercase, setIncludeUppercase] = useState(true);
  const [includeNumbers, setIncludeNumbers] = useState(true);
  const [includeSymbols, setIncludeSymbols] = useState(true);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [copied, setCopied] = useState(false);

  const generatePassword = useCallback(() => {
    const lowerCharset = 'abcdefghijklmnopqrstuvwxyz';
    const upperCharset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numberCharset = '0123456789';
    const symbolCharset = '!@#$%^&*()_+-=[]{}|;:,.<>?';

    let charset = lowerCharset;
    if (includeUppercase) charset += upperCharset;
    if (includeNumbers) charset += numberCharset;
    if (includeSymbols) charset += symbolCharset;
    
    if (charset.length === 0) {
      setGeneratedPassword('');
      return;
    }

    // Use crypto.getRandomValues for better entropy
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    
    let password = '';
    for (let i = 0; i < length; i++) {
      const randomIndex = array[i] % charset.length;
      password += charset[randomIndex];
    }
    setGeneratedPassword(password);
  }, [length, includeUppercase, includeNumbers, includeSymbols]);

  useEffect(() => {
    if (isOpen) {
        generatePassword();
    }
  }, [isOpen, generatePassword]);

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const handleUsePassword = () => {
    onPasswordGenerated(generatedPassword);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50 p-6">
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md text-gray-200 animate-fade-in-up ml-2 mr-2">
        <h2 className="text-2xl font-bold mb-4 flex items-center"><SparklesIcon className="w-6 h-6 mr-2 text-cyan-400" />Generador de contraseñas</h2>
        
        <div className="bg-gray-900 p-4 rounded-md mb-4 flex items-center justify-between">
          <span className="font-mono text-lg break-all mr-4">{generatedPassword}</span>
          <button onClick={handleCopy} className="p-2 rounded-md hover:bg-gray-700 transition-colors">
            {copied ? <CheckIcon className="w-6 h-6 text-green-400" /> : <CopyIcon className="w-6 h-6 text-gray-400" />}
          </button>
        </div>
        
        <div className="space-y-4">
          <div>
            <label htmlFor="length" className="block text-sm font-medium text-gray-400 mb-1">Longitud: {length}</label>
            <input
              type="range"
              id="length"
              min="8"
              max="64"
              value={length}
              onChange={(e) => setLength(parseInt(e.target.value, 10))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
            />
          </div>
          <div className="flex justify-between items-center">
             <label htmlFor="uppercase" className="text-gray-300">Incluir mayúsculas (A-Z)</label>
             <input type="checkbox" id="uppercase" checked={includeUppercase} onChange={(e) => setIncludeUppercase(e.target.checked)} className="h-5 w-5 rounded bg-gray-700 border-gray-600 text-cyan-600 focus:ring-cyan-500"/>
          </div>
          <div className="flex justify-between items-center">
             <label htmlFor="numbers" className="text-gray-300">Incluir números (0-9)</label>
             <input type="checkbox" id="numbers" checked={includeNumbers} onChange={(e) => setIncludeNumbers(e.target.checked)} className="h-5 w-5 rounded bg-gray-700 border-gray-600 text-cyan-600 focus:ring-cyan-500"/>
          </div>
          <div className="flex justify-between items-center">
             <label htmlFor="symbols" className="text-gray-300">Incluir símbolos (!@#..)</label>
             <input type="checkbox" id="symbols" checked={includeSymbols} onChange={(e) => setIncludeSymbols(e.target.checked)} className="h-5 w-5 rounded bg-gray-700 border-gray-600 text-cyan-600 focus:ring-cyan-500"/>
          </div>
        </div>

        <div className="mt-6 flex flex-col space-y-2 w-full md:flex-row md:space-y-0 md:space-x-3">
          <button onClick={onClose} className="w-full px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 transition-colors font-semibold">Cancelar</button>
          <button onClick={generatePassword} className="w-full px-4 py-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors font-semibold">Regenerar</button>
          <button onClick={handleUsePassword} className="w-full px-4 py-2 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold">Usar contraseña</button>
        </div>
      </div>
    </div>
  );
};

export default PasswordGeneratorModal;
