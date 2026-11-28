import type { Phrase, PrepNote } from 'src/schema/trip';

export const TOPIC_LABELS: Record<PrepNote['topic'], string> = {
  language: '언어',
  money: '돈·환율',
  prices: '물가',
  weather: '날씨',
  time: '시간',
  power: '전압·플러그',
  tips: '팁',
  safety: '치안',
  emergency: '긴급',
  transit: '교통',
  docs: '서류',
  other: '기타',
};

export const TOPIC_ICONS: Record<PrepNote['topic'], string> = {
  language: '💬',
  money: '💶',
  prices: '🧾',
  weather: '🌤',
  time: '🕐',
  power: '🔌',
  tips: '💡',
  safety: '🛡',
  emergency: '☎',
  transit: '🚆',
  docs: '📄',
  other: '📌',
};

export const SITUATION_LABELS: Record<Phrase['situation'], string> = {
  greet: '인사',
  restaurant: '식당',
  directions: '길',
  transit: '교통',
  lodging: '숙소',
  shopping: '쇼핑',
  emergency: '긴급',
  other: '기타',
};

export function languageName(lang: string) {
  try {
    return new Intl.DisplayNames(['ko'], { type: 'language' }).of(lang) ?? lang;
  } catch {
    return lang;
  }
}

export const languageLabel = (lang: string) =>
  `${languageName(lang.split('-')[0] ?? lang)} ${lang}`;
