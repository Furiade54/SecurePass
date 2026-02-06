import React from 'react';
import { XIcon } from './Icons';

interface MessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  type?: 'error' | 'success' | 'info' | 'warning';
  onConfirm?: () => void;
  confirmText?: string;
  cancelText?: string;
}

const MessageModal: React.FC<MessageModalProps> = ({ 
    isOpen, 
    onClose, 
    title, 
    message, 
    type = 'info',
    onConfirm,
    confirmText = 'Aceptar',
    cancelText = 'Cancelar'
}) => {
  if (!isOpen) return null;

  let bgColor = 'bg-cyan-600';
  let textColor = 'text-cyan-400';
  let borderColor = 'border-cyan-500';

  if (type === 'error') {
      bgColor = 'bg-red-600';
      textColor = 'text-red-400';
      borderColor = 'border-red-500';
  } else if (type === 'success') {
      bgColor = 'bg-green-600';
      textColor = 'text-green-400';
      borderColor = 'border-green-500';
  } else if (type === 'warning') {
      bgColor = 'bg-yellow-600';
      textColor = 'text-yellow-400';
      borderColor = 'border-yellow-500';
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className={`bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm border ${borderColor} overflow-hidden transform transition-all scale-100 opacity-100 animate-in fade-in zoom-in duration-200`}>
        
        {/* Header */}
        <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900/50">
            <h3 className={`text-lg font-bold ${textColor}`}>{title}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-1 rounded-full hover:bg-gray-700">
                <XIcon className="w-5 h-5" />
            </button>
        </div>

        {/* Content */}
        <div className="p-6 text-center">
          <p className="text-gray-200 text-base font-medium whitespace-pre-wrap leading-relaxed">{message}</p>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 bg-gray-900/30 flex justify-center space-x-3">
          {onConfirm && (
              <button 
                onClick={onClose}
                className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold rounded-lg transition-all"
              >
                {cancelText}
              </button>
          )}
          
          <button 
            onClick={() => {
                if (onConfirm) onConfirm();
                onClose();
            }}
            className={`px-8 py-2 ${bgColor} hover:brightness-110 text-white font-bold rounded-lg transition-all shadow-lg transform hover:scale-105 active:scale-95`}
          >
            {confirmText}
          </button>
        </div>

      </div>
    </div>
  );
};

export default MessageModal;
