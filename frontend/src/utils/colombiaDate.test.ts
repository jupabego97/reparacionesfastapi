import { describe, expect, it } from 'vitest';
import { colombiaDateKey, formatDateKey, shiftDateKey } from './colombiaDate';

describe('colombiaDate', () => {
  it('shifts ISO date keys without timezone drift', () => {
    expect(shiftDateKey('2026-08-12', -1)).toBe('2026-08-11');
    expect(shiftDateKey('2026-08-01', -1)).toBe('2026-07-31');
  });

  it('formats a date key in Spanish', () => {
    expect(formatDateKey('2026-08-12')).toMatch(/12/);
    expect(formatDateKey('2026-08-12')).toMatch(/ago/i);
  });

  it('returns a YYYY-MM-DD key', () => {
    expect(colombiaDateKey(new Date('2026-08-12T18:00:00-05:00'))).toBe('2026-08-12');
    expect(colombiaDateKey(new Date('2026-08-13T03:30:00Z'))).toBe('2026-08-12');
  });
});
