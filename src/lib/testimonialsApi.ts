import { callPublicRpc } from './supabaseClient';
import { throwIfSupabaseError } from './supabaseQueryHelpers';

export interface PublicTestimonial {
  id: string;
  authorName: string;
  authorRole: string;
  body: string;
  stars: number;
  createdAt: string;
}

type TestimonialRow = {
  id: string;
  author_name: string;
  author_role: string;
  body: string;
  stars: number;
  created_at: string;
};

function mapRow(row: TestimonialRow): PublicTestimonial {
  return {
    id: row.id,
    authorName: row.author_name,
    authorRole: row.author_role,
    body: row.body,
    stars: row.stars,
    createdAt: row.created_at
  };
}

export async function fetchApprovedTestimonials(limit = 24): Promise<PublicTestimonial[]> {
  const { data, error } = await callPublicRpc('list_approved_testimonials', { p_limit: limit });
  throwIfSupabaseError(error);
  return ((data ?? []) as TestimonialRow[]).map(mapRow);
}

export interface SubmitTestimonialInput {
  authorName: string;
  authorRole: string;
  body: string;
  stars: number;
}

export async function submitPublicTestimonial(input: SubmitTestimonialInput): Promise<string> {
  const { data, error } = await callPublicRpc('submit_public_testimonial', {
    p_author_name: input.authorName.trim(),
    p_author_role: input.authorRole.trim(),
    p_body: input.body.trim(),
    p_stars: input.stars
  });
  if (error) {
    if (/rate_limited/i.test(error.message)) {
      throw new Error('تم تجاوز الحد المسموح. حاول لاحقاً.');
    }
    throwIfSupabaseError(error);
  }
  if (!data) throw new Error('تعذر حفظ التعليق.');
  return String(data);
}
