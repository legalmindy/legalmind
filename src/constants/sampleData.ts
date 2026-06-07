import type {
  CaseRecord,
  ChartPoint,
  Client,
  DocumentItem,
  Employee,
  Lawyer,
  NotificationType,
  SubscriptionPlan,
  SessionItem
} from '../types/app';

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'free',
    name: 'الباقة التجريبية',
    price: '0',
    period: 'شهرياً',
    features: ['إدارة حتى 5 قضايا', 'إدارة حتى 10 عملاء', 'مساحة تخزين 1 جيجابايت', 'دعم فني عبر البريد'],
    color: 'border-slate-300'
  },
  {
    id: 'pro',
    name: 'باقة المحامي المحترف',
    price: '45,000',
    period: 'شهرياً',
    features: ['عدد قضايا غير محدود', 'عدد عملاء غير محدود', 'مساحة تخزين 20 جيجابايت', 'مزامنة مع التقويم والرسائل القصيرة', 'دعم فني وتحديثات مستمرة', 'صياغة ذكية للعرائض'],
    color: 'border-amber-500 shadow-md ring-2 ring-amber-500/20',
    badge: 'الأكثر طلباً في اليمن'
  },
  {
    id: 'firm',
    name: 'باقة الشركات والمكاتب والشركاء',
    price: '120,000',
    period: 'شهرياً',
    features: ['كل ميزات الباقة المحترفة', 'إدارة حتى 10 محامين بالشركة', 'مساحة تخزين 100 جيجابايت', 'صلاحيات مخصصة وتوزيع مهام تلقائي', 'تقارير الأداء المالي والعملي المتقدمة', 'خط ساخن مخصص للدعم الفني'],
    color: 'border-indigo-800'
  }
];

export const INITIAL_CLIENTS: Client[] = [
  {
    id: '1',
    name: 'مجموعة هائل سعيد أنعم وشركاه',
    phone: '771234567',
    email: 'hsagroup@example.com',
    address: 'صنعاء - شارع الزبيري',
    type: 'شركة تجارية',
    casesCount: 2,
    createdAt: '2026-01-10'
  },
  {
    id: '2',
    name: 'علي عبد الله العبسي',
    phone: '733987654',
    email: 'ali.absi@example.com',
    address: 'عدن - المعلا',
    type: 'فرد',
    casesCount: 1,
    createdAt: '2026-02-14'
  },
  {
    id: '3',
    name: 'مؤسسة يمن سوفت للبرمجيات',
    phone: '711456789',
    email: 'yemensoft@example.com',
    address: 'تعز - شارع جمال',
    type: 'شركة تجارية',
    casesCount: 1,
    createdAt: '2026-03-01'
  },
  {
    id: '4',
    name: 'أروى محمد حميد',
    phone: '775221100',
    email: 'arwa.h@example.com',
    address: 'إب - الدائري الغربي',
    type: 'فرد',
    casesCount: 1,
    createdAt: '2026-04-18'
  }
];

export const INITIAL_CASES: CaseRecord[] = [
  {
    id: '1',
    title: 'نزاع تجاري حول علامة تجارية ومنافسة غير مشروعة',
    clientId: '1',
    clientName: 'مجموعة هائل سعيد أنعم وشركاه',
    category: 'تجاري',
    case_type: 'تجارية',
    case_stage: 'استئناف',
    total_amount: 450000.0,
    paid_amount: 210000.0,
    remaining_amount: 240000.0,
    status: 'active',
    judgment_date: undefined,
    archive_date: undefined,
    closed_by: undefined,
    notes: 'قضية علامة تجارية مع إثبات تقليد وتزوير.',
    court: 'محكمة استئناف الأمانة - الشعبة التجارية الثالثة',
    court_case_number: '١٤٥/ب/٢٠٢٦',
    caseNo: '١٤٥/ب/٢٠٢٦',
    lawyerId: '1',
    dateStarted: '2026-01-15',
    description: 'نزاع بخصوص تقليد وتزوير العلامة التجارية المسجلة للمجموعة في قطاع السلع الغذائية.'
  },
  {
    id: '2',
    title: 'دعوى فسخ عقد إيجار وتأخر سداد مستحقات',
    clientId: '2',
    clientName: 'علي عبد الله العبسي',
    category: 'مدني',
    case_type: 'مدنية',
    case_stage: 'ابتدائي مدني',
    total_amount: 180000.0,
    paid_amount: 80000.0,
    remaining_amount: 100000.0,
    status: 'active',
    judgment_date: undefined,
    archive_date: undefined,
    closed_by: undefined,
    notes: 'مستحقات إيجارية ومطالبات فسخ العقد بسبب تأخر السداد.',
    court: 'محكمة غرب الأمانة الابتدائية',
    court_case_number: '٣٤٢/م/٢٠٢٦',
    caseNo: '٣٤٢/م/٢٠٢٦',
    lawyerId: '2',
    dateStarted: '2026-02-20',
    description: 'المطالبة بإخلاء العين المؤجرة وسداد الأقساط المتأخرة لمدة سنة كاملة.'
  },
  {
    id: '3',
    title: 'نزاع ملكية أرض وعقار في منطقة الحوبان',
    clientId: '3',
    clientName: 'مؤسسة يمن سوفت للبرمجيات',
    category: 'عقاري',
    case_type: 'مدنية',
    case_stage: 'ابتدائي مدني',
    total_amount: 320000.0,
    paid_amount: 120000.0,
    remaining_amount: 200000.0,
    status: 'active',
    judgment_date: undefined,
    archive_date: undefined,
    closed_by: undefined,
    notes: 'نزاع على ملكية الأرض ونقص المستندات الفنية.',
    court: 'محكمة تعز الابتدائية',
    court_case_number: '٧٦/ع/٢٠٢٦',
    caseNo: '٧٦/ع/٢٠٢٦',
    lawyerId: '1',
    dateStarted: '2026-03-10',
    description: 'ادعاء ملكية جزء من الأرض المخصصة لإنشاء مبنى الإدارة الإقليمية الجديد للمؤسسة.'
  },
  {
    id: '4',
    title: 'استئناف حكم تعويض عن إنهاء عقد عمل تعسفي',
    clientId: '4',
    clientName: 'أروى محمد حميد',
    category: 'عمالي',
    case_type: 'عمالية',
    case_stage: 'استئناف',
    total_amount: 120000.0,
    paid_amount: 120000.0,
    remaining_amount: 0.0,
    status: 'closed',
    judgment_date: '2026-05-05',
    archive_date: undefined,
    closed_by: '3',
    notes: 'قضية مغلقة بعد التعويض الكامل للمدعي.',
    court: 'المحكمة العمالية بصنعاء',
    court_case_number: '١٢/ع م/٢٠٢٦',
    caseNo: '١٢/ع م/٢٠٢٦',
    lawyerId: '3',
    dateStarted: '2026-04-22',
    description: 'طلب التعويض عن الفصل التعسفي والرواتب المتأخرة والبدلات المتبقية من العمل.'
  }
];

export const INITIAL_SESSIONS: SessionItem[] = [
  {
    id: '1',
    caseId: '1',
    caseTitle: 'نزاع تجاري حول علامة تجارية ومنافسة غير مشروعة',
    court: 'محكمة استئناف الأمانة - الشعبة التجارية الثالثة',
    date: '2026-06-15',
    time: '09:00',
    status: 'مجدولة',
    type: 'تقديم دفوع ومستندات',
    notes: 'يجب إحضار أصل شهادة التسجيل الصادرة من وزارة الصناعة والتجارة اليمنية.'
  },
  {
    id: '2',
    caseId: '2',
    caseTitle: 'دعوى فسخ عقد إيجار وتأخر سداد مستحقات',
    court: 'محكمة غرب الأمانة الابتدائية',
    date: '2026-06-18',
    time: '10:30',
    status: 'مجدولة',
    type: 'سماع الشهود',
    notes: 'حضور شهود الإثبات وتجهيز اليمين الحاسمة.'
  },
  {
    id: '3',
    caseId: '3',
    caseTitle: 'نزاع ملكية أرض وعقار في منطقة الحوبان',
    court: 'محكمة تعز الابتدائية',
    date: '2026-06-22',
    time: '08:30',
    status: 'منتهية',
    type: 'ندب خبير ومعاينة',
    notes: 'تم تكليف المهندس المساحي بالمعاينة الميدانية وإرفاق التقرير.'
  }
];

export const INITIAL_DOCUMENTS: DocumentItem[] = [
  {
    id: '1',
    title: 'عريضة استئناف حكم العلامة التجارية.pdf',
    caseId: '1',
    caseTitle: 'نزاع تجاري حول علامة تجارية ومنافسة غير مشروعة',
    category: 'عريضة دعوى',
    size: '1.8 MB',
    dateUploaded: '2026-05-20',
    url: '#'
  },
  {
    id: '2',
    title: 'عقد الإيجار الأصلي الموثق سند ملكية.docx',
    caseId: '2',
    caseTitle: 'دعوى فسخ عقد إيجار وتأخر سداد مستحقات',
    category: 'أدلة إثبات',
    size: '512 KB',
    dateUploaded: '2026-05-22',
    url: '#'
  },
  {
    id: '3',
    title: 'تقرير الخبير الهندسي المساحي المعتمد.pdf',
    caseId: '3',
    caseTitle: 'نزاع ملكية أرض وعقار في منطقة الحوبان',
    category: 'تقارير فنية',
    size: '4.2 MB',
    dateUploaded: '2026-05-25',
    url: '#'
  }
];

export const INITIAL_LAWYERS: Lawyer[] = [
  {
    id: '1',
    name: 'أ. د. نجيب عبد الله الشراعي',
    role: 'محامٍ شريك - مدير مكتب',
    email: 'n.sharaee@legalmind.ye',
    phone: '770000001',
    specialization: 'قضايا تجارية ومالية'
  },
  {
    id: '2',
    name: 'أ. هلال يحيى السنيدار',
    role: 'محامٍ أول',
    email: 'h.sunaidar@legalmind.ye',
    phone: '770000002',
    specialization: 'قضايا مدنية وعقارية'
  },
  {
    id: '3',
    name: 'أ. ماجد فؤاد ردمان',
    role: 'مستشار قانوني ورئيس قسم العقود',
    email: 'm.radman@legalmind.ye',
    phone: '770000003',
    specialization: 'صياغة العقود والتحكيم الدولي'
  },
  {
    id: '4',
    name: 'أ. سارة أمين الخولاني',
    role: 'محامية متدربة',
    email: 's.kholani@legalmind.ye',
    phone: '770000004',
    specialization: 'الأحوال الشخصية والقضايا العمالية'
  }
];

export const INITIAL_EMPLOYEES: Employee[] = [
  {
    id: 'e1',
    full_name: 'أ. د. نجيب الشراعي',
    email: 'n.sharaee@legalmind.ye',
    phone: '770000001',
    role: 'super_admin',
    status: 'active',
    profile_image: '',
    created_at: '2026-01-01T08:00:00Z'
  },
  {
    id: 'e2',
    full_name: 'أ. هلال السنيدار',
    email: 'h.sunaidar@legalmind.ye',
    phone: '770000002',
    role: 'lawyer',
    status: 'active',
    profile_image: '',
    created_at: '2026-02-10T09:00:00Z'
  },
  {
    id: 'e3',
    full_name: 'أ. سارة الخولاني',
    email: 's.kholani@legalmind.ye',
    phone: '770000004',
    role: 'assistant',
    status: 'active',
    profile_image: '',
    created_at: '2026-03-15T10:00:00Z'
  }
];

export const INITIAL_NOTIFICATIONS = [
  {
    id: '1',
    title: 'جلسة قادمة غداً',
    message: 'تذكير: لديك جلسة غداً في قضية "نزاع تجاري حول علامة تجارية" في محكمة استئناف الأمانة.',
    time: 'منذ ساعتين',
    read: false,
    type: 'session' as NotificationType
  },
  {
    id: '2',
    title: 'إضافة وثيقة جديدة',
    message: 'قام المحامي هلال يحيى بتحميل "عقد الإيجار الأصلي الموثق" لقضية علي العبسي.',
    time: 'منذ 5 ساعات',
    read: false,
    type: 'document' as NotificationType
  },
  {
    id: '3',
    title: 'تحديث في حالة القضية',
    message: 'تغيرت حالة القضية الخاصة بمؤسسة يمن سوفت إلى "تحت الدراسة".',
    time: 'منذ يوم واحد',
    read: true,
    type: 'case' as NotificationType
  }
];

export const MONTHLY_CHART_DATA: ChartPoint[] = [
  { month: 'يناير', cases: 8, resolved: 5, revenue: 320000 },
  { month: 'فبراير', cases: 12, resolved: 8, revenue: 450000 },
  { month: 'مارس', cases: 15, resolved: 10, revenue: 580000 },
  { month: 'أبريل', cases: 10, resolved: 12, revenue: 410000 },
  { month: 'مايو', cases: 18, resolved: 14, revenue: 720000 },
  { month: 'يونيو', cases: 22, resolved: 15, revenue: 890000 }
];
