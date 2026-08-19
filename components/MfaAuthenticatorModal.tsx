import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MfaEntry, PasswordEntry } from '../types';
import {
  ShieldCheckIcon,
  CopyIcon,
  CheckIcon,
  TrashIcon,
  CameraIcon,
  ClockIcon,
  QrCodeIcon,
  UploadIcon,
  ZapIcon,
  ZapOffIcon,
  SwitchCameraIcon
} from './Icons';
import {
  generateTotpSync,
  getTotpRemainingSeconds,
  parseOtpAuthUri,
  formatTotpCode,
  buildOtpAuthUri,
  parseMigrationPayload
} from '../utils/totp';
import QRCode from 'react-qr-code';
import { Html5Qrcode } from 'html5-qrcode';
import jsQR from 'jsqr';

interface MfaAuthenticatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  mfaEntries: MfaEntry[];
  onSaveMfaEntry: (entry: Omit<MfaEntry, 'id' | 'createdAt'> & { id?: string }) => void;
  onDeleteMfaEntry: (id: string) => void;
  passwords?: PasswordEntry[];
}

const QR_READER_ELEMENT_ID = 'mfa-totp-qr-reader';

const ISSUER_COLORS: Record<string, string> = {
  google: 'from-red-500 to-amber-500',
  microsoft: 'from-blue-600 to-cyan-500',
  github: 'from-purple-600 to-indigo-600',
  amazon: 'from-amber-600 to-yellow-500',
  apple: 'from-gray-500 to-gray-700',
  facebook: 'from-blue-700 to-blue-500',
  twitter: 'from-sky-500 to-blue-400',
  discord: 'from-indigo-500 to-purple-500',
  binance: 'from-yellow-500 to-amber-600',
  dropbox: 'from-blue-500 to-indigo-600',
  slack: 'from-emerald-500 to-teal-600',
  default: 'from-cyan-600 to-blue-600'
};

function getIssuerGradient(issuer: string): string {
  const normalized = issuer.trim().toLowerCase();
  for (const [key, gradient] of Object.entries(ISSUER_COLORS)) {
    if (normalized.includes(key)) {
      return gradient;
    }
  }
  return ISSUER_COLORS.default;
}

const MfaAuthenticatorModal: React.FC<MfaAuthenticatorModalProps> = ({
  isOpen,
  onClose,
  mfaEntries,
  onSaveMfaEntry,
  onDeleteMfaEntry
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [viewingQrEntry, setViewingQrEntry] = useState<MfaEntry | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Scanner state & controls (matching ImportExportModal)
  const [isScanning, setIsScanning] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [availableCameras, setAvailableCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');

  const qrScannerRef = useRef<Html5Qrcode | null>(null);
  const isScannerRunningRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Live timer tick (updates every second)
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Clean up camera scanner on close
  useEffect(() => {
    if (!isOpen && isScanning) {
      void stopCameraScanner();
    }
  }, [isOpen, isScanning]);

  const showNotification = (msg: string, isError = false) => {
    if (isError) {
      setErrorMessage(msg);
      setSuccessMessage(null);
      setTimeout(() => setErrorMessage(null), 6000);
    } else {
      setSuccessMessage(msg);
      setErrorMessage(null);
      setTimeout(() => setSuccessMessage(null), 4500);
    }
  };

  const handleCopyCode = (id: string, code: string) => {
    navigator.clipboard.writeText(code.replace(/\s+/g, ''));
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  // Process decoded QR text
  const processQrText = (qrText: string): boolean => {
    const trimmed = qrText.trim();
    if (trimmed.toLowerCase().startsWith('otpauth-migration://')) {
      const migrationEntries = parseMigrationPayload(trimmed);
      if (!migrationEntries || migrationEntries.length === 0) {
        showNotification(
          'No se encontraron cuentas válidas en el código de migración de Google Authenticator.',
          true
        );
        return false;
      }

      let addedCount = 0;
      let existsCount = 0;

      for (const entry of migrationEntries) {
        const exists = mfaEntries.some(
          (e) =>
            e.secret.replace(/\s+/g, '').toUpperCase() ===
            entry.secret.replace(/\s+/g, '').toUpperCase()
        );

        if (exists) {
          existsCount++;
        } else {
          onSaveMfaEntry({
            issuer: entry.issuer || 'Google Authenticator',
            account: entry.name || 'MFA',
            secret: entry.secret,
            algorithm: entry.algorithm,
            digits: entry.digits,
            period: 30
          });
          addedCount++;
        }
      }

      if (addedCount > 0) {
        showNotification(
          `¡Se importaron ${addedCount} cuenta(s) exitosamente desde Google Authenticator!${
            existsCount > 0 ? ` (${existsCount} ya existían)` : ''
          }`
        );
        return true;
      } else {
        showNotification(
          'Todas las cuentas del código de migración ya se encuentran registradas.',
          true
        );
        return false;
      }
    }

    const parsed = parseOtpAuthUri(qrText);
    if (!parsed) {
      showNotification(
        'El código QR no contiene un formato de autenticación válido (otpauth:// o otpauth-migration://). Asegúrate de escanear un código de Google Authenticator o Microsoft Authenticator.',
        true
      );
      return false;
    }

    // Check if account already exists
    const exists = mfaEntries.some(
      (e) =>
        e.secret.replace(/\s+/g, '').toUpperCase() ===
        parsed.secret.replace(/\s+/g, '').toUpperCase()
    );

    if (exists) {
      showNotification(
        `La cuenta "${parsed.issuer}" (${parsed.account || 'MFA'}) ya se encuentra registrada en tu lista.`,
        true
      );
      return false;
    }

    onSaveMfaEntry({
      issuer: parsed.issuer,
      account: parsed.account,
      secret: parsed.secret,
      algorithm: parsed.algorithm,
      digits: parsed.digits,
      period: parsed.period
    });

    showNotification(`¡Cuenta de "${parsed.issuer}" agregada exitosamente!`);
    return true;
  };

  // Camera Scanner implementation aligned with ImportExportModal
  const startCameraScanner = async (cameraIdToUse?: string) => {
    setErrorMessage(null);
    setIsScanning(true);
    setTorchOn(false);
    setHasTorch(false);

    try {
      if (qrScannerRef.current && isScannerRunningRef.current) {
        await stopCameraScanner();
      }

      await new Promise((resolve) => setTimeout(resolve, 150));
      const scanner = new Html5Qrcode(QR_READER_ELEMENT_ID);
      qrScannerRef.current = scanner;

      const camId = cameraIdToUse || selectedCameraId;
      const cameraConfig = camId
        ? { deviceId: { exact: camId } }
        : { facingMode: 'environment' };

      await scanner.start(
        cameraConfig as Parameters<Html5Qrcode['start']>[0],
        {
          fps: 10,
          qrbox: { width: 240, height: 240 },
          aspectRatio: 1
        },
        async (decodedText) => {
          const success = processQrText(decodedText);
          if (success) {
            await stopCameraScanner();
          }
        },
        () => { }
      );

      isScannerRunningRef.current = true;

      // Detect available video devices
      try {
        if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoInputs = devices.filter((d) => d.kind === 'videoinput');
          setAvailableCameras(
            videoInputs.map((d, i) => ({
              id: d.deviceId,
              label: d.label || `Cámara ${i + 1}`
            }))
          );
        }
      } catch {
        // non-critical
      }

      // Check torch capability
      try {
        const scannerAny = qrScannerRef.current as unknown as {
          getRunningTrackCamera?: () => MediaStreamTrack | undefined;
          getRunningTrack?: () => MediaStreamTrack | undefined;
          _activeTrack?: MediaStreamTrack;
        };
        const track =
          scannerAny?.getRunningTrackCamera?.() ||
          scannerAny?.getRunningTrack?.() ||
          scannerAny?._activeTrack;
        if (track) {
          const caps = (track.getCapabilities?.() as { torch?: boolean }) || {};
          if (caps.torch === true) {
            setHasTorch(true);
          }
        }
      } catch {
        setHasTorch(false);
      }
    } catch {
      qrScannerRef.current = null;
      isScannerRunningRef.current = false;
      setIsScanning(false);
      showNotification('No se pudo acceder a la cámara. Por favor verifica los permisos o usa "Cargar imagen QR".', true);
    }
  };

  const stopCameraScanner = async () => {
    if (qrScannerRef.current && isScannerRunningRef.current) {
      try {
        await qrScannerRef.current.stop();
      } catch {
        // ignore
      }
    }
    qrScannerRef.current = null;
    isScannerRunningRef.current = false;
    setIsScanning(false);
    setTorchOn(false);
    setHasTorch(false);
  };

  const toggleTorch = async () => {
    if (!qrScannerRef.current || !isScannerRunningRef.current) return;
    try {
      const nextTorch = !torchOn;
      await qrScannerRef.current.applyVideoConstraints({
        advanced: [{ torch: nextTorch } as MediaTrackConstraintSet]
      });
      setTorchOn(nextTorch);
    } catch {
      setHasTorch(false);
    }
  };

  const switchCamera = async (nextCamId: string) => {
    setSelectedCameraId(nextCamId);
    await stopCameraScanner();
    await startCameraScanner(nextCamId);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMessage(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qrCode = jsQR(imageData.data, imageData.width, imageData.height);
          if (qrCode && qrCode.data) {
            processQrText(qrCode.data);
          } else {
            showNotification(
              'No se detectó ningún código QR en la imagen seleccionada. Intenta con una captura más nítida.',
              true
            );
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const filteredEntries = useMemo(() => {
    return mfaEntries.filter((entry) => {
      const term = searchTerm.toLowerCase();
      return (
        entry.issuer.toLowerCase().includes(term) ||
        entry.account.toLowerCase().includes(term)
      );
    });
  }, [mfaEntries, searchTerm]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 text-gray-200 flex flex-col h-screen w-screen animate-in fade-in duration-150">
      {/* Top Fixed Header - Aligned with ImportExportModal */}
      <header className="sticky top-0 z-20 flex-shrink-0 bg-gray-800/90 backdrop-blur-sm border-b border-gray-700/60 px-2.5 sm:px-5 pt-safe-top pb-2 sm:py-3">
        <div className="mx-auto w-full max-w-4xl flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center min-w-0">
            <ShieldCheckIcon className="w-5 h-5 mr-2 text-cyan-400 flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold text-white truncate">
                Generador de Códigos MFA / TOTP
              </h2>
              <p className="text-xs text-gray-400 hidden sm:block truncate">
                Compatible con Google Authenticator, Microsoft Authenticator y Authy
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              if (isScanning) void stopCameraScanner();
              onClose();
            }}
            className="flex-shrink-0 inline-flex items-center justify-center rounded-md border border-gray-600 text-gray-300 hover:text-white hover:bg-gray-700 transition-colors w-8 h-8 sm:w-9 sm:h-9"
            aria-label="Cerrar"
            title="Cerrar"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4 sm:w-5 sm:h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Fullscreen Scrollable Body */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto px-2.5 sm:px-5 py-3 sm:py-5 pb-safe-bottom"
      >
        <div className="mx-auto w-full max-w-4xl space-y-4 sm:space-y-5">
          {/* Notifications / Alerts */}
          {successMessage && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3.5 flex items-start justify-between gap-3 text-green-300 text-sm animate-in fade-in">
              <div className="flex items-center gap-2">
                <CheckIcon className="w-5 h-5 text-green-400 flex-shrink-0" />
                <span className="font-semibold">{successMessage}</span>
              </div>
              <button
                onClick={() => setSuccessMessage(null)}
                className="text-green-400 hover:text-green-200 text-xs"
              >
                ✕
              </button>
            </div>
          )}

          {errorMessage && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3.5 flex items-start justify-between gap-3 text-red-300 text-sm animate-in fade-in">
              <div className="flex items-center gap-2">
                <ShieldCheckIcon className="w-5 h-5 text-red-400 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-red-400 hover:text-red-200 text-xs"
              >
                ✕
              </button>
            </div>
          )}

          {/* Camera Scanning Card View (when camera is activated) */}
          {isScanning && (
            <div className="rounded-lg border border-cyan-500/60 bg-gray-900/90 p-4 sm:p-5 space-y-4 shadow-xl animate-in fade-in">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                    <CameraIcon className="w-4 h-4 text-cyan-400 animate-pulse" />
                    <span>Escanear código QR con cámara</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Apunta la cámara al código QR de autenticación provisto por tu servicio.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {hasTorch && (
                    <button
                      type="button"
                      onClick={() => void toggleTorch()}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${torchOn
                          ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                          : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700'
                        }`}
                      title="Linterna"
                    >
                      {torchOn ? <ZapIcon className="w-3.5 h-3.5 text-amber-300" /> : <ZapOffIcon className="w-3.5 h-3.5" />}
                      <span>Linterna</span>
                    </button>
                  )}

                  {availableCameras.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const curIdx = availableCameras.findIndex((c) => c.id === selectedCameraId);
                        const next = availableCameras[(curIdx + 1) % availableCameras.length];
                        if (next) void switchCamera(next.id);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700 transition-colors"
                      title="Cambiar cámara"
                    >
                      <SwitchCameraIcon className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Cambiar cámara</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void stopCameraScanner()}
                    className="px-3 py-1.5 text-xs rounded-md bg-gray-700 hover:bg-gray-600 text-gray-200 border border-gray-600 transition-colors"
                  >
                    Cerrar cámara
                  </button>
                </div>
              </div>

              {/* Camera Scanner Viewport */}
              <div className="flex flex-col items-center justify-center pt-2">
                <div
                  id={QR_READER_ELEMENT_ID}
                  className="w-full max-w-[340px] rounded-lg overflow-hidden border border-gray-700 bg-black shadow-inner"
                />
              </div>
            </div>
          )}

          {/* Section: Add / Scan Actions (styled exactly like ImportExportModal action blocks) */}
          <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 sm:p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  Agregar cuenta MFA
                </p>
                <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                  QR · Google / Microsoft / Authy
                </span>
              </div>
              {mfaEntries.length > 0 && (
                <span className="text-xs font-semibold text-gray-400 px-2 py-0.5 rounded-md bg-gray-800/70 border border-gray-700/60">
                  {mfaEntries.length} {mfaEntries.length === 1 ? 'cuenta activa' : 'cuentas activas'}
                </span>
              )}
            </div>

            <p className="text-xs text-gray-400 -mt-1">
              Escanea el código QR desde la cámara de tu dispositivo o carga una captura de pantalla.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => void startCameraScanner()}
                className="group w-full text-left px-3 sm:px-4 py-2.5 sm:py-3 rounded-md bg-cyan-600 hover:bg-cyan-700 transition-colors font-semibold shadow-sm active:scale-[0.99]"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center min-w-0">
                    <span className="w-7 h-7 mr-3 inline-flex items-center justify-center rounded-md bg-cyan-500/20 text-cyan-100 border border-cyan-400/30 text-xs font-bold flex-shrink-0">
                      <CameraIcon className="w-4 h-4" />
                    </span>
                    <span className="truncate">Escanear con Cámara</span>
                  </span>
                  <span className="hidden sm:inline-flex items-center text-[11px] text-cyan-100/80 font-normal flex-shrink-0">
                    Cámara en vivo
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group w-full text-left px-3 sm:px-4 py-2.5 sm:py-3 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors font-semibold border border-gray-600 active:scale-[0.99]"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center min-w-0">
                    <span className="w-7 h-7 mr-3 inline-flex items-center justify-center rounded-md bg-gray-600/70 text-gray-200 border border-gray-500/40 text-xs font-bold flex-shrink-0">
                      <UploadIcon className="w-4 h-4 text-cyan-400" />
                    </span>
                    <span className="truncate">Cargar imagen QR</span>
                  </span>
                  <span className="hidden sm:inline-flex items-center text-[11px] text-gray-300/80 font-normal flex-shrink-0">
                    PNG / JPG
                  </span>
                </div>
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
          </div>

          {/* Section: Registered MFA Tokens List */}
          <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-3 sm:p-4 space-y-3 sm:space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
                  Cuentas Registradas
                </p>
                <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
                  RFC 6238 · TOTP
                </span>
              </div>

              {/* Search Bar */}
              {mfaEntries.length > 0 && (
                <div className="relative w-full sm:w-64">
                  <input
                    type="text"
                    placeholder="Buscar cuenta o emisor..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-gray-800 rounded-md border border-gray-700 text-xs text-white placeholder-gray-500 focus:border-cyan-500 outline-none"
                  />
                  <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                </div>
              )}
            </div>

            {/* List or Empty State */}
            {filteredEntries.length === 0 ? (
              <div className="p-6 sm:p-8 rounded-md border border-gray-700 bg-gray-800/40 text-gray-400 text-center space-y-3">
                <div className="w-10 h-10 mx-auto rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                  <ShieldCheckIcon className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-gray-200">
                    {mfaEntries.length === 0
                      ? 'No hay cuentas MFA registradas'
                      : 'No se encontraron coincidencias'}
                  </p>
                  <p className="text-xs text-gray-500 max-w-md mx-auto">
                    {mfaEntries.length === 0
                      ? 'Haz clic en "Escanear con Cámara" o "Cargar imagen QR" para comenzar a generar códigos de verificación de dos factores.'
                      : 'Intenta con otro término de búsqueda.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredEntries.map((entry) => {
                  const period = entry.period || 30;
                  const digits = entry.digits || 6;
                  const algorithm = entry.algorithm || 'SHA-1';
                  const remainingSec = getTotpRemainingSeconds(period);
                  const percentRemaining = (remainingSec / period) * 100;
                  const code = generateTotpSync(entry.secret, {
                    algorithm,
                    digits,
                    period,
                    time: currentTime
                  });
                  const isCopied = copiedId === entry.id;
                  const gradient = getIssuerGradient(entry.issuer);
                  const isNearExpire = remainingSec <= 5;

                  return (
                    <div
                      key={entry.id}
                      className="rounded-lg border border-gray-700 bg-gray-800/50 hover:bg-gray-800/80 p-3.5 transition-colors relative overflow-hidden flex flex-col justify-between"
                    >
                      {/* Top Time Remaining Progress Line */}
                      <div className="absolute top-0 left-0 right-0 h-1 bg-gray-700/60">
                        <div
                          className={`h-full transition-all duration-1000 ease-linear ${isNearExpire ? 'bg-red-500' : 'bg-cyan-500'
                            }`}
                          style={{ width: `${percentRemaining}%` }}
                        />
                      </div>

                      {/* Header of Item Card */}
                      <div className="flex items-start justify-between gap-2.5 mb-3 mt-0.5">
                        <div className="flex items-center space-x-3 min-w-0">
                          <div
                            className={`w-9 h-9 rounded-md bg-gradient-to-tr ${gradient} flex items-center justify-center text-white font-bold text-sm shadow-sm flex-shrink-0`}
                          >
                            {entry.issuer.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-cyan-400 truncate text-sm">
                              {entry.issuer}
                            </p>
                            <p className="text-xs text-gray-400 truncate">
                              {entry.account || 'Cuenta protegida'}
                            </p>
                          </div>
                        </div>

                        {/* Card Actions */}
                        <div className="flex items-center space-x-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => setViewingQrEntry(entry)}
                            className="p-1.5 text-gray-400 hover:text-cyan-400 hover:bg-gray-700/80 rounded-md transition-colors"
                            title="Ver código QR para exportar a otro teléfono"
                          >
                            <QrCodeIcon className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteMfaEntry(entry.id)}
                            className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                            title="Eliminar cuenta MFA"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Code Display & Copy Button */}
                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-700/60">
                        <button
                          type="button"
                          onClick={() => handleCopyCode(entry.id, code)}
                          className={`flex-1 flex items-center justify-between px-3 py-2 rounded-md border transition-colors cursor-pointer ${isCopied
                              ? 'border-green-500/60 bg-green-500/15 text-green-300'
                              : 'border-gray-700 bg-gray-900/70 hover:border-cyan-500/50 hover:bg-gray-900 text-white'
                            }`}
                          title="Hacer clic para copiar código"
                        >
                          <span className="font-mono text-xl sm:text-2xl font-bold tracking-widest text-cyan-300">
                            {formatTotpCode(code)}
                          </span>
                          {isCopied ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-400">
                              <CheckIcon className="w-3.5 h-3.5" />
                              <span>Copiado</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                              <CopyIcon className="w-3.5 h-3.5 text-cyan-400" />
                              <span className="hidden sm:inline">Copiar</span>
                            </span>
                          )}
                        </button>

                        {/* Circular/Square Countdown Badge */}
                        <div
                          className={`flex items-center justify-center w-8 h-8 rounded-md font-mono text-xs font-bold border flex-shrink-0 ${isNearExpire
                              ? 'border-red-500/50 text-red-400 bg-red-500/10'
                              : 'border-gray-700 text-gray-400 bg-gray-900/60'
                            }`}
                          title={`Quedan ${remainingSec}s`}
                        >
                          {remainingSec}s
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Export / Show QR View Modal (Overlay) */}
      {viewingQrEntry && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in"
          onClick={() => setViewingQrEntry(null)}
        >
          <div
            className="rounded-lg border border-gray-700 bg-gray-800 p-5 sm:p-6 max-w-sm w-full space-y-4 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-100">
                Código QR — {viewingQrEntry.issuer}
              </h4>
              <button
                onClick={() => setViewingQrEntry(null)}
                className="text-gray-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Escanea este código con Authenticator en otro dispositivo para duplicar tu cuenta.
            </p>
            <div className="bg-white p-3 rounded-lg inline-block shadow-md mx-auto">
              <QRCode
                value={buildOtpAuthUri({
                  issuer: viewingQrEntry.issuer,
                  account: viewingQrEntry.account,
                  secret: viewingQrEntry.secret,
                  algorithm: viewingQrEntry.algorithm,
                  digits: viewingQrEntry.digits,
                  period: viewingQrEntry.period
                })}
                size={180}
              />
            </div>
            <button
              onClick={() => setViewingQrEntry(null)}
              className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-semibold rounded-md transition-colors border border-gray-600"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Footer Controls */}
      <footer className="sticky bottom-0 z-20 flex-shrink-0 bg-gray-800/90 backdrop-blur-sm border-t border-gray-700/60 px-2.5 sm:px-5 py-2.5 sm:py-3">
        <div className="mx-auto w-full max-w-4xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <ClockIcon className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">
              Códigos de un solo uso basados en tiempo (TOTP) bajo estándar RFC 6238
            </span>
            <span className="sm:hidden">Estándar RFC 6238</span>
          </div>

          <button
            onClick={() => {
              if (isScanning) void stopCameraScanner();
              onClose();
            }}
            className="px-4 py-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors text-xs font-semibold text-gray-200 border border-gray-600"
          >
            Cerrar
          </button>
        </div>
      </footer>
    </div>
  );
};

export default MfaAuthenticatorModal;
