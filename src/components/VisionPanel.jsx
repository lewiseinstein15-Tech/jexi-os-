import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera } from 'lucide-react';

/**
 * VisionPanel — camera capture for JEXI's eyes.
 * Opens the device camera, captures a frame, and sends it to the backend for analysis.
 */
export default function VisionPanel({ open, onClose, onVision }) {
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const handleCapture = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCapturing(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result;
      if (onVision) onVision(base64);
      setCapturing(false);
      onClose();
    };
    reader.onerror = () => {
      setError('Failed to read image');
      setCapturing(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-[#111] border border-[#333] rounded-xl p-6 max-w-sm w-full"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">JEXI EYES</h3>
              <button onClick={onClose} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-4">
              Capture an image for JEXI to analyze.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleCapture}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={capturing}
              className="w-full flex items-center justify-center gap-2 bg-white text-black rounded-lg py-3 text-sm font-bold hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              <Camera className="w-4 h-4" />
              {capturing ? 'Capturing…' : 'Open Camera'}
            </button>
            {error && (
              <p className="text-xs text-red-400 mt-2">{error}</p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
