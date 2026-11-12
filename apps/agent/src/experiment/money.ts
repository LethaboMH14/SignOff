/** Formats minor units (cents) as a plain decimal string with two places, for the synthetic buyer records. */
export function formatMinor(minor: number): string {
  if (!Number.isInteger(minor)) {
    throw new RangeError('an amount must be a whole number of minor units');
  }
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  return `${sign}${String(whole)}.${cents}`;
}
