
'use client';

import { useState } from 'react';
import { validPin } from '../lib/pin-utils';

type Props = {
  onSave: (pin: string) => Promise<boolean>;
  onCancel: () => void;
};

export default function PinSetup({ onSave, onCancel }: Props) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!validPin(pin)) {
      setError('PIN tam olarak 4 rakam olmalıdır.');
      return;
    }

    if (pin !== confirm) {
      setError('PIN kodları eşleşmiyor.');
      return;
    }

    setBusy(true);

    try {
      const saved = await onSave(pin);
      if (!saved) setError('PIN kaydedilemedi.');
    } catch {
      setError('Bir hata oluştu.');
    } finally {
      setBusy(false);
      setPin('');
      setConfirm('');
    }
  }

  return (
    <section className="panel" style={{ maxWidth: 480 }}>
      <h2>4 Haneli PIN Belirle</h2>
      <p>Aynı cihazda ekran kilidini açmak için kullanılacak.</p>

      <form onSubmit={submit}
        style={{ display: 'grid', gap: 14, marginTop: 18 }}>
        <label>
          Yeni PIN
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            required
            value={pin}
            onChange={e =>
              setPin(e.target.value.replace(/\D/g, '').slice(0, 4))
            }
          />
        </label>

        <label>
          PIN tekrar
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            autoComplete="off"
            required
            value={confirm}
            onChange={e =>
              setConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))
            }
          />
        </label>

        {error && <div className="error">{error}</div>}

        <button type="submit" disabled={busy}>
          {busy ? 'Kaydediliyor…' : 'PIN Belirle'}
        </button>

        <button type="button" onClick={onCancel}>
          İptal
        </button>
      </form>
    </section>
  );
}
