
'use client';

import { useState } from 'react';
import { validPin } from '../lib/pin-utils';

type PinScreenProps = {
  onUnlock: (pin: string) => Promise<boolean>;
  onLogout: () => void;
};

export default function PinScreen({
  onUnlock,
  onLogout
}: PinScreenProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (!validPin(pin)) {
      setError('PIN tam olarak 4 rakam olmalıdır.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const success = await onUnlock(pin);
      if (!success) {
        setError('PIN doğrulanamadı.');
        setPin('');
      }
    } catch {
      setError('PIN kontrolü sırasında hata oluştu.');
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center">
      <form className="login" onSubmit={submit}>
        <div className="mark">₺</div>
        <h1>HUGAR Finans Merkezi</h1>
        <p>Devam etmek için 4 haneli PIN girin.</p>

        <label>
          Güvenlik PIN'i
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            required
            value={pin}
            onChange={e =>
              setPin(e.target.value.replace(/\D/g, '').slice(0, 4))
            }
            placeholder="••••"
          />
        </label>

        {error && <div className="error">{error}</div>}

        <button type="submit" disabled={busy}>
          {busy ? 'Kontrol ediliyor…' : 'Kilidi Aç'}
        </button>

        <button type="button" onClick={onLogout}>
          Çıkış yap
        </button>
      </form>
    </main>
  );
}
