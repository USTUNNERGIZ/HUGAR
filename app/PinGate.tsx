"use client";

import { useState } from 'react';

const PREFIX = 'hugar-device-pin-v1:';
const encoder = new TextEncoder();
const valid = (v: string) => /^\d{4}$/.test(v);
const bytesToHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const hexToBytes = (s: string) => new Uint8Array((s.match(/.{2}/g) || []).map(x => parseInt(x, 16)));
const keyName = (userId: string) => PREFIX + userId;

export function hasPin(userId: string): boolean {
  try { return typeof window !== 'undefined' && !!localStorage.getItem(keyName(userId)); }
  catch { return false; }
}

async function digest(pin: string, salt: Uint8Array): Promise<string> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 310000, hash: 'SHA-256' }, base, 256);
  return bytesToHex(new Uint8Array(bits));
}

type Stored = { salt: string; hash: string; fails: number; blockedUntil: number };
function read(userId: string): Stored | null {
  try {
    const raw = localStorage.getItem(keyName(userId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored;
    if (!/^[0-9a-f]{32}$/.test(v.salt) || !/^[0-9a-f]{64}$/.test(v.hash)) return null;
    return v;
  } catch { return null; }
}
function write(userId: string, data: Stored) { localStorage.setItem(keyName(userId), JSON.stringify(data)); }

export default function PinGate({ mode, userId, onDone, onCancel }: {
  mode: 'setup' | 'unlock'; userId: string; onDone: () => void; onCancel: () => void;
}) {
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [oldPin, setOldPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const existing = hasPin(userId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (mode === 'setup') {
        if (!valid(pin) || pin !== again) { setError('PIN 4 rakam olmalı ve iki giriş eşleşmeli.'); return; }
        if (existing) {
          const prev = read(userId);
          if (!prev) { setError('Mevcut PIN okunamadı.'); return; }
          if (Date.now() < prev.blockedUntil) { setError('Çok fazla deneme. Biraz sonra tekrar dene.'); return; }
          if (!valid(oldPin) || (await digest(oldPin, hexToBytes(prev.salt))) !== prev.hash) {
            const fails = (prev.fails || 0) + 1;
            write(userId, { ...prev, fails, blockedUntil: fails >= 5 ? Date.now() + 5 * 60_000 : 0 });
            setError('Eski PIN yanlış.'); return;
          }
        }
        const salt = crypto.getRandomValues(new Uint8Array(16));
        write(userId, { salt: bytesToHex(salt), hash: await digest(pin, salt), fails: 0, blockedUntil: 0 });
        window.alert('PIN kaydedildi. Sol menüde Ekranı Kilitle seçeneğini kullanabilirsin.');
        onDone();
      } else {
        const record = read(userId);
        if (!record) { setError('Bu cihazda PIN bulunamadı. Şifreyle giriş yap.'); return; }
        if (Date.now() < record.blockedUntil) { setError('5 dakika bekle veya şifreyle giriş yap.'); return; }
        if (!valid(pin) || (await digest(pin, hexToBytes(record.salt))) !== record.hash) {
          const fails = (record.fails || 0) + 1;
          write(userId, { ...record, fails, blockedUntil: fails >= 5 ? Date.now() + 5 * 60_000 : 0 });
          setError('PIN yanlış.'); return;
        }
        write(userId, { ...record, fails: 0, blockedUntil: 0 });
        onDone();
      }
    } catch { setError('PIN işlemi tamamlanamadı. Tarayıcı depolama ayarlarını kontrol et.'); }
    finally { setBusy(false); setPin(''); setAgain(''); setOldPin(''); }
  }

  return <main className="center" style={{ minHeight: mode === 'unlock' ? '100vh' : undefined }}>
    <section className="login" style={{ maxWidth: 440, width: '100%' }}>
      <div className="mark">₺</div>
      <h2>{mode === 'unlock' ? 'KAPLAN FİNANS · Ekran Kilidi' : existing ? 'PIN Değiştir' : '4 Haneli PIN Belirle'}</h2>
      <p>{mode === 'unlock' ? 'Aynı cihazdaki açık oturumu görüntülemek için PIN gir.' : 'Bu PIN yalnızca bu tarayıcıdaki ekran kilidi içindir.'}</p>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        {mode === 'setup' && existing && <label>Mevcut PIN<input required type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={oldPin} onChange={e => setOldPin(e.target.value.replace(/\D/g, '').slice(0, 4))}/></label>}
        <label>{mode === 'unlock' ? 'PIN' : 'Yeni PIN'}<input required type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}/></label>
        {mode === 'setup' && <label>Yeni PIN tekrar<input required type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={again} onChange={e => setAgain(e.target.value.replace(/\D/g, '').slice(0, 4))}/></label>}
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={busy}>{busy ? 'Kontrol ediliyor…' : mode === 'unlock' ? 'Kilidi Aç' : 'PIN Kaydet'}</button>
        <button type="button" onClick={onCancel}>{mode === 'unlock' ? 'Çıkış Yap · Şifreyle Giriş' : 'İptal'}</button>
      </form>
      <small>PIN ekran kilididir; cihazın güvenliğinin veya hesap şifresinin yerine geçmez.</small>
    </section>
  </main>;
}
