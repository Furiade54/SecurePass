
import React, { useState, useRef, useEffect } from 'react';

interface GestureUnlockScreenProps {
  onUnlock: (pattern: number[]) => void;
  onSetGesture: (pattern: number[]) => void;
  onResetGesture: () => void;
  hasGesture: boolean;
}

const GestureUnlockScreen: React.FC<GestureUnlockScreenProps> = ({ onUnlock, onSetGesture, onResetGesture, hasGesture }) => {
  const [path, setPath] = useState<number[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lines, setLines] = useState<{ x1: number, y1: number, x2: number, y2: number }[]>([]);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [error, setError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [firstPattern, setFirstPattern] = useState<number[]>([]);
  
  // Secret reset functionality
  const [centerDotClicks, setCenterDotClicks] = useState(0);
  const [lastClickTime, setLastClickTime] = useState(0);
  const [showResetHint, setShowResetHint] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);
  const dotPositions = useRef<{ x: number, y: number }[]>([]);

  useEffect(() => {
    if (gridRef.current) {
      const dots = Array.from(gridRef.current.children) as HTMLDivElement[];
      dotPositions.current = dots.map(dot => ({
        x: dot.offsetLeft + dot.offsetWidth / 2,
        y: dot.offsetTop + dot.offsetHeight / 2,
      }));
    }
  }, []);

  const getDotIndexFromEvent = (e: React.MouseEvent | React.TouchEvent) => {
    if (!gridRef.current) return -1;
    const rect = gridRef.current.getBoundingClientRect();
    const touch = 'touches' in e ? e.touches[0] : e;
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    
    let closestDot = -1;
    let minDistance = Infinity;
    
    dotPositions.current.forEach((pos, index) => {
        const distance = Math.sqrt(Math.pow(pos.x - x, 2) + Math.pow(pos.y - y, 2));
        if (distance < 30 && distance < minDistance) { // 30px radius
            minDistance = distance;
            closestDot = index;
        }
    });

    return closestDot;
  };

  const handleInteractionStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDrawing(true);
    const index = getDotIndexFromEvent(e);
    if (index !== -1) {
      setPath([index]);
    }
  };

  const handleInteractionMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const touch = 'touches' in e ? e.touches[0] : e;

    if (gridRef.current) {
        const rect = gridRef.current.getBoundingClientRect();
        setMousePos({ x: touch.clientX - rect.left, y: touch.clientY - rect.top });
    }

    const index = getDotIndexFromEvent(e);
    if (index !== -1 && !path.includes(index)) {
        setPath(prev => [...prev, index]);
    }
  };
  
  useEffect(() => {
      const newLines = [];
      for (let i = 0; i < path.length - 1; i++) {
          const startDotPos = dotPositions.current[path[i]];
          const endDotPos = dotPositions.current[path[i + 1]];
          if(startDotPos && endDotPos) {
              newLines.push({ x1: startDotPos.x, y1: startDotPos.y, x2: endDotPos.x, y2: endDotPos.y });
          }
      }
      setLines(newLines);
  }, [path]);

  const reset = () => {
    setPath([]);
    setLines([]);
    setIsDrawing(false);
    setError(false);
  };

  // Handle secret center dot clicks for reset
  const handleCenterDotClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const now = Date.now();
    const timeDiff = now - lastClickTime;
    
    // Reset counter if more than 3 seconds between clicks
    if (timeDiff > 3000) {
      setCenterDotClicks(1);
    } else {
      setCenterDotClicks(prev => prev + 1);
    }
    
    setLastClickTime(now);
    
    // If 7 clicks reached, trigger reset
    if (centerDotClicks + 1 >= 7) {
      setShowResetHint(true);
      setTimeout(() => {
        setShowResetHint(false);
        setCenterDotClicks(0);
        onResetGesture();
      }, 2000);
    }
  };

  const handleInteractionEnd = () => {
    if (!isDrawing) return;
    
    if (path.length > 0) {
      if (!hasGesture) {
        if (path.length < 4) {
          setError(true);
          setTimeout(reset, 800);
          return;
        }
        if (!confirming) {
          setFirstPattern(path);
          setConfirming(true);
          setTimeout(reset, 300);
        } else {
          if (JSON.stringify(firstPattern) === JSON.stringify(path)) {
            onSetGesture(path);
          } else {
            setError(true);
            setConfirming(false);
            setFirstPattern([]);
            setTimeout(reset, 800);
          }
        }
      } else {
        // Check minimum length for unlock attempts too
        if (path.length < 4) {
            reset();
            return;
        }
        onUnlock(path);
        // App.tsx will handle success/failure. We listen for hasGesture prop change.
        // For visual feedback, we can show an error state if unlock fails
        setError(true); // Assume error, will be cleared on successful unlock
        setTimeout(reset, 800);
      }
    } else {
        setIsDrawing(false);
    }
  };


  let title = "Desbloquear bóveda";
  if (!hasGesture) {
      title = confirming ? "Confirma el patrón" : "Crea un patrón de desbloqueo";
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-900 text-gray-200 p-4">
        <h1 className="text-2xl font-bold mb-2">{title}</h1>
        <p className="text-gray-400 mb-6 text-center">
            { !hasGesture && !confirming && 'Dibuja un patrón conectando al menos 4 puntos.'}
            { !hasGesture && confirming && 'Dibuja el mismo patrón nuevamente para confirmar.'}
            { hasGesture && 'Conecta los puntos para desbloquear tu bóveda.'}
        </p>
        <div
            ref={gridRef}
            className="grid grid-cols-3 gap-8 p-8 rounded-lg relative touch-none"
            onMouseDown={handleInteractionStart}
            onMouseMove={handleInteractionMove}
            onMouseUp={handleInteractionEnd}
            onMouseLeave={handleInteractionEnd}
            onTouchStart={handleInteractionStart}
            onTouchMove={handleInteractionMove}
            onTouchEnd={handleInteractionEnd}
        >
            {[...Array(9)].map((_, i) => (
                <div 
                    key={i} 
                    className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center"
                    onClick={i === 4 ? handleCenterDotClick : undefined}
                >
                    <div className={`w-4 h-4 rounded-full transition-colors duration-200 ${path.includes(i) ? (error ? 'bg-red-500' : 'bg-cyan-400') : 'bg-gray-600'}`}></div>
                </div>
            ))}
            <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
                {lines.map((line, i) => (
                    <line key={i} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} className={`stroke-2 ${error ? 'stroke-red-500' : 'stroke-cyan-400'}`} />
                ))}
                {isDrawing && path.length > 0 && (
                     <line x1={dotPositions.current[path[path.length - 1]]?.x} y1={dotPositions.current[path[path.length - 1]]?.y} x2={mousePos.x} y2={mousePos.y} className={`stroke-2 ${error ? 'stroke-red-500' : 'stroke-cyan-400'}`} />
                )}
            </svg>
        </div>
         <p className={`mt-4 text-red-500 transition-opacity duration-300 ${error && !hasGesture ? 'opacity-100' : 'opacity-0'}`}>
            {path.length > 0 && path.length < 4 ? 'Conecta al menos 4 puntos.' : 'Los patrones no coinciden.'}
        </p>
        
        {/* Secret reset hint */}
        {showResetHint && (
            <div className="mt-4 p-3 bg-yellow-500/20 border border-yellow-400 rounded-lg text-yellow-300 text-sm">
                <p className="font-semibold">🔓 Modo de reinicio activado</p>
                <p>Tu patrón de gestos ha sido reiniciado. Crea un nuevo patrón.</p>
            </div>
        )}
        
        {/* Secret hint for advanced users */}
        {hasGesture && centerDotClicks > 0 && centerDotClicks < 7 && (
            <p className="mt-2 text-xs text-gray-500 opacity-50">
                Clics secretos: {centerDotClicks}/7
            </p>
        )}
    </div>
  );
};

export default GestureUnlockScreen;
