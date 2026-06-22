import type { CaseRecord, Client, Employee, PageId, SessionItem } from '../types/app';

export const PUBLIC_PAGES: PageId[] = [
  'landing',
  'login',
  'register',
  'register-office',
  'register-lawyer',
  'invite',
  'forgot',
  'accept-invite'
];

export const initialClientForm: Omit<Client, 'id' | 'casesCount' | 'createdAt'> = {
  name: '', phone: '', email: '', address: '', type: 'فرد'
};

export const initialCaseForm: Omit<CaseRecord, 'id' | 'clientName' | 'dateStarted'> = {
  title: '', clientId: '', category: 'تجاري', case_type: 'تجارية', case_stage: 'استئناف',
  court_case_number: '', total_amount: 0, paid_amount: 0, remaining_amount: 0,
  status: 'active', court: '', caseNo: '', lawyerId: '', description: '', notes: ''
};

export const initialSessionForm: Omit<SessionItem, 'id' | 'caseTitle'> = {
  caseId: '', court: '', date: '', time: '', status: 'مجدولة', type: '', notes: '',
  judgeName: '', nextSessionDate: '', sessionOutcome: ''
};

export const initialEmployeeForm: Omit<Employee, 'id' | 'created_at'> = {
  full_name: '', email: '', phone: '', role: 'lawyer', firm_role_id: '', status: 'active'
};
