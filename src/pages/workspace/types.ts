import type { CaseRecord, Client, DocumentItem, Lawyer, Office, PageId, SessionItem, User, UserRole } from '../../types/app';
import type { ProfileUpdateInput } from '../../lib/profileImage';
import type { DashboardFinancials, DashboardPerformance, DashboardStatHints } from '../../lib/dashboardAnalytics';

export interface DashboardPageProps {
  user: User;
  permissions?: Record<string, boolean>;
  role?: string;
  sessions: SessionItem[];
  documents: DocumentItem[];
  activeChartTab: 'cases' | 'revenue';
  hoveredDataPoint: { month: string; cases: number; resolved: number; revenue: number } | null;
  setActiveChartTab: (tab: 'cases' | 'revenue') => void;
  setHoveredDataPoint: (data: { month: string; cases: number; resolved: number; revenue: number } | null) => void;
  stats: {
    totalClients: number;
    totalCases: number;
    activeCases: number;
    upcomingSessions: number;
    totalDocuments: number;
    lawyersCount: number;
  };
  monthlyData: { month: string; cases: number; resolved: number; revenue: number }[];
  performance: DashboardPerformance;
  financials: DashboardFinancials;
  statHints: DashboardStatHints;
  setCurrentPage: (page: PageId) => void;
  setShowClientModal: (value: boolean) => void;
  setShowCaseModal: (value: boolean) => void;
  setShowSessionModal: (value: boolean) => void;
  office?: Office;
  remindersEnabled?: boolean;
  onFirmCodeCopied?: (message: string) => void;
}

export interface ClientsPageProps {
  clients: Client[];
  searchQuery: string;
  onSearch: (value: string) => void;
  onCreateClient: () => void;
  onEditClient: (client: Client) => void;
  onDeleteClient: (id: string) => void;
  onSendReport?: (client: Client) => void;
  canSendReport?: boolean;
}

export interface CasesPageProps {
  cases: CaseRecord[];
  searchQuery: string;
  statusFilter: string;
  categoryFilter: string;
  onSearch: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onCategoryFilterChange: (value: string) => void;
  onCreateCase: () => void;
  onEditCase: (caseRecord: CaseRecord) => void;
  onViewCase: (caseRecord: CaseRecord) => void;
  onArchiveCase: (caseRecord: CaseRecord) => void;
  onDeleteCase: (id: string) => void;
  onSendPaymentReminder?: (caseRecord: CaseRecord) => void;
  canSendPaymentReminder?: boolean;
  canViewCase360?: boolean;
}

export interface SessionsPageProps {
  sessions: SessionItem[];
  onCreateSession: () => void;
  onEditSession: (session: SessionItem) => void;
  onDeleteSession: (id: string) => void;
}

export interface DocumentsPageProps {
  documents: DocumentItem[];
  onCreateDocument: () => void;
  onGetUrl?: (docId: string) => Promise<string>;
}

export interface LawyersPageProps {
  lawyers: Lawyer[];
}

export interface ReportsPageProps {
  role: UserRole;
  permissions?: Record<string, boolean>;
  performance: DashboardPerformance;
  financials: DashboardFinancials;
  cases: CaseRecord[];
  year?: number;
}

export interface ProfilePageProps {
  user: User;
  onSave: (input: ProfileUpdateInput) => Promise<void>;
  onUploadAvatar: (file: File) => Promise<string>;
}

export interface SettingsPageProps {
  user: User;
  office?: Office;
  onSaveOffice: (office: Office) => void;
  onFirmCodeCopied?: (message: string) => void;
  onOpenAuditLogs?: () => void;
}
