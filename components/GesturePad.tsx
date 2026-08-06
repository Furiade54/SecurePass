
import React, { useEffect, useRef, useState } from 'react';

export interface GesturePadProps {
  onPatternComplete?: (pattern: number[]) => void;
  minPoints?: number;
  showError?: boolean;
  resetKey?: number | string;
  accentColor?: string;
  errorColor?: string;
  dotClassName?: string;
  className?: string;
}

const GesturePad: React.FC<GesturePadProps> = ({
  onPatternComplete,
  minPoints = 4,
  showError = false,
  resetKey,
  accentColor = 'bg-cyan-400',
  errorColor = 'bg-red-500',
  className = '',
  dotClassName = '',
}) => {
  const [path, setPath] = useState<number[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [errorFlash, setErrorFlash] = useState(false);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const dotPositions = useRef<{ x: number; y: number }[]>([]);

  useEffect(() => {
    setPath([]);
    setLines([]);
    setIsDrawing(false);
    setErrorFlash(false);
  }, [resetKey]);

  useEffect(() => {
    if (!gridRef.current) return;
    const measure = () => {
      if (!gridRef.current) return;
      const dots = Array.from(gridRef.current.children).filter(
        (el) => (el as HTMLElement).dataset.role === 'gesture-dot'
      ) as HTMLElement[];
      dotPositions.current = dots.map((dot) => ({
        x: dot.offsetLeft + dot.offsetWidth / 2,
        y: dot.offsetTop + dot.offsetHeight / 2,
      }));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const getDotIndexFromEvent = (e: React.MouseEvent | React.TouchEvent) => {
    if (!gridRef.current) return -1;
    const rect = gridRef.current.getBoundingClientRect();
    const touch = 'touches' in e ? e.touches[0] : e;
    if (!touch) return -1;
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    let closestDot = -1;
    let minDistance = Infinity;

    dotPositions.current.forEach((pos, index) => {
      const distance = Math.sqrt(Math.pow(pos.x - x, 2) + Math.pow(pos.y - y, 2));
      if (distance < 36 && distance < minDistance) {
        minDistance = distance;
        closestDot = index;
      }
    });

    return closestDot;
  };

  const handleInteractionStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDrawing(true);
    setErrorFlash(false);
    const index = getDotIndexFromEvent(e);
    if (index !== -1) {
      setPath([index]);
    }
  };

  const handleInteractionMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const touch = 'touches' in e ? e.touches[0] : e;
    if (!touch || !gridRef.current) return;

    const rect = gridRef.current.getBoundingClientRect();
    setMousePos({ x: touch.clientX - rect.left, y: touch.clientY - rect.top });

    const index = getDotIndexFromEvent(e);
    if (index !== -1 && !path.includes(index)) {
      setPath((prev) => [...prev, index]);
    }
  };

  useEffect(() => {
    const newLines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const startDotPos = dotPositions.current[path[i]];
      const endDotPos = dotPositions.current[path[i + 1]];
      if (startDotPos && endDotPos) {
        newLines.push({ x1: startDotPos.x, y1: startDotPos.y, x2: endDotPos.x, y2: endDotPos.y });
      }
    }
    setLines(newLines);
  }, [path]);

  const reset = () => {
    setPath([]);
    setLines([]);
    setIsDrawing(false);
    setErrorFlash(false);
  };

  const handleInteractionEnd = () => {
    if (!isDrawing) return;

    if (path.length > 0) {
      if (path.length < minPoints) {
        setErrorFlash(true);
        setTimeout(reset, 700);
      } else {
        if (onPatternComplete) {
          onPatternComplete(path);
        }
        setTimeout(reset, 250);
      }
    } else {
      setIsDrawing(false);
    }
  };

  const hasError = showError || errorFlash;
  const strokeColor = hasError ? 'stroke-red-500' : 'stroke-cyan-400';
  const dotActiveClass = hasError ? errorColor : accentColor;

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <div
        ref={gridRef}
        className="grid grid-cols-3 gap-10 p-6 rounded-lg relative touch-none select-none touch-none select-none"
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
            data-role="gesture-dot"
            className={`w-10 h-10 rounded-full bg-gray-600/70 flex items-center justify-center ring-1 ring-gray-500/40 shadow-inner ${dotClassName}`}
          >
            <div
              className={`w-5 h-5 rounded-full transition-all duration-150 ${
                path.includes(i)
                  ? `${dotActiveClass} scale-110 shadow-lg`
                  : 'bg-gray-600'
              }`}
            />
          </div>
        ))}
        <svg className="absolute top-0 left-0 w-full h-full pointer-events-none">
          {lines.map((line, i) => (
            <line
              key={`l-${i}`}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              className={`stroke-[3] ${strokeColor}`}
            />
          ))}
          {isDrawing && path.length > 0 && dotPositions.current[path[path.length - 1]] && (
            <line
              x1={dotPositions.current[path[path.length - 1]]?.x}
              y1={dotPositions.current[path[path.length - 1]]?.y}
              x2={mousePos.x}
              y2={mousePos.y}
              className={`stroke-[3] ${strokeColor}`}
            />
          )}
        </svg>
      </div>
      <p
        className={`mt-2 text-xs transition-opacity duration-200 ${
          path.length > 0 && path.length < minPoints ? 'text-red-400 opacity-100' : 'text-gray-500 opacity-70'
        }`}
      >
        {path.length > 0 && path.length < minPoints
          ? `Conecta al menos ${minPoints} puntos.`
          : `Puntos: ${path.length || '—'}`}
      </p>
    </div>
  );
};

export default GesturePad;
