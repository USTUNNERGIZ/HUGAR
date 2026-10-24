
export function validPin(pin: string): boolean {
  return /^[0-9]{4}$/.test(pin);
}

export function pinErrorMessage(pin: string): string {
  if (!validPin(pin)) {
    return 'PIN tam olarak 4 rakamdan oluşmalıdır.';
  }

  return '';
}
