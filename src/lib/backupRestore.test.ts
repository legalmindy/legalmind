import { describe, expect, it } from 'vitest';
import { normalizePaymentMethod } from './backupRestore';

describe('backupRestore', () => {
  describe('normalizePaymentMethod', () => {
    it('returns valid payment methods as-is', () => {
      expect(normalizePaymentMethod('نقداً')).toBe('نقداً');
      expect(normalizePaymentMethod('تحويل بنكي')).toBe('تحويل بنكي');
      expect(normalizePaymentMethod('شيك')).toBe('شيك');
    });

    it('defaults unknown values to نقداً', () => {
      expect(normalizePaymentMethod('')).toBe('نقداً');
      expect(normalizePaymentMethod(null)).toBe('نقداً');
      expect(normalizePaymentMethod('invalid')).toBe('نقداً');
    });
  });
});
