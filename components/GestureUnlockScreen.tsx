
import React, { useState, useEffect } from 'react';
import GesturePad from './GesturePad';

interface GestureUnlockScreenProps {
  onUnlock: (pattern: number[]) => void;
  onSetGesture: (pattern: number[]) => void;
  onResetGesture: () => void;
  hasGesture: boolean;
}

const GestureUnlockScreen: React.FC<GestureUnlockScreenProps> = ({
  onUnlock,
  onSetGesture,
  onResetGesture,
  hasGesture,
}) => {
  const [confirming, setConfirming] = useState(false);
  const [firstPattern, setFirstPattern] = useState<number[]>([]);
  const [error, setError] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const [centerDotClicks, setCenterDotClicks] = useState(0);
  const [lastClickTime, setLastClickTime] = useState(0);
  const [showResetHint, setShowResetHint] = useState(false);

  useEffect(() => {
    setConfirming(false);
    setFirstPattern([]);
    setError(false);
  }, [hasGesture]);

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => {
        setError(false);
        setResetKey((k) => k + 1);
      }, 800);
      return () => clearTimeout(t);
    }
  }, [error]);

  const handleCenterDotClick = () => {
    const now = Date.now();
    const timeDiff = now - lastClickTime;

    if (timeDiff > 3000) {
      setCenterDotClicks(1);
    } else {
      setCenterDotClicks((prev) => prev + 1);
    }

    setLastClickTime(now);

    if (centerDotClicks + 1 >= 7) {
      setShowResetHint(true);
      setTimeout(() => {
        setShowResetHint(false);
        setCenterDotClicks(0);
        onResetGesture();
      }, 2000);
    }
  };

  const handlePattern = (pattern: number[]) => {
    if (!hasGesture) {
      if (!confirming) {
        setFirstPattern(pattern);
        setConfirming(true);
        setResetKey((k) => k + 1);
      } else {
        if (JSON.stringify(firstPattern) === JSON.stringify(pattern)) {
          onSetGesture(pattern);
        } else {
          setError(true);
          setConfirming(false);
          setFirstPattern([]);
        }
      }
    } else {
      onUnlock(pattern);
      setError(true);
    }
  };

  let title = 'Desbloquear bóveda';
  if (!hasGesture) {
    title = confirming ? 'Confirma el patrón' : 'Crea un patrón de desbloqueo';
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-900 text-gray-200 p-4">
      <h1 className="text-2xl font-bold mb-2">{title}</h1>
      <p className="text-gray-400 mb-6 text-center">
        {!hasGesture && !confirming && 'Dibuja un patrón conectando al menos 4 puntos.'}
        {!hasGesture && confirming && 'Dibuja el mismo patrón nuevamente para confirmar.'}
        {hasGesture && 'Conecta los puntos para desbloquear tu bóveda.'}
      </p>

      <div className="relative">
        <GesturePad
          onPatternComplete={handlePattern}
          minPoints={4}
          showError={error}
          resetKey={resetKey}
        />
        <button
          type="button"
          aria-label="Reinicio secreto"
          className="absolute left-1/2 -translate-x-1/2 w-6 h-6 opacity-0"
          style={{ top: 'calc(50% + 8px)' }}
          onClick={handleCenterDotClick}
          tabIndex={-1}
        />
      </div>

      <p className={`mt-4 text-red-500 transition-opacity duration-300 h-5`}>
        {error && !hasGesture
          ? firstPattern.length > 0
            ? 'Los patrones no coinciden.'
            : 'Conecta al menos 4 puntos.'
          : ''}
      </p>

      {showResetHint && (
        <div className="mt-4 p-3 bg-yellow-500/20 border border-yellow-400 rounded-lg text-yellow-300 text-sm">
          <p className="font-semibold">🔓 Modo de reinicio activado</p>
          <p>Tu patrón de gestos ha sido reiniciado. Crea un nuevo patrón.</p>
        </div>
      )}

      {hasGesture && centerDotClicks > 0 && centerDotClicks < 7 && (
        <p className="mt-2 text-xs text-gray-500 opacity-50">
          Clics secretos: {centerDotClicks}/7
        </p>
      )}
    </div>
  );
};

export default GestureUnlockScreen;
