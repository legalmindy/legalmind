import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { BACKUP_MANIFEST_VERSION } from './backupTypes';
import { computeBackupChecksum } from './backupValidation';

describe('backupValidation', () => {
  it('computes stable sha256 checksum for manifest v3 zip', async () => {
    const zip = new JSZip();
    const firmId = '11111111-1111-4111-8111-111111111111';

    zip.file('settings/office.json', JSON.stringify({ name: 'QA' }));
    zip.file(
      'data/raw/clients.json',
      JSON.stringify([{ id: '22222222-2222-4222-8222-222222222222', firm_id: firmId, name: 'عميل' }])
    );

    const checksum = await computeBackupChecksum(zip, ['clients']);
    expect(checksum).toHaveLength(64);
    expect(checksum).toMatch(/^[a-f0-9]{64}$/);

    const manifest = {
      version: BACKUP_MANIFEST_VERSION,
      firm_id: firmId,
      checksum
    };
    zip.file('manifest.json', JSON.stringify(manifest));
    const blob = await zip.generateAsync({ type: 'blob' });
    expect(blob.size).toBeGreaterThan(100);
  });
});
