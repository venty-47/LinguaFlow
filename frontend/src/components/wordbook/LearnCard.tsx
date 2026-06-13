'use client';

import { useState, useEffect, useRef, useCallback, FormEvent } from 'react';
import { Volume2, Volume1, Brain, MessageCircle, Send, Loader2, X } from 'lucide-react';
import { playWordAudio, preloadUpcoming, playSentenceAudio } from '@/lib/wordAudio';
import { wordBookAPI } from '@/lib/api';

interface LearnCardDefinition {
  pos: string;
  definition: string;
}

interface LearnCardExample {
  en: string;
  zh: string;
}

interface LearnCardProps {
  word: string;
  phonetic?: string;
  uk_phonetic?: string;
  us_phonetic?: string;
  translation?: string;
  definitions?: string;
  examples?: string;
  collocations?: string;
  onRating: (rating: 'good' | 'hard' | 'forgot') => void;
  disabled?: boolean;
  upcomingWords?: string[];
  entryId?: number;
  bookId?: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function parseJSON<T>(value: string | undefined | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export default function LearnCard({
  word,
  phonetic,
  uk_phonetic,
  us_phonetic,
  translation,
  definitions,
  examples,
  collocations,
  onRating,
  disabled,
  upcomingWords = [],
  entryId,
  bookId,
}: LearnCardProps) {
  const [flipped, setFlipped] = useState(false);
  const lastWordRef = useRef('');

  // AI 助记
  const [mnemonic, setMnemonic] = useState('');
  const [mnemonicLoading, setMnemonicLoading] = useState(false);
  const [showMnemonic, setShowMnemonic] = useState(false);

  // AI 对话
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const defs = parseJSON<LearnCardDefinition[]>(definitions, []);
  const exs = parseJSON<LearnCardExample[]>(examples, []);
  const colls = parseJSON<string[]>(collocations, []);

  const hasAI = Boolean(entryId && bookId);

  // 单词切换时：重置 AI 状态 + 自动播放 + 预加载
  useEffect(() => {
    if (word && word !== lastWordRef.current) {
      lastWordRef.current = word;
      setFlipped(false);
      setMnemonic('');
      setShowMnemonic(false);
      setShowChat(false);
      setChatMessages([]);
      setChatInput('');

      const timer = setTimeout(() => {
        playWordAudio(word, 'us');
      }, 150);

      preloadUpcoming(upcomingWords, 'us', 3);

      return () => clearTimeout(timer);
    }
  }, [word, upcomingWords]);

  // 加载助记
  const loadMnemonic = useCallback(async () => {
    if (!hasAI || mnemonicLoading) return;
    if (mnemonic) {
      setShowMnemonic(true);
      return;
    }
    try {
      setMnemonicLoading(true);
      const res = await wordBookAPI.getMnemonic(bookId!, entryId!);
      setMnemonic(res.data.data?.mnemonic || res.data.mnemonic || '');
      setShowMnemonic(true);
    } catch {
      setMnemonic('AI 助记加载失败');
      setShowMnemonic(true);
    } finally {
      setMnemonicLoading(false);
    }
  }, [hasAI, mnemonicLoading, mnemonic, bookId, entryId]);

  // 发送聊天消息
  const sendChat = useCallback(async (e?: FormEvent) => {
    e?.preventDefault();
    if (!hasAI || chatSending || !chatInput.trim()) return;

    const userMessage: ChatMessage = { role: 'user', content: chatInput.trim() };
    const nextMessages = [...chatMessages, userMessage];
    setChatMessages(nextMessages);
    setChatInput('');
    setChatSending(true);

    try {
      const res = await wordBookAPI.chatWithEntry(bookId!, entryId!, {
        messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
      });
      const content = res.data.data?.content || '';
      setChatMessages((prev) => [...prev, { role: 'assistant', content }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: '回复失败，请重试' }]);
    } finally {
      setChatSending(false);
    }
  }, [hasAI, chatSending, chatInput, chatMessages, bookId, entryId]);

  // 自动滚动到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleRating = (rating: 'good' | 'hard' | 'forgot') => {
    if (disabled) return;
    onRating(rating);
    setFlipped(false);
  };

  const handlePlay = (e: React.MouseEvent, accent: 'uk' | 'us') => {
    e.stopPropagation();
    playWordAudio(word, accent);
  };

  return (
    <div className="flex flex-col items-center gap-4">
      {/* 翻牌区域 */}
      <div
        className="relative w-full max-w-md cursor-pointer"
        style={{ perspective: '1000px' }}
        onClick={() => setFlipped(!flipped)}
      >
        <div
          className="relative w-full transition-transform duration-500"
          style={{
            transformStyle: 'preserve-3d',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          {/* 正面:单词 */}
          <div
            className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <h2 className="mb-4 text-4xl font-black text-gray-950 dark:text-gray-100">
              {word}
            </h2>

            <div className="mb-6 flex items-center gap-6">
              {uk_phonetic && (
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1.5 text-sm text-sky-700 transition-colors hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-400 dark:hover:bg-sky-500/20"
                  onClick={(e) => handlePlay(e, 'uk')}
                >
                  <span className="text-xs font-semibold uppercase tracking-wide">英</span>
                  <span className="text-sm">{uk_phonetic}</span>
                  <Volume2 className="h-3.5 w-3.5" />
                </button>
              )}
              {us_phonetic && (
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1.5 text-sm text-orange-700 transition-colors hover:bg-orange-100 dark:bg-orange-500/10 dark:text-orange-400 dark:hover:bg-orange-500/20"
                  onClick={(e) => handlePlay(e, 'us')}
                >
                  <span className="text-xs font-semibold uppercase tracking-wide">美</span>
                  <span className="text-sm">{us_phonetic}</span>
                  <Volume2 className="h-3.5 w-3.5" />
                </button>
              )}
              {!uk_phonetic && !us_phonetic && phonetic && (
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-sm text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20"
                  onClick={(e) => handlePlay(e, 'us')}
                >
                  <span className="text-sm">{phonetic}</span>
                  <Volume2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <p className="text-sm text-gray-400 dark:text-gray-500">
              点击卡片查看释义
            </p>
          </div>

          {/* 背面:释义 */}
          <div
            className="absolute inset-0 flex min-h-[360px] flex-col overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900"
            style={{
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
          >
            <div className="mb-3 flex items-center gap-3">
              <h3 className="text-2xl font-bold text-gray-950 dark:text-gray-100">
                {word}
              </h3>
              <div className="flex items-center gap-2">
                {uk_phonetic && (
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700 hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-400"
                    onClick={(e) => handlePlay(e, 'uk')}
                  >
                    <span className="font-semibold">英</span>
                    <Volume2 className="h-3 w-3" />
                  </button>
                )}
                {us_phonetic && (
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-700 hover:bg-orange-100 dark:bg-orange-500/10 dark:text-orange-400"
                    onClick={(e) => handlePlay(e, 'us')}
                  >
                    <span className="font-semibold">美</span>
                    <Volume2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
            {translation && (
              <p className="mb-4 text-lg font-medium text-blue-600 dark:text-blue-400">
                {translation}
              </p>
            )}

            {defs.length > 0 && (
              <div className="mb-4 space-y-2">
                {defs.map((d, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      {d.pos}
                    </span>
                    <span className="text-gray-700 dark:text-gray-300">{d.definition}</span>
                  </div>
                ))}
              </div>
            )}

            {exs.length > 0 && (
              <div className="mb-4 space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  例句
                </h4>
                {exs.map((ex, i) => (
                  <div key={i} className="text-sm">
                    <div className="flex items-start gap-1.5">
                      <p className="flex-1 text-gray-800 dark:text-gray-200">{ex.en}</p>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); playSentenceAudio(ex.en); }}
                        className="mt-0.5 shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-500 dark:hover:bg-gray-800 dark:hover:text-blue-400"
                        title="朗读例句"
                      >
                        <Volume1 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {ex.zh && (
                      <p className="mt-0.5 text-gray-500 dark:text-gray-400">{ex.zh}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {colls.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {colls.map((c, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI 工具栏：助记 + 对话按钮 */}
      {hasAI && (
        <div className="flex w-full max-w-md gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); loadMnemonic(); }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
              showMnemonic
                ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-600/50 dark:bg-amber-500/10 dark:text-amber-300'
                : 'border-gray-200 bg-white text-gray-500 hover:border-amber-300 hover:text-amber-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:border-amber-600/50 dark:hover:text-amber-400'
            }`}
          >
            {mnemonicLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Brain className="h-3.5 w-3.5" />
            )}
            {mnemonicLoading ? '生成中...' : showMnemonic ? '收起助记' : 'AI 助记'}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowChat(!showChat); }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
              showChat
                ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-600/50 dark:bg-blue-500/10 dark:text-blue-300'
                : 'border-gray-200 bg-white text-gray-500 hover:border-blue-300 hover:text-blue-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:border-blue-600/50 dark:hover:text-blue-400'
            }`}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {showChat ? '收起对话' : 'AI 对话'}
          </button>
        </div>
      )}

      {/* 助记展示区 */}
      {showMnemonic && mnemonic && (
        <div className="w-full max-w-md rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-600/30 dark:bg-amber-500/5">
          <div className="mb-1 flex items-center gap-1.5">
            <Brain className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            <span className="text-xs font-bold text-amber-700 dark:text-amber-300">AI 助记</span>
          </div>
          <p className="text-sm leading-6 text-amber-900 dark:text-amber-200">{mnemonic}</p>
        </div>
      )}

      {/* AI 对话面板 */}
      {showChat && (
        <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5 dark:border-gray-800">
            <span className="text-xs font-bold text-gray-600 dark:text-gray-300">
              关于「{word}」的 AI 对话
            </span>
            <button
              type="button"
              onClick={() => setShowChat(false)}
              className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto p-3">
            {chatMessages.length === 0 && (
              <p className="py-4 text-center text-xs text-gray-400 dark:text-gray-500">
                问任何关于「{word}」的问题：用法、搭配、近义词、词源...
              </p>
            )}
            {chatMessages.map((msg, i) => (
              <div
                key={i}
                className={`mb-2 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-5 ${
                    msg.role === 'user'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {chatSending && (
              <div className="flex justify-start">
                <div className="rounded-lg bg-gray-100 px-3 py-2 dark:bg-gray-800">
                  <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={sendChat} className="flex gap-2 border-t border-gray-100 p-3 dark:border-gray-800">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="输入问题..."
              disabled={chatSending}
              className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-blue-400 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={chatSending || !chatInput.trim()}
              className="rounded-lg bg-blue-500 px-3 py-2 text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}

      {/* 评分按钮 */}
      <div className="flex w-full max-w-md gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleRating('good')}
          className="flex-1 rounded-xl bg-emerald-500 px-4 py-3.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-emerald-600 disabled:opacity-50"
        >
          认识
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleRating('hard')}
          className="flex-1 rounded-xl bg-yellow-500 px-4 py-3.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-yellow-600 disabled:opacity-50"
        >
          模糊
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleRating('forgot')}
          className="flex-1 rounded-xl bg-red-500 px-4 py-3.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-red-600 disabled:opacity-50"
        >
          忘了
        </button>
      </div>
    </div>
  );
}
