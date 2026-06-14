export type CustomerType = 'فرد' | 'شركة تجارية';

export interface Client {
  id: string;
  name: string;
  phone: string;
  email: string;
  type: CustomerType;
  address: string;
  casesCount: number;
  createdAt: string;
}

export interface CaseRecord {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  category: string;
  status: string;
  court: string;
  caseNo: string;
  lawyerId?: string | null;
  dateStarted: string;
  description?: string;
}
