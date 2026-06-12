'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookmarkCheck,
  BookmarkPlus,
  ExternalLink,
  Eye,
  Gauge,
  Languages,
  Loader2,
  Pause,
  Play,
  SkipForward,
  Square,
  Volume2,
} from 'lucide-react';
import { formatAO3Chapters } from '@/lib/ao3';
import { ao3API, resolveAPIAssetURL, translationAPI, ttsAPI, vocabularyAPI } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { AO3Work, SentenceAnalysis, Vocabulary } from '@/types';
import TranslationTooltip from '@/components/TranslationTooltip';

const ttsVoices = ['Mia', 'Chloe', 'Milo', 'Dean'];
const ttsRates = [0.75, 0.9, 1, 1.15, 1.3];
const SAVED_SENTENCES_KEY = 'linguaflow:ao3-saved-sentences';

type TextTranslationState = {
  loading: boolean;
  text?: string;
  error?: string;
};

function joined(values: string[], fallback = '-') {
  return values && values.length > 0 ? values.join(', ') : fallback;
}

function compactTags(work: AO3Work) {
  return [...work.fandoms, ...work.relationships, ...work.characters, ...work.tags].slice(0, 24);
}

function normalizeWord(token: string) {
  return token.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').toLowerCase();
}

function getDictionaryWord(text: string) {
  if (/\s/.test(text.trim())) return '';
  const word = normalizeWord(text);
  return /^[a-z]+(?:['’][a-z]+)?$/.test(word) ? word : '';
}

function getWordMatchFromPoint(x: number, y: number) {
  let node: Node | null = null;
  let offset = 0;
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };

  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    node = range?.startContainer || null;
    offset = range?.startOffset || 0;
  } else if (doc.caretPositionFromPoint) {
    const position = doc.caretPositionFromPoint(x, y);
    node = position?.offsetNode || null;
    offset = position?.offset || 0;
  }

  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent || '';
  if (!text) return null;

  if (offset >= text.length) offset = text.length - 1;
  if (offset > 0 && !/[A-Za-z]/.test(text[offset]) && /[A-Za-z]/.test(text[offset - 1])) {
    offset -= 1;
  }
  if (!/[A-Za-z]/.test(text[offset])) return null;

  let start = offset;
  let end = offset + 1;
  while (start > 0 && /[A-Za-z'’]/.test(text[start - 1])) start -= 1;
  while (end < text.length && /[A-Za-z'’]/.test(text[end])) end += 1;

  const word = normalizeWord(text.slice(start, end));
  if (!word) return null;

  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);

  return { word, range };
}

function tokenizeParagraph(paragraph: string) {
  return paragraph.split(/([A-Za-z]+(?:['’][A-Za-z]+)?)/g).filter(Boolean);
}

function splitSentences(paragraph: string) {
  return paragraph.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [
    paragraph,
  ];
}

function buildSentenceQueue(paragraphs: string[]) {
  return paragraphs.flatMap((paragraph, paragraphIndex) =>
    splitSentences(paragraph).map((sentence, sentenceIndex) => ({
      key: `${paragraphIndex}-${sentenceIndex}`,
      paragraphIndex,
      sentenceIndex,
      text: sentence,
    }))
  );
}

export default function AO3WorkPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const [work, setWork] = useState<AO3Work | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showTranslation, setShowTranslation] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [tooltipMode, setTooltipMode] = useState<'translate' | 'dictionary'>('dictionary');
  const [tooltipContext, setTooltipContext] = useState('');
  const [paragraphTranslations, setParagraphTranslations] = useState<Record<string, TextTranslationState>>({});
  const [vocabularyByWord, setVocabularyByWord] = useState<Map<string, Vocabulary>>(new Map());
  const [intensiveMode, setIntensiveMode] = useState(false);
  const [activeIntensiveParagraph, setActiveIntensiveParagraph] = useState<number | null>(null);
  const [activeAnalysisKey, setActiveAnalysisKey] = useState('');
  const [sentenceAnalysis, setSentenceAnalysis] = useState<SentenceAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [analysisRequiresPremium, setAnalysisRequiresPremium] = useState(false);
  const [savedSentenceKeys, setSavedSentenceKeys] = useState<Set<string>>(new Set());
  const [ttsVoice, setTtsVoice] = useState('Chloe');
  const [ttsRate, setTtsRate] = useState(0.9);
  const [ttsLoadingKey, setTtsLoadingKey] = useState('');
  const [ttsPlayingKey, setTtsPlayingKey] = useState('');
  const [ttsPaused, setTtsPaused] = useState(false);
  const [ttsQueueIndex, setTtsQueueIndex] = useState<number | null>(null);
  const [ttsError, setTtsError] = useState('');
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);

  const highlightRef = useRef<HTMLElement | null>(null);
  const sentenceElementRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsRequestIdRef = useRef(0);
  const ttsQueueIndexRef = useRef<number | null>(null);

  const chapterList = useMemo(() => {
    if (work?.chapters_data?.length) return work.chapters_data;
    if (!work) return [];
    return [{
      id: 'chapter-1',
      index: 1,
      title: 'Chapter 1',
      summary: '',
      notes: '',
      content_html: work.content_html,
      content_text: work.content_text,
      paragraphs: work.paragraphs || [],
    }];
  }, [work]);
  const currentChapter = chapterList[currentChapterIndex] || chapterList[0];
  const paragraphs = useMemo(() => currentChapter?.paragraphs?.filter(Boolean) || [], [currentChapter]);
  const sentenceQueue = useMemo(() => buildSentenceQueue(paragraphs), [paragraphs]);
  const selectedVocabulary = vocabularyByWord.get(normalizeWord(selectedText));

  useEffect(() => {
    const activeSentenceKey = ttsPlayingKey || ttsLoadingKey;
    if (!activeSentenceKey || ttsPaused) return;

    const activeElement = sentenceElementRefs.current[activeSentenceKey];
    if (!activeElement) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    activeElement.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'center',
      inline: 'nearest',
    });
  }, [ttsLoadingKey, ttsPaused, ttsPlayingKey]);

  const highlightedVocabularyCount = useMemo(() => {
    const matched = new Set<string>();
    paragraphs.forEach((paragraph) => {
      tokenizeParagraph(paragraph).forEach((token) => {
        const word = normalizeWord(token);
        if (word && vocabularyByWord.has(word)) matched.add(word);
      });
    });
    return matched.size;
  }, [paragraphs, vocabularyByWord]);

  useEffect(() => {
    let cancelled = false;
    const fetchWork = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await ao3API.getWork(params.id);
        if (!cancelled) {
          setWork(response.data.data);
          setCurrentChapterIndex(0);
        }
      } catch (err: any) {
        if (!cancelled) {
          setWork(null);
          setError(err.response?.data?.error || 'AO3 作品暂时不可读取');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchWork();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  useEffect(() => {
    if (!isAuthenticated) return;
    vocabularyAPI.getVocabulary()
      .then((response) => {
        const vocabulary = response.data.data as Vocabulary[];
        setVocabularyByWord(
          new Map(vocabulary.map((item) => [normalizeWord(item.word), item] as const).filter(([word]) => Boolean(word)))
        );
      })
      .catch((err) => console.error('Failed to fetch vocabulary:', err));
  }, [isAuthenticated]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED_SENTENCES_KEY) || '[]') as Array<{ work_id: string; sentence: string }>;
      setSavedSentenceKeys(new Set(saved.map((item) => `${item.work_id}:${item.sentence}`)));
    } catch (err) {
      console.error('Failed to load saved AO3 sentences:', err);
    }
  }, []);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
      clearHighlight();
    };
  }, []);

  const clearHighlight = () => {
    const highlight = highlightRef.current;
    if (!highlight) return;
    const parent = highlight.parentNode;
    if (!parent) {
      highlightRef.current = null;
      return;
    }
    while (highlight.firstChild) parent.insertBefore(highlight.firstChild, highlight);
    parent.removeChild(highlight);
    parent.normalize();
    highlightRef.current = null;
  };

  const applyHighlight = (range: Range) => {
    clearHighlight();
    const mark = document.createElement('mark');
    mark.className = 'reading-selection-highlight';
    try {
      range.surroundContents(mark);
      highlightRef.current = mark;
      window.getSelection()?.removeAllRanges();
    } catch (err) {
      console.error('Failed to apply highlight:', err);
    }
  };

  const closeAnalysis = () => {
    setSentenceAnalysis(null);
    setAnalysisError('');
    setAnalysisRequiresPremium(false);
    setActiveAnalysisKey('');
  };

  const changeChapter = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= chapterList.length) return;
    stopTTS();
    setCurrentChapterIndex(nextIndex);
    setParagraphTranslations({});
    setShowTranslation(false);
    setSelectedText('');
    setTooltipContext('');
    setActiveIntensiveParagraph(null);
    closeAnalysis();
    clearHighlight();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleParagraphClick = (event: MouseEvent<HTMLParagraphElement>, paragraph: string) => {
    const selected = window.getSelection()?.toString().trim();
    if (selected) return;
    const match = getWordMatchFromPoint(event.clientX, event.clientY);
    if (!match) return;

    setSelectedText(match.word);
    setTooltipContext(paragraph);
    setTooltipMode('dictionary');
    setTooltipPosition({ x: event.clientX, y: event.clientY - 12 + window.scrollY });
    applyHighlight(match.range);
    setShowTranslation(true);
  };

  const handleTextSelection = (paragraph: string) => {
    window.requestAnimationFrame(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (!text || text.length < 2) return;
      const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      const rect = range?.getBoundingClientRect();
      if (!range || !rect) return;

      const dictionaryWord = getDictionaryWord(text);
      setSelectedText(dictionaryWord || text);
      setTooltipContext(paragraph);
      setTooltipMode(dictionaryWord ? 'dictionary' : 'translate');
      setTooltipPosition({ x: rect.left + rect.width / 2, y: rect.top - 12 + window.scrollY });
      applyHighlight(range);
      setShowTranslation(true);
    });
  };

  const handleTranslateParagraph = async (index: number | string, paragraph: string) => {
    const translationKey = String(index);
    const current = paragraphTranslations[translationKey];
    if (current?.text) {
      setParagraphTranslations((prev) => {
        const next = { ...prev };
        delete next[translationKey];
        return next;
      });
      return;
    }

    try {
      setParagraphTranslations((prev) => ({ ...prev, [translationKey]: { loading: true } }));
      const response = await translationAPI.translate({ text: paragraph, target_lang: 'zh' });
      setParagraphTranslations((prev) => ({ ...prev, [translationKey]: { loading: false, text: response.data.translation } }));
    } catch (err) {
      console.error('Failed to translate AO3 paragraph:', err);
      setParagraphTranslations((prev) => ({ ...prev, [translationKey]: { loading: false, error: '段落翻译失败' } }));
    }
  };

  const handleAnalyzeSentence = async (text: string, analysisKey: string) => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    try {
      setActiveAnalysisKey(analysisKey);
      setAnalysisLoading(true);
      setAnalysisError('');
      setAnalysisRequiresPremium(false);
      setSentenceAnalysis(null);
      const response = await translationAPI.analyzeSentence(text.trim());
      setSentenceAnalysis(response.data.data);
    } catch (err: any) {
      const code = err.response?.data?.code;
      if (code === 'PREMIUM_REQUIRED' || code === 'MEMBERSHIP_EXPIRED' || code === 'MEMBERSHIP_INVALID') {
        setAnalysisRequiresPremium(true);
        setAnalysisError(err.response?.data?.error || '句子精读需要会员权限');
      } else {
        setAnalysisError('精读解析失败');
      }
    } finally {
      setAnalysisLoading(false);
    }
  };

  const handleAnalyzeParagraph = (paragraph: string, paragraphIndex: number) => {
    const firstSentence = splitSentences(paragraph)[0];
    if (!firstSentence) return;
    setShowTranslation(false);
    clearHighlight();
    setActiveIntensiveParagraph(paragraphIndex);
    handleAnalyzeSentence(firstSentence, `paragraph-${paragraphIndex}-0`);
  };

  const resetTTSState = () => {
    setTtsLoadingKey('');
    setTtsPlayingKey('');
    setTtsPaused(false);
    setTtsQueueIndex(null);
    setSpeakingIndex(null);
    ttsQueueIndexRef.current = null;
  };

  const stopTTS = () => {
    ttsRequestIdRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    window.speechSynthesis?.cancel();
    resetTTSState();
  };

  const speakWithBrowser = (text: string, key: string, paragraphIndex: number | null, onEnd?: () => void) => {
    if (!('speechSynthesis' in window)) {
      setTtsError('当前浏览器不支持朗读功能');
      resetTTSState();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = ttsRate;
    utterance.onend = () => (onEnd ? onEnd() : resetTTSState());
    utterance.onerror = () => {
      setTtsError('浏览器朗读失败');
      resetTTSState();
    };

    setTtsLoadingKey('');
    setTtsPlayingKey(key);
    setTtsPaused(false);
    setSpeakingIndex(paragraphIndex);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const playTTSItem = async (item: { key: string; text: string; paragraphIndex: number | null }, queueIndex: number | null = null) => {
    if (ttsPlayingKey === item.key || ttsLoadingKey === item.key) {
      stopTTS();
      return;
    }

    const requestId = ttsRequestIdRef.current + 1;
    ttsRequestIdRef.current = requestId;
    setTtsError('');
    setTtsLoadingKey(item.key);
    setTtsPlayingKey('');
    setTtsPaused(false);
    setSpeakingIndex(item.paragraphIndex);
    setTtsQueueIndex(queueIndex);
    ttsQueueIndexRef.current = queueIndex;
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();

    const playNext = () => {
      if (ttsRequestIdRef.current !== requestId) return;
      const currentIndex = ttsQueueIndexRef.current;
      if (currentIndex === null) {
        resetTTSState();
        return;
      }
      const next = sentenceQueue[currentIndex + 1];
      if (!next) {
        resetTTSState();
        return;
      }
      playTTSItem({ key: next.key, text: next.text, paragraphIndex: next.paragraphIndex }, currentIndex + 1);
    };

    try {
      if (!isAuthenticated) throw new Error('not authenticated');
      const response = await ttsAPI.generateSpeech({ text: item.text, voice: ttsVoice, speed: ttsRate, format: 'wav' });
      if (ttsRequestIdRef.current !== requestId) return;
      const audio = new Audio(resolveAPIAssetURL(response.data.data.audio_url));
      audioRef.current = audio;
      audio.onended = playNext;
      audio.onerror = () => speakWithBrowser(item.text, item.key, item.paragraphIndex, playNext);
      setTtsLoadingKey('');
      setTtsPlayingKey(item.key);
      setTtsPaused(false);
      await audio.play();
    } catch (err: any) {
      if (ttsRequestIdRef.current !== requestId) return;
      const message = err.response?.data?.error || err.message || '';
      if (message && message !== 'not authenticated') {
        setTtsError(`模型 TTS 不可用，已切换浏览器朗读：${message}`);
      }
      speakWithBrowser(item.text, item.key, item.paragraphIndex, playNext);
    }
  };

  const playSentenceQueueFrom = (startIndex: number) => {
    const item = sentenceQueue[startIndex];
    if (!item) return;
    playTTSItem({ key: item.key, text: item.text, paragraphIndex: item.paragraphIndex }, startIndex);
  };

  const playParagraphQueueFrom = (paragraphIndex: number, paragraph: string) => {
    const queueIndex = sentenceQueue.findIndex((item) => item.paragraphIndex === paragraphIndex);
    if (queueIndex >= 0) {
      playSentenceQueueFrom(queueIndex);
      return;
    }

    playTTSItem({ key: `paragraph-${paragraphIndex}`, text: paragraph, paragraphIndex });
  };

  const handlePauseOrResumeTTS = () => {
    if (!ttsPlayingKey) return;
    if (ttsPaused) {
      if (audioRef.current) audioRef.current.play().catch(() => setTtsError('音频继续播放失败'));
      else window.speechSynthesis?.resume();
      setTtsPaused(false);
      return;
    }
    if (audioRef.current) audioRef.current.pause();
    else window.speechSynthesis?.pause();
    setTtsPaused(true);
  };

  const handleSaveSentence = () => {
    if (!work || !sentenceAnalysis) return;
    const savedKey = `${work.id}:${sentenceAnalysis.sentence}`;
    try {
      const current = JSON.parse(localStorage.getItem(SAVED_SENTENCES_KEY) || '[]') as Array<{
        work_id: string;
        work_title: string;
        sentence: string;
        translation: string;
        saved_at: string;
      }>;
      if (!current.some((item) => item.work_id === work.id && item.sentence === sentenceAnalysis.sentence)) {
        current.unshift({
          work_id: work.id,
          work_title: work.title,
          sentence: sentenceAnalysis.sentence,
          translation: sentenceAnalysis.translation,
          saved_at: new Date().toISOString(),
        });
        localStorage.setItem(SAVED_SENTENCES_KEY, JSON.stringify(current.slice(0, 200)));
      }
      setSavedSentenceKeys((prev) => new Set(prev).add(savedKey));
    } catch (err) {
      console.error('Failed to save AO3 sentence:', err);
    }
  };

  const renderSentenceText = (sentence: string, sentenceKey: string) =>
    tokenizeParagraph(sentence).map((token, tokenIndex) => {
      const word = normalizeWord(token);
      if (!word || !vocabularyByWord.has(word)) return token;
      return (
        <mark
          key={`${sentenceKey}-${token}-${tokenIndex}`}
          className={`rounded px-0.5 ring-1 ${
            ttsPlayingKey === sentenceKey
              ? 'bg-sky-400/20 text-sky-50 ring-sky-300/30'
              : 'bg-amber-400/20 text-amber-100 ring-amber-400/25'
          }`}
          title="已在生词本"
        >
          {token}
        </mark>
      );
    });

  const renderParagraph = (paragraph: string, paragraphIndex: number) =>
    splitSentences(paragraph).map((sentence, sentenceIndex) => {
      const sentenceKey = `${paragraphIndex}-${sentenceIndex}`;
      const queueIndex = sentenceQueue.findIndex((item) => item.key === sentenceKey);
      return (
        <span
          key={sentenceKey}
          ref={(element) => {
            sentenceElementRefs.current[sentenceKey] = element;
          }}
          onClick={(event) => {
            if (ttsQueueIndex === null) return;
            if (queueIndex < 0) return;

            event.stopPropagation();
            playSentenceQueueFrom(queueIndex);
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            if (queueIndex >= 0) {
              playSentenceQueueFrom(queueIndex);
              return;
            }

            playTTSItem({ key: sentenceKey, text: sentence, paragraphIndex });
          }}
          title="双击从此句开始逐句播放"
          className={`rounded px-0.5 transition-colors ${
            ttsPlayingKey === sentenceKey
              ? 'bg-sky-500/20 text-sky-50 ring-1 ring-sky-300/30'
              : queueIndex === ttsQueueIndex
                ? 'text-sky-100'
                : ''
          } ${ttsQueueIndex !== null ? 'cursor-pointer hover:bg-sky-500/10' : ''}`}
        >
          {renderSentenceText(sentence, sentenceKey)}
          {sentenceIndex < splitSentences(paragraph).length - 1 ? ' ' : ''}
        </span>
      );
    });

  const renderLearningText = (text: string, keyPrefix: string) =>
    splitSentences(text).map((sentence, sentenceIndex) => {
      const sentenceKey = `${keyPrefix}-${sentenceIndex}`;
      return (
        <span
          key={sentenceKey}
          ref={(element) => {
            sentenceElementRefs.current[sentenceKey] = element;
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            playTTSItem({ key: sentenceKey, text: sentence, paragraphIndex: null });
          }}
          title="双击朗读此句"
          className={`rounded px-0.5 transition-colors ${
            ttsPlayingKey === sentenceKey ? 'bg-sky-500/20 text-sky-50 ring-1 ring-sky-300/30' : ''
          }`}
        >
          {renderSentenceText(sentence, sentenceKey)}
          {sentenceIndex < splitSentences(text).length - 1 ? ' ' : ''}
        </span>
      );
    });

  const renderLearningTextBlock = (label: string, text: string, keyPrefix: string, headingLevel: 'h2' | 'h3' = 'h2') => {
    const translation = paragraphTranslations[keyPrefix];
    const ttsKey = `${keyPrefix}-read`;
    const isReading = ttsPlayingKey === ttsKey || ttsLoadingKey === ttsKey;
    const Heading = headingLevel;

    return (
      <section>
        <Heading className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">{label}</Heading>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <p
            onClick={(event) => handleParagraphClick(event, text)}
            onMouseUp={() => handleTextSelection(text)}
            className="flex-1 cursor-text whitespace-pre-wrap"
          >
            {renderLearningText(text, keyPrefix)}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => handleTranslateParagraph(keyPrefix, text)}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-900"
            >
              {translation?.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
              {translation?.text ? '隐藏' : '翻译'}
            </button>
            <button
              type="button"
              onClick={() => playTTSItem({ key: ttsKey, text, paragraphIndex: null })}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold hover:bg-gray-100 dark:hover:bg-gray-900 ${
                isReading ? 'border-sky-500 text-sky-400' : 'border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-300'
              }`}
            >
              {ttsLoadingKey === ttsKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}
              {ttsPlayingKey === ttsKey ? '停止' : '朗读'}
            </button>
          </div>
        </div>
        {(translation?.text || translation?.error) && (
          <div className="mt-3 rounded-md border border-gray-200 bg-white/70 p-3 text-sm leading-7 text-gray-700 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-300">
            {translation.text || translation.error}
          </div>
        )}
      </section>
    );
  };

  const renderAnalysisPanel = (analysisKey: string) => {
    if (activeAnalysisKey !== analysisKey || (!sentenceAnalysis && !analysisError && !analysisLoading)) return null;
    return (
      <div className="mt-4 rounded-lg border border-blue-900/60 bg-blue-950/20 p-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-blue-100">句子精读</h3>
          <button type="button" onClick={closeAnalysis} className="text-sm text-blue-200/70 hover:text-blue-100">
            关闭
          </button>
        </div>
        {analysisLoading ? (
          <div className="flex items-center gap-2 text-sm text-blue-100">
            <Loader2 className="h-4 w-4 animate-spin" />
            精读解析中...
          </div>
        ) : analysisError ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-red-300">{analysisError}</p>
            {analysisRequiresPremium && (
              <Link href="/membership" className="inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500">
                去会员中心
              </Link>
            )}
          </div>
        ) : sentenceAnalysis ? (
          <div className="space-y-4 text-sm leading-7 text-blue-50">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-blue-800/70 px-2 py-1 text-xs text-blue-200">
                  {sentenceAnalysis.provider === 'ai' ? 'AI 精读' : '规则解析'}
                </span>
                <span className="text-xs text-blue-200/70">{sentenceAnalysis.word_count} 词</span>
              </div>
              <button
                type="button"
                onClick={handleSaveSentence}
                className="inline-flex w-fit items-center gap-2 rounded-md border border-blue-800/70 px-3 py-1.5 text-xs font-semibold text-blue-100 hover:bg-blue-900/40"
              >
                {savedSentenceKeys.has(`${work?.id}:${sentenceAnalysis.sentence}`) ? <BookmarkCheck className="h-3.5 w-3.5" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
                {savedSentenceKeys.has(`${work?.id}:${sentenceAnalysis.sentence}`) ? '已收藏' : '收藏句子'}
              </button>
            </div>
            <p className="text-base font-semibold text-white">{sentenceAnalysis.sentence}</p>
            <div className="rounded-md border border-blue-900/60 bg-blue-950/40 p-3">{sentenceAnalysis.translation}</div>
            <div>
              <h4 className="mb-2 font-semibold text-blue-100">结构拆解</h4>
              <ul className="space-y-1 text-blue-50/90">{sentenceAnalysis.structure.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
            {sentenceAnalysis.key_phrases.length > 0 && (
              <div>
                <h4 className="mb-2 font-semibold text-blue-100">重点词组</h4>
                <div className="flex flex-wrap gap-2">
                  {sentenceAnalysis.key_phrases.map((phrase) => (
                    <span key={phrase} className="rounded border border-blue-800/70 px-2 py-1 text-xs text-blue-100">
                      {phrase}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h4 className="mb-2 font-semibold text-blue-100">阅读提示</h4>
              <ul className="space-y-1 text-blue-50/80">{sentenceAnalysis.difficulty_tips.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (error || !work) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <Link href="/ao3" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-gray-950 dark:text-gray-400 dark:hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          返回 AO3 搜索
        </Link>
        <div className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error || '作品不存在或不可公开读取'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href="/ao3" className="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-gray-950 dark:text-gray-400 dark:hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          返回搜索
        </Link>
        <a
          href={work.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900"
        >
          在 AO3 打开
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      <article>
        <header className="mb-8 border-b border-gray-200 pb-6 dark:border-gray-800">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-500">
            {work.rating && <span className="rounded border border-gray-300 px-2 py-0.5 dark:border-gray-700">{work.rating}</span>}
            {work.language && <span>{work.language}</span>}
            {work.words && <span>词数 {work.words}</span>}
            {work.chapters && <span>{formatAO3Chapters(work.chapters)}</span>}
            {work.published_at && <span>发布 {work.published_at}</span>}
            {work.updated_at && <span>更新 {work.updated_at}</span>}
            {highlightedVocabularyCount > 0 && <span className="text-amber-300">已高亮 {highlightedVocabularyCount} 个旧词</span>}
          </div>
          <h1 className="text-3xl font-black leading-tight text-gray-950 dark:text-gray-100">{work.title}</h1>
          <p className="mt-2 text-sm text-gray-500">by {joined(work.authors, 'Anonymous')}</p>

          {(work.summary || work.notes) && (
            <div className="mt-6 space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm leading-6 text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300">
              {work.summary && renderLearningTextBlock('Summary', work.summary, 'work-summary')}
              {work.notes && renderLearningTextBlock('Notes', work.notes, 'work-notes')}
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            {compactTags(work).map((tag) => (
              <span key={tag} className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 dark:border-gray-800 dark:text-gray-400">
                {tag}
              </span>
            ))}
          </div>
          <p className="mt-5 text-xs leading-5 text-gray-500">{work.disclaimer}</p>
        </header>

        {chapterList.length > 1 && (
          <section className="mb-8 rounded-lg border border-gray-800 bg-gray-950/60 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-100">{currentChapter?.title || `Chapter ${currentChapterIndex + 1}`}</h2>
                <p className="mt-1 text-sm text-gray-500">
                  第 {currentChapterIndex + 1} / {chapterList.length} 章
                  {paragraphs.length > 0 ? ` · ${paragraphs.length} 段` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => changeChapter(currentChapterIndex - 1)}
                  disabled={currentChapterIndex <= 0}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900 disabled:opacity-40"
                >
                  <ArrowLeft className="h-4 w-4" />
                  上一章
                </button>
                <select
                  value={currentChapterIndex}
                  onChange={(event) => changeChapter(Number(event.target.value))}
                  className="max-w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-200 sm:max-w-sm"
                >
                  {chapterList.map((chapter, index) => (
                    <option key={chapter.id || index} value={index}>
                      {index + 1}. {chapter.title || `Chapter ${index + 1}`}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => changeChapter(currentChapterIndex + 1)}
                  disabled={currentChapterIndex >= chapterList.length - 1}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900 disabled:opacity-40"
                >
                  下一章
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            {(currentChapter?.summary || currentChapter?.notes) && (
              <div className="mt-4 space-y-3 rounded-md border border-gray-800 bg-gray-900/50 p-4 text-sm leading-6 text-gray-300">
                {currentChapter.summary && renderLearningTextBlock('Chapter Summary', currentChapter.summary, `chapter-${currentChapterIndex}-summary`, 'h3')}
                {currentChapter.notes && renderLearningTextBlock('Chapter Notes', currentChapter.notes, `chapter-${currentChapterIndex}-notes`, 'h3')}
              </div>
            )}
          </section>
        )}

        <section className="mb-8 rounded-lg border border-gray-800 bg-gray-950/60 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-gray-100">
                <Volume2 className="h-4 w-4 text-sky-300" />
                听力跟读
              </h3>
              <p className="mt-1 text-xs text-gray-500">模型 TTS 优先；逐句播放时可点击正文句子跳到该句继续播放。</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => playTTSItem({ key: 'work-full', text: paragraphs.join('\n\n'), paragraphIndex: null })}
                disabled={ttsLoadingKey === 'work-full' || paragraphs.length === 0}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                  ttsPlayingKey === 'work-full' ? 'border-sky-500 text-sky-300' : 'border-gray-700 text-gray-300 hover:bg-gray-900'
                }`}
              >
                {ttsLoadingKey === 'work-full' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                全文
              </button>
              <button
                type="button"
                onClick={() => playSentenceQueueFrom(0)}
                disabled={sentenceQueue.length === 0 || Boolean(ttsLoadingKey)}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                  ttsQueueIndex !== null ? 'border-sky-500 text-sky-300' : 'border-gray-700 text-gray-300 hover:bg-gray-900'
                }`}
              >
                <SkipForward className="h-4 w-4" />
                逐句
              </button>
              <button
                type="button"
                onClick={handlePauseOrResumeTTS}
                disabled={!ttsPlayingKey}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900 disabled:opacity-40"
              >
                {ttsPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                {ttsPaused ? '继续' : '暂停'}
              </button>
              <button
                type="button"
                onClick={stopTTS}
                disabled={!ttsPlayingKey && !ttsLoadingKey}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900 disabled:opacity-40"
              >
                <Square className="h-4 w-4" />
                停止
              </button>
              <button
                type="button"
                onClick={() => {
                  setIntensiveMode((value) => !value);
                  setShowTranslation(false);
                  closeAnalysis();
                  clearHighlight();
                  setActiveIntensiveParagraph(null);
                }}
                className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-semibold ${
                  intensiveMode ? 'border-blue-500 bg-blue-950/50 text-blue-100' : 'border-gray-700 text-gray-300 hover:bg-gray-900'
                }`}
              >
                <Eye className="h-4 w-4" />
                {intensiveMode ? '精读中' : '精读模式'}
              </button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <label className="inline-flex items-center gap-2 text-gray-400">
              <Volume2 className="h-4 w-4" />
              <select value={ttsVoice} onChange={(event) => setTtsVoice(event.target.value)} className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-200">
                {ttsVoices.map((voice) => <option key={voice} value={voice}>{voice}</option>)}
              </select>
            </label>
            <label className="inline-flex items-center gap-2 text-gray-400">
              <Gauge className="h-4 w-4" />
              <select value={ttsRate} onChange={(event) => setTtsRate(Number(event.target.value))} className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-200">
                {ttsRates.map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
              </select>
            </label>
            {ttsLoadingKey && <span className="inline-flex items-center gap-2 text-sky-300"><Loader2 className="h-4 w-4 animate-spin" />生成音频中</span>}
            {ttsPlayingKey && !ttsPaused && <span className="text-sky-300">正在播放</span>}
            {ttsError && <span className="text-amber-300">{ttsError}</span>}
          </div>
        </section>

        <div className="space-y-8">
          {paragraphs.map((paragraph, index) => {
            const paragraphTranslation = paragraphTranslations[index];
            const paragraphSentences = splitSentences(paragraph);
            return (
              <section key={`${index}-${paragraph.slice(0, 30)}`} className="group rounded-lg border border-transparent transition-colors hover:border-gray-800 hover:bg-gray-950/30 sm:p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <p
                    onClick={(event) => handleParagraphClick(event, paragraph)}
                    onMouseUp={() => handleTextSelection(paragraph)}
                    className="flex-1 cursor-text whitespace-pre-wrap text-xl font-medium leading-10 text-gray-200"
                  >
                    {renderParagraph(paragraph, index)}
                  </p>
                  <div className="flex shrink-0 items-center gap-2 sm:pt-1">
                    <button
                      type="button"
                      onClick={() => handleTranslateParagraph(index, paragraph)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 px-3 py-1.5 text-sm font-semibold text-gray-300 hover:bg-gray-900"
                    >
                      {paragraphTranslation?.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
                      {paragraphTranslation?.text ? '隐藏' : '翻译'}
                    </button>
                    <button
                      type="button"
                      onClick={() => playParagraphQueueFrom(index, paragraph)}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold hover:bg-gray-900 ${
                        speakingIndex === index ? 'border-sky-500 text-sky-300' : 'border-gray-700 text-gray-300'
                      }`}
                    >
                      {ttsLoadingKey === `paragraph-${index}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
                      {speakingIndex === index ? '停止' : '朗读'}
                    </button>
                    {intensiveMode && (
                      <button
                        type="button"
                        onClick={() => handleAnalyzeParagraph(paragraph, index)}
                        disabled={analysisLoading && activeIntensiveParagraph === index}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                          activeIntensiveParagraph === index ? 'border-blue-500 bg-blue-950/50 text-blue-100' : 'border-gray-700 text-gray-300 hover:bg-gray-900'
                        }`}
                      >
                        {analysisLoading && activeIntensiveParagraph === index ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                        精读
                      </button>
                    )}
                  </div>
                </div>

                {activeIntensiveParagraph === index && intensiveMode && (
                  <div className="mt-4 space-y-3 rounded-lg border border-gray-800 bg-gray-950/70 p-4">
                    {paragraphSentences.map((sentence, sentenceIndex) => {
                      const analysisKey = `paragraph-${index}-${sentenceIndex}`;
                      const isActive = activeAnalysisKey === analysisKey;
                      return (
                        <div key={analysisKey}>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <p className="text-sm leading-7 text-gray-400">{sentence}</p>
                            <button
                              type="button"
                              onClick={() => handleAnalyzeSentence(sentence, analysisKey)}
                              disabled={analysisLoading && isActive}
                              className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                                isActive ? 'border-blue-500 bg-blue-950/50 text-blue-100' : 'border-gray-700 text-gray-300 hover:bg-gray-900'
                              }`}
                            >
                              {analysisLoading && isActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                              精读
                            </button>
                          </div>
                          {renderAnalysisPanel(analysisKey)}
                        </div>
                      );
                    })}
                  </div>
                )}

                {(paragraphTranslation?.text || paragraphTranslation?.error) && (
                  <div className="mt-4 rounded-lg border border-gray-800 bg-gray-900/60 p-4 text-base leading-8 text-gray-300">
                    {paragraphTranslation.text || paragraphTranslation.error}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {chapterList.length > 1 && (
          <div className="mt-10 flex items-center justify-between border-t border-gray-800 pt-6">
            <button
              type="button"
              onClick={() => changeChapter(currentChapterIndex - 1)}
              disabled={currentChapterIndex <= 0}
              className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900 disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" />
              上一章
            </button>
            <span className="text-sm text-gray-500">
              {currentChapterIndex + 1} / {chapterList.length}
            </span>
            <button
              type="button"
              onClick={() => changeChapter(currentChapterIndex + 1)}
              disabled={currentChapterIndex >= chapterList.length - 1}
              className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900 disabled:opacity-40"
            >
              下一章
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="mt-8 rounded-lg border border-gray-800 bg-gray-900/40 p-5 text-sm text-gray-500">
          阅读提示：点击任意英文单词可查词；划选短语或句子可翻译；双击句子可朗读；打开精读模式后可逐句分析。
        </div>

        {showTranslation && selectedText && (
          <TranslationTooltip
            selectedText={selectedText}
            position={tooltipPosition}
            onClose={() => {
              setShowTranslation(false);
              clearHighlight();
            }}
            mode={tooltipMode}
            context={tooltipContext}
            existingVocabulary={selectedVocabulary}
            onWordAdded={(word) => {
              const normalized = normalizeWord(word);
              if (!normalized) return;
              setVocabularyByWord((prev) => {
                const next = new Map(prev);
                next.set(normalized, {
                  id: 0,
                  user_id: 0,
                  word,
                  translation: '',
                  is_learned: false,
                  review_count: 0,
                  forgotten_count: 0,
                  review_interval: 0,
                  review_ease: 2.5,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                });
                return next;
              });
            }}
            onWordRemoved={(word) => {
              const normalized = normalizeWord(word);
              if (!normalized) return;
              setVocabularyByWord((prev) => {
                const next = new Map(prev);
                next.delete(normalized);
                return next;
              });
            }}
            onVocabularyReviewed={(vocabulary) => {
              const normalized = normalizeWord(vocabulary.word);
              if (!normalized) return;
              setVocabularyByWord((prev) => {
                const next = new Map(prev);
                next.set(normalized, vocabulary);
                return next;
              });
            }}
          />
        )}
      </article>
    </div>
  );
}
