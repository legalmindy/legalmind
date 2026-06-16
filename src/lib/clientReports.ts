import { supabase } from './supabaseClient';
import { getCurrentFirmId } from './api';
import type { ClientReportChannel } from '../types/app';

function normalizeYemenPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('967')) return digits;
  if (digits.startsWith('0')) return `967${digits.slice(1)}`;
  return `967${digits}`;
}

export function buildClientReportMessage(clientName: string): string {
  return `السلام عليكم ${clientName}،\n\nنرسل لكم تقريراً مختصراً عن آخر مستجدات قضيتكم من مكتبكم القانوني عبر LegalMind Yemen.\n\nللاستفسار يرجى التواصل مع المكتب.`;
}

export function buildPaymentReminderMessage(params: {
  clientName: string;
  officeName: string;
  caseTitle: string;
  remainingAmount: number;
  caseNo?: string;
}): string {
  const amount = params.remainingAmount.toLocaleString('ar-YE');
  const caseRef = params.caseNo ? ` (رقم ${params.caseNo})` : '';
  return (
    `السلام عليكم ورحمة الله وبركاته،\n\n` +
    `الأخ/الأخت الكريم ${params.clientName}،\n\n` +
    `نُحيطكم علماً بأن مكتب *${params.officeName}* يُذكّركم بوجود مبلغ أتعاب محاماة مستحق بذمتكم:\n\n` +
    `📋 القضية: ${params.caseTitle}${caseRef}\n` +
    `💰 المبلغ المستحق: *${amount} ر.ي*\n\n` +
    `يُرجى التكرم بتسوية هذا المبلغ في أقرب وقت ممكن، مع خالص الشكر والتقدير.\n\n` +
    `للاستفسار أو التنسيق يرجى التواصل مع المكتب مباشرةً.`
  );
}

export function openClientReportChannel(phone: string, channel: ClientReportChannel, message: string): void {
  const normalized = normalizeYemenPhone(phone);
  const encoded = encodeURIComponent(message);
  const url =
    channel === 'whatsapp'
      ? `https://wa.me/${normalized}?text=${encoded}`
      : `sms:+${normalized}?body=${encoded}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function logClientReport(input: {
  clientId: string;
  channel: ClientReportChannel;
  messageBody: string;
}): Promise<void> {
  const firmId = await getCurrentFirmId();
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('client_report_logs').insert({
    firm_id: firmId,
    client_id: input.clientId,
    channel: input.channel,
    message_body: input.messageBody,
    sent_by: user?.id ?? null
  });
  if (error) throw error;
}
