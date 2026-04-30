'use client';

import { useState, useRef, useEffect } from 'react';
import { whatsappUrl, copyToClipboard } from '@/lib/share';

interface ShareMenuProps {
  message: string;
  /** Visual style: "icon" for small icon-only button, "button" for labeled button */
  variant?: 'icon' | 'button';
  /** Optional aria-label / tooltip override */
  label?: string;
}

export default function ShareMenu({ message, variant = 'icon', label = 'Share' }: ShareMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const handleWhatsApp = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(whatsappUrl(message), '_blank', 'noopener,noreferrer');
    setOpen(false);
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyToClipboard(message);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
    setTimeout(() => setOpen(false), 600);
  };

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((v) => !v);
  };

  return (
    <div ref={ref} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      {variant === 'icon' ? (
        <button
          onClick={toggle}
          aria-label={label}
          title={label}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-900/60 text-slate-300 hover:bg-slate-700 hover:text-white transition text-sm leading-none"
        >
          📲
        </button>
      ) : (
        <button
          onClick={toggle}
          className="px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-md transition flex items-center gap-1.5"
        >
          📲 {label}
        </button>
      )}
      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-50 py-1 text-sm">
          <button
            onClick={handleWhatsApp}
            className="w-full text-left px-3 py-2 hover:bg-slate-700 text-slate-100 flex items-center gap-2"
          >
            <span>💬</span>
            <span>Share to WhatsApp</span>
          </button>
          <button
            onClick={handleCopy}
            className="w-full text-left px-3 py-2 hover:bg-slate-700 text-slate-100 flex items-center gap-2"
          >
            <span>📋</span>
            <span>{copied ? 'Copied!' : 'Copy text'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
