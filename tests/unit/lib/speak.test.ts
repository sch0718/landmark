import { expect, it } from 'vitest';
import { pickVoice } from 'src/lib/speak';

function voice(lang: string, localService: boolean): SpeechSynthesisVoice {
  return { name: lang, voiceURI: lang, lang, localService, default: false };
}

it('지역 표기를 정규화하고 언어가 정확히 맞는 기기 음성을 우선한다', () => {
  const exact = voice('ES_es', true);
  expect(pickVoice([voice('es-MX', true), voice('es-ES', false), exact], 'es-ES')).toEqual({
    voice: exact,
    online: false,
  });
});

it('기본 언어가 같은 기기 음성을 정확히 맞는 원격 음성보다 먼저 고른다', () => {
  const local = voice('es-MX', true);
  expect(pickVoice([voice('es-ES', false), local], 'es-ES')).toEqual({
    voice: local,
    online: false,
  });
});

it('기기 음성이 없으면 기본 언어가 같은 원격 음성보다 정확히 맞는 원격 음성을 먼저 고른다', () => {
  const regional = voice('es-MX', false);
  const exact = voice('es-ES', false);
  expect(pickVoice([regional, exact], 'es-ES')).toEqual({ voice: exact, online: true });
  expect(pickVoice([regional], 'es-ES')).toEqual({ voice: regional, online: true });
  expect(pickVoice([regional], 'fr-FR')).toBeNull();
});
