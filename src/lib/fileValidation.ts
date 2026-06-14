import type { DocumentType } from '../types/app';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const MIME_TO_TYPE: Record<string, DocumentType> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.jpg', '.jpeg', '.png', '.webp'];

export interface FileValidationResult {
  valid: boolean;
  error?: string;
  documentType?: DocumentType;
}

export function validateFile(file: File): FileValidationResult {
  if (file.size === 0) {
    return { valid: false, error: 'الملف فارغ.' };
  }

  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `حجم الملف يتجاوز الحد الأقصى (${MAX_FILE_SIZE / 1048576} ميجابايت).` };
  }

  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: 'نوع الملف غير مدعوم. الأنواع المسموحة: PDF, DOCX, XLSX, JPG, PNG, WEBP.' };
  }

  const docType = MIME_TO_TYPE[file.type];
  if (!docType) {
    return { valid: false, error: 'نوع MIME للملف غير مسموح.' };
  }

  const dangerousPatterns = [/\.exe$/i, /\.bat$/i, /\.cmd$/i, /\.sh$/i, /\.php$/i, /\.html$/i, /\.js$/i];
  if (dangerousPatterns.some((p) => p.test(file.name))) {
    return { valid: false, error: 'نوع الملف محظور لأسباب أمنية.' };
  }

  return { valid: true, documentType: docType };
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\u0600-\u06FF._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 200);
}

export { MAX_FILE_SIZE, MIME_TO_TYPE };
