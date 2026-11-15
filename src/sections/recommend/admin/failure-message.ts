import type { RecommendFailure } from 'src/services/recommend/api';
export function recommendFailureMessage(reason: RecommendFailure): string {
  if (reason === 'invalid') return '입력을 확인해 주세요';
  if (reason === 'too-many') return '추천은 30개까지예요';
  if (reason === 'too-large') return '추천이 너무 커요';
  if (reason === 'not-admin') return '관리자만 할 수 있어요';
  return '잠시 뒤 다시 시도해 주세요';
}
