import {
  listLocalRows,
  softDeleteLocalRow,
  upsertLocalRow,
  type LocalTable
} from '../localDbClient';
import { uploadDocumentFile } from '../api';
import type {
  CaseRecord,
  Client,
  DocumentItem,
  Employee,
  Invitation,
  Lawyer,
  NotificationItem,
  Office,
  SessionItem
} from '../../types/app';

function today() {
  return new Date().toISOString().split('T')[0] ?? new Date().toISOString();
}

function event(table: LocalTable, action: 'created' | 'updated' | 'deleted') {
  return `${table}.${action}`;
}

function getCurrentFirmIdFallback() {
  return localStorage.getItem('legalmind.currentFirmId') ?? 'local-office';
}

function withLocalMeta<T extends Record<string, unknown>>(row: T) {
  const firmId = (row.firm_id as string | undefined) ?? getCurrentFirmIdFallback();
  return { ...row, firm_id: firmId };
}

export const localOfficeRepository = {
  async get(): Promise<Office> {
    const offices = await listLocalRows<Office & { firm_id?: string }>({ table: 'firms', includeDeleted: false });
    const office = offices[0];
    if (office) return office;
    return {
      id: getCurrentFirmIdFallback(),
      name: localStorage.getItem('legalmind.officeName') ?? 'مكتب محاماة محلي',
      licenseNo: '',
      plan: 'offline'
    };
  },

  async update(payload: Office): Promise<Office> {
    const row = await upsertLocalRow({
      table: 'firms',
      eventType: event('firms', 'updated'),
      row: withLocalMeta(payload as unknown as Record<string, unknown>)
    });
    localStorage.setItem('legalmind.currentFirmId', payload.id);
    localStorage.setItem('legalmind.officeName', payload.name);
    return row as unknown as Office;
  }
};

export const localClientRepository = {
  async list(): Promise<Client[]> {
    return listLocalRows<Client>({ table: 'clients', firmId: getCurrentFirmIdFallback() });
  },

  async create(payload: Omit<Client, 'id' | 'casesCount' | 'createdAt'>): Promise<Client> {
    const row = await upsertLocalRow({
      table: 'clients',
      eventType: event('clients', 'created'),
      row: withLocalMeta({ ...payload, casesCount: 0, createdAt: today() })
    });
    return row as unknown as Client;
  },

  async update(payload: Client): Promise<Client> {
    const row = await upsertLocalRow({
      table: 'clients',
      eventType: event('clients', 'updated'),
      row: withLocalMeta(payload as unknown as Record<string, unknown>)
    });
    return row as unknown as Client;
  },

  async softDelete(id: string): Promise<void> {
    await softDeleteLocalRow({ table: 'clients', id, firmId: getCurrentFirmIdFallback() });
  }
};

export const localCaseRepository = {
  async list(): Promise<CaseRecord[]> {
    const rows = await listLocalRows<CaseRecord>({ table: 'cases', firmId: getCurrentFirmIdFallback() });
    return rows.filter((row) => row.status !== 'archived' && row.status !== 'closed');
  },

  async listArchived(): Promise<CaseRecord[]> {
    const rows = await listLocalRows<CaseRecord>({ table: 'cases', firmId: getCurrentFirmIdFallback() });
    return rows.filter((row) => row.status === 'archived' || row.status === 'closed');
  },

  async create(payload: Omit<CaseRecord, 'id' | 'clientName' | 'dateStarted' | 'remaining_amount'>): Promise<CaseRecord> {
    const row = await upsertLocalRow({
      table: 'cases',
      eventType: event('cases', 'created'),
      row: withLocalMeta({
        ...payload,
        clientName: '',
        dateStarted: today(),
        remaining_amount: payload.total_amount - payload.paid_amount
      })
    });
    return row as unknown as CaseRecord;
  },

  async update(payload: CaseRecord): Promise<CaseRecord> {
    const row = await upsertLocalRow({
      table: 'cases',
      eventType: event('cases', 'updated'),
      row: withLocalMeta({ ...payload, remaining_amount: payload.total_amount - payload.paid_amount })
    });
    return row as unknown as CaseRecord;
  },

  async restore(id: string): Promise<CaseRecord> {
    const rows = await listLocalRows<CaseRecord>({ table: 'cases', includeDeleted: true });
    const found = rows.find((row) => row.id === id);
    if (!found) throw new Error('القضية غير موجودة محلياً.');
    return this.update({ ...found, status: 'active', archive_date: undefined });
  },

  async archive(id: string, notes?: string): Promise<CaseRecord> {
    const rows = await listLocalRows<CaseRecord>({ table: 'cases', firmId: getCurrentFirmIdFallback() });
    const found = rows.find((row) => row.id === id);
    if (!found) throw new Error('القضية غير موجودة محلياً.');
    return this.update({
      ...found,
      status: 'archived',
      archive_date: new Date().toISOString().split('T')[0],
      notes: notes?.trim() || found.notes
    });
  },

  async softDelete(id: string): Promise<{ id: string }> {
    await softDeleteLocalRow({ table: 'cases', id, firmId: getCurrentFirmIdFallback() });
    return { id };
  }
};

export const localSessionRepository = {
  async list(): Promise<SessionItem[]> {
    return listLocalRows<SessionItem>({ table: 'sessions', firmId: getCurrentFirmIdFallback() });
  },

  async create(payload: Omit<SessionItem, 'id' | 'caseTitle'>): Promise<SessionItem> {
    const row = await upsertLocalRow({
      table: 'sessions',
      eventType: event('sessions', 'created'),
      row: withLocalMeta({ ...payload, caseTitle: '' })
    });
    return row as unknown as SessionItem;
  },

  async update(payload: SessionItem): Promise<SessionItem> {
    const row = await upsertLocalRow({
      table: 'sessions',
      eventType: event('sessions', 'updated'),
      row: withLocalMeta(payload as unknown as Record<string, unknown>)
    });
    return row as unknown as SessionItem;
  },

  async softDelete(id: string): Promise<{ id: string }> {
    await softDeleteLocalRow({ table: 'sessions', id, firmId: getCurrentFirmIdFallback() });
    return { id };
  }
};

export const localDocumentRepository = {
  async list(): Promise<DocumentItem[]> {
    return listLocalRows<DocumentItem>({ table: 'documents', firmId: getCurrentFirmIdFallback() });
  },

  async upload(file: File, caseId: string): Promise<DocumentItem> {
    if (!('__TAURI_INTERNALS__' in window)) {
      return uploadDocumentFile(file, caseId);
    }
    const row = await upsertLocalRow({
      table: 'documents',
      eventType: event('documents', 'created'),
      row: withLocalMeta({
        title: file.name,
        caseId,
        caseTitle: '',
        category: 'مستند قانوني',
        size: `${Math.round(file.size / 1024)} KB`,
        dateUploaded: today(),
        url: ''
      })
    });
    return row as unknown as DocumentItem;
  }
};

export const localEmployeeRepository = {
  async list(): Promise<Employee[]> {
    return listLocalRows<Employee>({ table: 'employees', firmId: getCurrentFirmIdFallback() });
  },

  async create(payload: Omit<Employee, 'id' | 'created_at'>): Promise<Employee> {
    const row = await upsertLocalRow({
      table: 'employees',
      eventType: event('employees', 'created'),
      row: withLocalMeta({ ...payload, created_at: new Date().toISOString() })
    });
    return row as unknown as Employee;
  },

  async update(payload: Employee): Promise<Employee> {
    const row = await upsertLocalRow({
      table: 'employees',
      eventType: event('employees', 'updated'),
      row: withLocalMeta(payload as unknown as Record<string, unknown>)
    });
    return row as unknown as Employee;
  },

  async toggleStatus(id: string, status: Employee['status']): Promise<Employee> {
    const employees = await this.list();
    const employee = employees.find((item) => item.id === id);
    if (!employee) throw new Error('الموظف غير موجود محلياً.');
    return this.update({ ...employee, status });
  },

  async softDelete(id: string): Promise<{ id: string }> {
    await softDeleteLocalRow({ table: 'employees', id, firmId: getCurrentFirmIdFallback() });
    return { id };
  },

  async listInvitations(): Promise<Invitation[]> {
    return listLocalRows<Invitation>({ table: 'invitations', firmId: getCurrentFirmIdFallback() });
  },

  async invite(payload: { email: string; fullName: string; phone: string; role: 'admin' | 'lawyer' | 'assistant' }): Promise<Invitation> {
    const row = await upsertLocalRow({
      table: 'invitations',
      eventType: event('invitations', 'created'),
      row: withLocalMeta({
        email: payload.email,
        fullName: payload.fullName,
        phone: payload.phone,
        role: payload.role,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString()
      })
    });
    return row as unknown as Invitation;
  },

  async revokeInvitation(id: string): Promise<Invitation> {
    const invitations = await this.listInvitations();
    const invitation = invitations.find((item) => item.id === id);
    if (!invitation) throw new Error('الدعوة غير موجودة محلياً.');
    const row = await upsertLocalRow({
      table: 'invitations',
      eventType: event('invitations', 'updated'),
      row: withLocalMeta({ ...invitation, status: 'revoked' })
    });
    return row as unknown as Invitation;
  }
};

export const localPeopleRepository = {
  async listLawyers(): Promise<Lawyer[]> {
    return listLocalRows<Lawyer>({ table: 'lawyers', firmId: getCurrentFirmIdFallback() });
  }
};

export const localNotificationRepository = {
  async list(): Promise<NotificationItem[]> {
    return listLocalRows<NotificationItem>({ table: 'notifications', firmId: getCurrentFirmIdFallback() });
  },

  async create(payload: Omit<NotificationItem, 'id' | 'read' | 'time'>): Promise<NotificationItem> {
    const row = await upsertLocalRow({
      table: 'notifications',
      eventType: event('notifications', 'created'),
      row: withLocalMeta({ ...payload, read: false, time: 'الآن' })
    });
    return row as unknown as NotificationItem;
  },

  async markRead(id: string): Promise<NotificationItem> {
    const notifications = await this.list();
    const notification = notifications.find((item) => item.id === id);
    if (!notification) throw new Error('التنبيه غير موجود محلياً.');
    const row = await upsertLocalRow({
      table: 'notifications',
      eventType: event('notifications', 'updated'),
      row: withLocalMeta({ ...notification, read: true })
    });
    return row as unknown as NotificationItem;
  },

  async markAllRead(): Promise<void> {
    const notifications = await this.list();
    await Promise.all(notifications.filter((item) => !item.read).map((item) => this.markRead(item.id)));
  }
};
