import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

type AiAction = 'summarize' | 'contract_draft' | 'legal_research';

type LegalAiPayload = {
  action: AiAction;
  text?: string;
  query?: string;
  contractType?: string;
  firstParty?: string;
  secondParty?: string;
  subject?: string;
  amount?: string;
  duration?: string;
  specialTerms?: string;
  jurisdiction?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400'
};

function corsResponse(status = 204): Response {
  return new Response(null, { status, headers: corsHeaders });
}

const MAX_INPUT = 14_000;
const HOURLY_LIMIT = 40;

const SYSTEM_BASE = `أنت مساعد قانوني متخصص في القانون اليمني والممارسة القانونية في مكاتب المحاماة.
- اكتب بالعربية الفصحى الواضحة مع مصطلحات قانونية دقيقة.
- ركّز على سياق اليمن ما لم يُذكر غير ذلك.
- لا تقدّم نصيحة ملزمة؛ أضف تنبيهاً مختصراً أن المخرجات مسودة للمراجعة من محامٍ مرخّص.
- لا تختلق مواد قانونية؛ إن لم تكن متأكداً فاذكر ذلك صراحة.`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function isPayload(value: unknown): value is LegalAiPayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as LegalAiPayload;
  return ['summarize', 'contract_draft', 'legal_research'].includes(p.action);
}

function buildUserPrompt(payload: LegalAiPayload): { prompt: string; inputChars: number } {
  if (payload.action === 'summarize') {
    const text = (payload.text ?? '').trim();
    if (text.length < 40) throw new Error('النص قصير جداً للتلخيص (40 حرفاً على الأقل).');
    if (text.length > MAX_INPUT) throw new Error('النص يتجاوز الحد المسموح.');
    const prompt = `لخّص المستند القانوني التالي بشكل مهني:
1) موضوع المستند ونوعه
2) الأطراف المعنية
3) النقاط الجوهرية (5-10 نقاط)
4) التواريخ والمبالغ والالتزامات المهمة
5) مخاطر أو نواقص يجب انتباه المحامي لها

المستند:
"""
${text}
"""`;
    return { prompt, inputChars: text.length };
  }

  if (payload.action === 'contract_draft') {
    const contractType = (payload.contractType ?? 'عقد').trim();
    const firstParty = (payload.firstParty ?? 'الطرف الأول').trim();
    const secondParty = (payload.secondParty ?? 'الطرف الثاني').trim();
    const subject = (payload.subject ?? '').trim();
    const amount = (payload.amount ?? '').trim();
    const duration = (payload.duration ?? '').trim();
    const specialTerms = (payload.specialTerms ?? '').trim();
    const jurisdiction = (payload.jurisdiction ?? 'الجمهورية اليمنية').trim();

    if (!subject) throw new Error('يرجى تحديد موضوع العقد.');

    const meta = [
      `نوع العقد: ${contractType}`,
      `الطرف الأول: ${firstParty}`,
      `الطرف الثاني: ${secondParty}`,
      `الموضوع: ${subject}`,
      amount ? `المبلغ/القيمة: ${amount}` : null,
      duration ? `المدة: ${duration}` : null,
      `الاختصاص: ${jurisdiction}`,
      specialTerms ? `شروط خاصة: ${specialTerms}` : null
    ]
      .filter(Boolean)
      .join('\n');

    const prompt = `أعد مسودة عقد قانوني بالعربية وفق البيانات التالية.
استخدم تنسيقاً رسمياً: عنوان، تمهيد، تعريفات، مواد مرقمة، أحكام عامة، التوقيعات.
أضف خانات [....] للبيانات التي تحتاج إكمالاً.

${meta}`;
    return { prompt, inputChars: meta.length };
  }

  const query = (payload.query ?? '').trim();
  if (query.length < 8) throw new Error('يرجى كتابة سؤال أو موضوع بحث أوضح.');
  if (query.length > MAX_INPUT) throw new Error('نص البحث طويل جداً.');

  const prompt = `أجب على الاستفسار القانوني التالي في سياق القانون اليمني:
- قدّم إطاراً عاماً وخطوات عملية
- اذكر اعتبارات procedural إن وُجدت
- فرّق بين ما هو قانوني عام وما يحتاج مراجعة نصوص/اجتهاد محلي
- اقترح أسئلة follow-up للمحامي

السؤال:
${query}`;
  return { prompt, inputChars: query.length };
}

async function callOpenAi(system: string, user: string): Promise<string> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  const model = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

  if (!apiKey) {
    throw new Error('خدمة الذكاء الاصطناعي غير مهيأة. أضف OPENAI_API_KEY في Supabase Edge Function secrets.');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      max_tokens: 2800,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[legal-ai] OpenAI error:', errText);
    throw new Error('تعذر معالجة الطلب من مزود الذكاء الاصطناعي.');
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('استجابة غير صالحة من الذكاء الاصطناعي.');
  }
  return content.trim();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse(204);
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'بيئة الدالة غير مهيأة' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Missing authorization header' }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const { data: allowed, error: accessError } = await userClient.rpc('assert_ai_assistant_access');
  if (accessError) {
    console.warn('[legal-ai] assert_ai_assistant_access:', accessError.message);
    const { data: employeeCheck } = await adminClient
      .from('employees')
      .select('id, role')
      .eq('auth_uid', userData.user.id)
      .eq('status', 'active')
      .is('deleted_at', null)
      .maybeSingle();
    if (!employeeCheck) {
      return jsonResponse({ error: 'ليس لديك صلاحية استخدام المساعد القانوني الذكي.' }, 403);
    }
  } else if (!allowed) {
    return jsonResponse({ error: 'ليس لديك صلاحية استخدام المساعد القانوني الذكي.' }, 403);
  }

  const body = await req.json().catch(() => null);
  if (!isPayload(body)) return jsonResponse({ error: 'طلب غير صالح' }, 400);

  const { data: employee } = await adminClient
    .from('employees')
    .select('id, firm_id')
    .eq('auth_uid', userData.user.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!employee?.id) return jsonResponse({ error: 'Employee record not found' }, 403);

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await adminClient
    .from('ai_assistant_logs')
    .select('id', { count: 'exact', head: true })
    .eq('employee_id', employee.id)
    .gte('created_at', oneHourAgo);

  if ((count ?? 0) >= HOURLY_LIMIT) {
    return jsonResponse({ error: 'تجاوزت الحد المسموح من الطلبات (40/ساعة). حاول لاحقاً.' }, 429);
  }

  try {
    const { prompt, inputChars } = buildUserPrompt(body);
    const actionLabel =
      body.action === 'summarize'
        ? 'تلخيص مستند'
        : body.action === 'contract_draft'
          ? 'مسودة عقد'
          : 'بحث قانوني';

    const system = `${SYSTEM_BASE}\n\nالمهمة الحالية: ${actionLabel}.`;
    const result = await callOpenAi(system, prompt);

    await adminClient.from('ai_assistant_logs').insert({
      firm_id: employee.firm_id,
      employee_id: employee.id,
      action_type: body.action,
      input_chars: inputChars,
      output_chars: result.length
    });

    return jsonResponse({ result, action: body.action });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع';
    return jsonResponse({ error: message }, 400);
  }
});
