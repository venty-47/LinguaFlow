/**
 * 单词发音工具 — 直接使用有道词典语音 URL，无需 API 调用
 */

const audioCache = new Map<string, HTMLAudioElement>();

/** 有道词典语音 URL */
export function getWordAudioURL(word: string, accent: 'uk' | 'us'): string {
  const type = accent === 'uk' ? '1' : '2';
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`;
}

/** 预加载音频到缓存 */
export function preloadAudio(word: string, accent: 'uk' | 'us'): HTMLAudioElement {
  const key = `${word}_${accent}`;
  let audio = audioCache.get(key);
  if (audio) return audio;
  audio = new Audio(getWordAudioURL(word, accent));
  audio.preload = 'auto';
  audio.load();
  audioCache.set(key, audio);
  return audio;
}

/** 播放单词发音 */
export async function playWordAudio(word: string, accent: 'uk' | 'us' = 'us'): Promise<void> {
  const audio = preloadAudio(word, accent);
  audio.currentTime = 0;
  try {
    await audio.play();
  } catch {
    // 静默失败
  }
}

/** 批量预加载接下来 N 个单词的音频 */
export function preloadUpcoming(words: string[], accent: 'uk' | 'us' = 'us', count = 3): void {
  words.slice(0, count).forEach((w) => preloadAudio(w, accent));
}

/** 使用后端 TTS API 朗读例句（回退到浏览器 Web Speech API） */
let currentSentenceAudio: HTMLAudioElement | null = null;

export async function playSentenceAudio(text: string): Promise<void> {
  if (typeof window === 'undefined') return;

  // 停止当前朗读
  if (currentSentenceAudio) {
    currentSentenceAudio.pause();
    currentSentenceAudio = null;
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }

  // 优先使用后端 TTS
  try {
    const { ttsAPI } = await import('@/lib/api');
    const res = await ttsAPI.generateSpeech({ text, voice: 'Chloe', speed: 0.9 });
    const audioUrl = res.data?.data?.audio_url;
    if (audioUrl) {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      const audio = new Audio(`${baseUrl}${audioUrl}`);
      currentSentenceAudio = audio;
      audio.preload = 'auto';
      try {
        await audio.play();
        return;
      } catch {
        // 播放失败，走回退
      }
    }
  } catch {
    // TTS 未配置或请求失败，走回退
  }

  // 回退: Web Speech API
  if (!window.speechSynthesis) return;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  utterance.pitch = 1;
  utterance.volume = 1;

  const voices = window.speechSynthesis.getVoices();
  const enVoice = voices.find(
    (v) => v.lang.startsWith('en') && v.name.includes('Female')
  ) || voices.find((v) => v.lang.startsWith('en'));
  if (enVoice) utterance.voice = enVoice;

  window.speechSynthesis.speak(utterance);
}

/** 停止例句朗读 */
export function stopSentenceAudio(): void {
  if (currentSentenceAudio) {
    currentSentenceAudio.pause();
    currentSentenceAudio = null;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
