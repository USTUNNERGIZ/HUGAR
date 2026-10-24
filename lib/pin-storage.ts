
const PIN_KEY = 'hugar_pin_enabled';

export function isPinEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(PIN_KEY) === '1';
}

export function setPinEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;

  if (enabled) {
    sessionStorage.setItem(PIN_KEY, '1');
  } else {
    sessionStorage.removeItem(PIN_KEY);
  }
}
