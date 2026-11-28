const normalizeLang = (lang: string) => lang.toLowerCase().replaceAll('_', '-');
const baseLang = (lang: string) => normalizeLang(lang).split('-')[0];

export function pickVoice(voices: readonly SpeechSynthesisVoice[], lang: string) {
  const tag = normalizeLang(lang);
  const matchesTag = (voice: SpeechSynthesisVoice) => normalizeLang(voice.lang) === tag;
  const matchesBase = (voice: SpeechSynthesisVoice) => baseLang(voice.lang) === baseLang(tag);
  const voice =
    voices.find((voice) => voice.localService && matchesTag(voice)) ??
    voices.find((voice) => voice.localService && matchesBase(voice)) ??
    voices.find(matchesTag) ??
    voices.find(matchesBase);
  return voice === undefined ? null : { voice, online: !voice.localService };
}

export async function loadVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  const synthesis = globalThis.speechSynthesis;
  if (!synthesis) return [];
  const voices = synthesis.getVoices();
  if (voices.length > 0) return voices;

  return new Promise((resolve) => {
    const finish = (loaded: SpeechSynthesisVoice[]) => {
      clearTimeout(timer);
      synthesis.removeEventListener('voiceschanged', onChange);
      resolve(loaded);
    };
    const onChange = () => {
      const loaded = synthesis.getVoices();
      if (loaded.length > 0) finish(loaded);
    };
    const timer = setTimeout(() => finish(synthesis.getVoices()), timeoutMs);
    synthesis.addEventListener('voiceschanged', onChange);
    onChange();
  });
}

export function speak(text: string, voice: SpeechSynthesisVoice, rate: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const synthesis = globalThis.speechSynthesis;
    synthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = rate;
    utterance.onend = () => resolve();
    utterance.onerror = ({ error }) => {
      if (error === 'interrupted' || error === 'canceled') resolve();
      else reject(new Error(error));
    };
    synthesis.speak(utterance);
  });
}

export function googleTranslateUrl(text: string, lang: string) {
  return `https://translate.google.com/?sl=${encodeURIComponent(baseLang(lang) ?? '')}&tl=ko&text=${encodeURIComponent(text)}&op=translate`;
}
