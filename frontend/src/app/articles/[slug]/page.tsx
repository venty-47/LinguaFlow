'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import {
  Bot,
  BookmarkCheck,
  BookmarkPlus,
  ChevronLeft,
  CheckCircle2,
  FileText,
  Eye,
  Gauge,
  Languages,
  Loader2,
  Network,
  Pause,
  Play,
  Send,
  Share2,
  SkipForward,
  Square,
  Timer,
  Volume2,
  X,
  XCircle,
} from 'lucide-react';
import { articleAPI, isRemoteHTTPURL, resolveAPIAssetURL, subscriptionAPI, translationAPI, ttsAPI, vocabularyAPI } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import {
  Article,
  ArticleAssistantMessage,
  ArticleCompletion,
  ArticleKnowledgeGraph,
  ArticleKnowledgeGraphNode,
  ArticleQuiz,
  ArticleStudyNote,
  SentenceAnalysis,
  Subscription,
  Vocabulary,
} from '@/types';
import TranslationTooltip from '@/components/TranslationTooltip';

const difficultyLabels = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
};

const SAVED_SENTENCES_KEY = 'linguaflow:saved-sentences';
const ACTIVE_READING_IDLE_MS = 15000;
const ttsVoices = ['Mia', 'Chloe', 'Milo', 'Dean'];
const ttsRates = [0.75, 0.9, 1, 1.15, 1.3];
const sentenceAIPrompts = [
  { id: 'explain', label: '解释句子' },
  { id: 'grammar', label: '语法拆解' },
  { id: 'phrases', label: '词组搭配' },
  { id: 'rewrite', label: '改写仿写' },
  { id: 'speaking', label: '口语表达' },
  { id: 'quiz', label: '出题自测' },
] as const;

type SentenceAIPromptID = (typeof sentenceAIPrompts)[number]['id'];

function splitParagraphs(content?: string) {
  return (content || '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function normalizeWord(token: string) {
  return token.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').toLowerCase();
}

function getDictionaryWord(text: string) {
  if (/\s/.test(text.trim())) return '';

  const word = normalizeWord(text);
  if (!/^[a-z]+(?:['’][a-z]+)?$/.test(word)) return '';

  return word;
}

function getWordMatchFromPoint(x: number, y: number) {
  let node: Node | null = null;
  let offset = 0;
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number
    ) => { offsetNode: Node; offset: number } | null;
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

function getProgressCheckpoint(progress: number) {
  if (progress >= 96) return 100;
  if (progress >= 75) return 75;
  if (progress >= 50) return 50;
  if (progress >= 25) return 25;
  return 0;
}

function buildSentenceAIPrompt(promptID: SentenceAIPromptID, text: string, context?: string) {
  const targetText = text.trim();
  const contextText = context?.trim();
  const source = contextText && contextText !== targetText
    ? `句子：${targetText}\n\n上下文：${contextText}`
    : `句子：${targetText}`;

  switch (promptID) {
    case 'grammar':
      return `请面向中文英语学习者拆解下面句子的语法结构：\n\n${source}\n\n请按“主干、从句/非谓语、修饰成分、逻辑关系、容易误读点”解释，最后给一个自然中文译文。`;
    case 'phrases':
      return `请从下面句子中提炼值得学习的英文词组、搭配和句式：\n\n${source}\n\n每个词组请说明中文含义、在原句中的作用，并给一个简短英文例句。`;
    case 'rewrite':
      return `请帮我学习下面句子的表达方式：\n\n${source}\n\n请先解释句子的核心表达，再给 3 个不同难度的英文改写，最后给 2 个可套用的仿写模板。`;
    case 'speaking':
      return `请把下面句子转化成更适合口语表达的英文：\n\n${source}\n\n请给出自然口语版、正式书面版、中文解释，并标出可以替换练习的关键词。`;
    case 'quiz':
      return `请基于下面句子给我做英语学习自测：\n\n${source}\n\n请出 3 道题：1 道词义题、1 道语法理解题、1 道改写题。先给题目，不要直接给答案；最后用“答案：”列出简短答案。`;
    case 'explain':
    default:
      return contextText && contextText !== targetText
        ? `请结合这段上下文解释我选中的英文句子：\n\n${source}\n\n请说明自然中文意思、句子重点、学习难点。`
        : `请解释我选中的英文句子：\n\n${source}\n\n请说明自然中文意思、句子重点、学习难点。`;
  }
}

function buildPracticePrompt(type: string, article: Article, paragraphs: string[]) {
  const sample = paragraphs.slice(0, 2).join('\n\n').trim() || article.summary || article.title;

  switch (type) {
    case 'imitation':
      return `请基于这篇文章设计一个仿写练习。\n\n文章：${article.title}\n\n素材：${sample}\n\n请提炼 3 个可复用句式，每个句式给中文说明、原文模式、仿写任务和一个示例答案。`;
    case 'cn-en':
      return `请基于这篇文章做中译英复现练习。\n\n文章：${article.title}\n\n素材：${sample}\n\n请给 5 个中文提示，让我先翻译成英文；再在每题后提供参考答案和表达点评。`;
    case 'correction':
      return `我想做 AI 批改输出。请先根据这篇文章给我一个 80-120 词英文输出任务，然后告诉我提交答案后你会从准确度、语法、用词、自然度四方面批改。\n\n文章：${article.title}\n\n素材：${sample}`;
    case 'rewrite':
    default:
      return `请基于这篇文章设计一个改写练习。\n\n文章：${article.title}\n\n素材：${sample}\n\n请选 3 个原文句子或表达，给出改写目标、提示词和参考改写，并说明改写后的语气或结构变化。`;
  }
}

function parseAssistantStreamChunk(chunk: string) {
  const deltas: string[] = [];
  let done = false;
  let error = '';

  for (const event of chunk.split('\n\n')) {
    const lines = event.split('\n');
    const eventType = lines
      .find((line) => line.startsWith('event:'))
      ?.replace(/^event:\s*/, '')
      .trim();
    const dataLines = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace(/^data:\s?/, ''));

    if (dataLines.length === 0) continue;

    const data = dataLines.join('\n').trim();
    if (!data) continue;
    if (data === '[DONE]') {
      done = true;
      continue;
    }

    try {
      const payload = JSON.parse(data) as { delta?: string; error?: string };
      if (eventType === 'error' || payload.error) {
        error = payload.error || 'AI 助手暂时不可用';
      } else if (payload.delta) {
        deltas.push(payload.delta);
      }
    } catch {
      if (eventType === 'error') {
        error = data;
      }
    }
  }

  return { deltas, done, error };
}

function AssistantMessageContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-bold text-gray-100">{children}</strong>,
        em: ({ children }) => <em className="italic text-gray-100">{children}</em>,
        ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
        li: ({ children }) => <li className="pl-1">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="mb-3 border-l-2 border-sky-700 pl-3 text-gray-300 last:mb-0">
            {children}
          </blockquote>
        ),
        code: ({ children }) => (
          <code className="rounded border border-gray-700 bg-gray-950 px-1.5 py-0.5 font-mono text-[0.92em] text-sky-100">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="mb-3 overflow-x-auto rounded-md border border-gray-800 bg-gray-950 p-3 text-xs leading-6 text-gray-200 last:mb-0">
            {children}
          </pre>
        ),
        h1: ({ children }) => <h3 className="mb-3 text-base font-bold text-gray-100">{children}</h3>,
        h2: ({ children }) => <h3 className="mb-3 text-base font-bold text-gray-100">{children}</h3>,
        h3: ({ children }) => <h3 className="mb-2 text-sm font-bold text-gray-100">{children}</h3>,
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-sky-300 underline decoration-sky-700 underline-offset-2"
          >
            {children}
          </a>
        ),
        hr: () => <hr className="my-3 border-gray-800" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

const articleGraphTypeLabels: Record<string, string> = {
  article: '文章',
  topic: '主题',
  structure: '结构',
  word: '词汇',
  grammar: '语法',
  sentence: '长难句',
  review: '复习',
};

const articleGraphTypeClasses: Record<string, string> = {
  article: 'border-sky-500/60 bg-sky-500/10 text-sky-100',
  topic: 'border-cyan-500/50 bg-cyan-500/10 text-cyan-100',
  structure: 'border-slate-500/50 bg-slate-500/10 text-slate-100',
  word: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-100',
  grammar: 'border-indigo-500/50 bg-indigo-500/10 text-indigo-100',
  sentence: 'border-amber-500/50 bg-amber-500/10 text-amber-100',
  review: 'border-red-500/50 bg-red-500/10 text-red-100',
};

function masteryDotClass(value?: number) {
  if (value === undefined) return 'bg-gray-600';
  if (value >= 75) return 'bg-green-400';
  if (value >= 45) return 'bg-amber-400';
  return 'bg-red-400';
}

function ArticleKnowledgeGraphModal({
  graph,
  loading,
  error,
  activeNodeID,
  onActiveNodeChange,
  onClose,
  onAction,
}: {
  graph: ArticleKnowledgeGraph | null;
  loading: boolean;
  error: string;
  activeNodeID: string;
  onActiveNodeChange: (id: string) => void;
  onClose: () => void;
  onAction: (href?: string, focusNodeID?: string) => void;
}) {
  const activeNode = useMemo(() => {
    if (!graph) return null;
    if (graph.article.id === activeNodeID) return graph.article;
    for (const lane of graph.lanes) {
      const node = lane.nodes.find((item) => item.id === activeNodeID);
      if (node) return node;
    }
    return graph.article;
  }, [activeNodeID, graph]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 px-4 py-6 backdrop-blur-sm">
      <div className="mx-auto flex max-h-[calc(100vh-3rem)] max-w-6xl flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-950 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-800 p-4 sm:p-5">
          <div>
            <p className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-sky-300">
              <Network className="h-4 w-4" />
              文章知识图谱
            </p>
            <h2 className="text-xl font-black text-gray-100 sm:text-2xl">
              {graph?.article.label || '学习地图'}
            </h2>
            {graph && (
              <p className="mt-2 text-sm text-gray-500">
                {graph.stats.total_nodes} 节点 · {graph.stats.grammar_count} 语法 · {graph.stats.vocabulary_count} 词汇 · {graph.stats.sentence_count} 长难句
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-700 p-2 text-gray-400 hover:bg-gray-900 hover:text-gray-100"
            aria-label="关闭知识图谱"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 sm:p-5">
          {loading ? (
            <div className="flex min-h-96 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-sky-400" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-5 text-red-100">
              {error}
            </div>
          ) : graph ? (
            <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
              <aside className="space-y-4">
                <button
                  type="button"
                  onClick={() => onActiveNodeChange(graph.article.id)}
                  className={`w-full rounded-lg border p-4 text-left ${articleGraphTypeClasses.article} ${
                    activeNodeID === graph.article.id ? 'ring-2 ring-sky-300/70' : ''
                  }`}
                >
                  <p className="mb-2 text-xs font-semibold opacity-80">中心文章</p>
                  <h3 className="text-lg font-bold leading-6">{graph.article.label}</h3>
                  {graph.article.description && (
                    <p className="mt-2 line-clamp-4 text-sm leading-6 opacity-80">{graph.article.description}</p>
                  )}
                </button>

                {graph.actions.length > 0 && (
                  <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
                    <h3 className="mb-3 text-sm font-bold text-gray-200">建议动作</h3>
                    <div className="space-y-2">
                      {graph.actions.map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          onClick={() => onAction(action.href, action.focus_node_id)}
                          className="block w-full rounded-md border border-gray-800 bg-gray-950/60 p-3 text-left hover:border-sky-500/60"
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-gray-100">{action.title}</span>
                            <span className="rounded bg-gray-800 px-2 py-1 text-[11px] text-gray-300">
                              {action.priority}
                            </span>
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-gray-500">{action.description}</span>
                          <span className="mt-2 block text-xs font-semibold text-sky-300">{action.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {activeNode && (
                  <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
                    <p className="mb-2 text-xs font-semibold text-gray-500">
                      {articleGraphTypeLabels[activeNode.type] || activeNode.type}
                    </p>
                    <h3 className="break-words text-lg font-bold text-gray-100">{activeNode.label}</h3>
                    {activeNode.description && (
                      <p className="mt-2 text-sm leading-6 text-gray-400">{activeNode.description}</p>
                    )}
                    {activeNode.mastery !== undefined && (
                      <p className="mt-3 flex items-center gap-2 text-sm text-gray-300">
                        <span className={`h-2.5 w-2.5 rounded-full ${masteryDotClass(activeNode.mastery)}`} />
                        掌握度 {activeNode.mastery}
                      </p>
                    )}
                  </div>
                )}
              </aside>

              <div className="space-y-4">
                {graph.lanes.map((lane) => (
                  <section key={lane.id} className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
                    <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <h3 className="text-base font-bold text-gray-100">{lane.title}</h3>
                        <p className="text-xs text-gray-500">{lane.description}</p>
                      </div>
                      <span className="text-xs text-gray-600">{lane.nodes.length} 个节点</span>
                    </div>

                    {lane.nodes.length === 0 ? (
                      <p className="rounded-md border border-dashed border-gray-800 p-4 text-sm text-gray-600">
                        暂无数据。阅读、查词或保存生词后这里会自动补全。
                      </p>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {lane.nodes.map((node) => (
                          <button
                            key={node.id}
                            type="button"
                            onClick={() => onActiveNodeChange(node.id)}
                            className={`min-h-28 rounded-lg border p-3 text-left transition-colors hover:border-sky-400/70 ${
                              articleGraphTypeClasses[node.type] || 'border-gray-700 bg-gray-900 text-gray-100'
                            } ${activeNodeID === node.id ? 'ring-2 ring-sky-300/70' : ''}`}
                          >
                            <span className="mb-2 flex items-center justify-between gap-2">
                              <span className="rounded bg-black/20 px-2 py-1 text-[11px] font-semibold">
                                {articleGraphTypeLabels[node.type] || node.type}
                              </span>
                              {node.mastery !== undefined && (
                                <span className="flex items-center gap-1 text-[11px] font-semibold">
                                  <span className={`h-2 w-2 rounded-full ${masteryDotClass(node.mastery)}`} />
                                  {node.mastery}
                                </span>
                              )}
                            </span>
                            <span className="block break-words text-sm font-bold leading-5">{node.label}</span>
                            {node.description && (
                              <span className="mt-2 line-clamp-3 block text-xs leading-5 opacity-80">
                                {node.description}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function ArticlePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = params.slug as string;
  const { isAuthenticated } = useAuthStore();

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showTranslation, setShowTranslation] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [tooltipMode, setTooltipMode] = useState<'translate' | 'dictionary'>('dictionary');
  const [tooltipContext, setTooltipContext] = useState('');
  const [showChinese, setShowChinese] = useState(false);
  const [intensiveMode, setIntensiveMode] = useState(false);
  const [readProgress, setReadProgress] = useState(0);
  const [progressCheckpoint, setProgressCheckpoint] = useState(0);
  const [isFavorited, setIsFavorited] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [paragraphTranslations, setParagraphTranslations] = useState<
    Record<number, { loading: boolean; text?: string; error?: string }>
  >({});
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [ttsVoice, setTtsVoice] = useState('Chloe');
  const [ttsRate, setTtsRate] = useState(0.9);
  const [ttsLoadingKey, setTtsLoadingKey] = useState('');
  const [ttsPlayingKey, setTtsPlayingKey] = useState('');
  const [ttsPaused, setTtsPaused] = useState(false);
  const [ttsQueueIndex, setTtsQueueIndex] = useState<number | null>(null);
  const [ttsError, setTtsError] = useState('');
  const [vocabularyByWord, setVocabularyByWord] = useState<Map<string, Vocabulary>>(new Map());
  const [completion, setCompletion] = useState<ArticleCompletion | null>(null);
  const [completionLoading, setCompletionLoading] = useState(false);
  const [studyNote, setStudyNote] = useState<ArticleStudyNote | null>(null);
  const [studyNoteLoading, setStudyNoteLoading] = useState(false);
  const [studyNoteError, setStudyNoteError] = useState('');
  const [knowledgeGraphOpen, setKnowledgeGraphOpen] = useState(false);
  const [knowledgeGraph, setKnowledgeGraph] = useState<ArticleKnowledgeGraph | null>(null);
  const [knowledgeGraphLoading, setKnowledgeGraphLoading] = useState(false);
  const [knowledgeGraphError, setKnowledgeGraphError] = useState('');
  const [activeKnowledgeNodeID, setActiveKnowledgeNodeID] = useState('');
  const [quiz, setQuiz] = useState<ArticleQuiz | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizSubmitting, setQuizSubmitting] = useState(false);
  const [quizError, setQuizError] = useState('');
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [sentenceAnalysis, setSentenceAnalysis] = useState<SentenceAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [analysisRequiresPremium, setAnalysisRequiresPremium] = useState(false);
  const [activeAnalysisKey, setActiveAnalysisKey] = useState('');
  const [analysisSelection, setAnalysisSelection] = useState<{
    key: string;
    text: string;
    context: string;
    paragraphIndex: number;
  } | null>(null);
  const [activeIntensiveParagraph, setActiveIntensiveParagraph] = useState<number | null>(null);
  const [savedSentenceKeys, setSavedSentenceKeys] = useState<Set<string>>(new Set());
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantMessages, setAssistantMessages] = useState<ArticleAssistantMessage[]>([]);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState('');
  const [assistantRequiresPremium, setAssistantRequiresPremium] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const activeReadSecondsRef = useRef(0);
  const lastActiveTickRef = useRef(Date.now());
  const lastReadingSignalRef = useRef(0);
  const readProgressRef = useRef(0);
  const lastSyncedProgressRef = useRef(0);
  const sentenceElementRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsRequestIdRef = useRef(0);
  const ttsQueueIndexRef = useRef<number | null>(null);
  const assistantEndRef = useRef<HTMLDivElement | null>(null);
  const loadedPracticeRef = useRef('');

  const englishParagraphs = useMemo(() => splitParagraphs(article?.content), [article]);
  const chineseParagraphs = useMemo(() => splitParagraphs(article?.content_cn), [article]);
  const sentenceQueue = useMemo(() => buildSentenceQueue(englishParagraphs), [englishParagraphs]);
  const practiceParam = searchParams.get('practice') || '';

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

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED_SENTENCES_KEY) || '[]') as Array<{
        article_id: number;
        sentence: string;
      }>;
      setSavedSentenceKeys(new Set(saved.map((item) => `${item.article_id}:${item.sentence}`)));
    } catch (err) {
      console.error('Failed to load saved sentences:', err);
    }
  }, []);
  const highlightedVocabularyCount = useMemo(() => {
    const matchedWords = new Set<string>();
    englishParagraphs.forEach((paragraph) => {
      tokenizeParagraph(paragraph).forEach((token) => {
        const word = normalizeWord(token);
        if (word && vocabularyByWord.has(word)) {
          matchedWords.add(word);
        }
      });
    });
    return matchedWords.size;
  }, [englishParagraphs, vocabularyByWord]);

  const markReadingActive = useCallback(() => {
    if (document.visibilityState === 'hidden') return;
    lastReadingSignalRef.current = Date.now();
  }, []);

  const syncProgress = useCallback(
    async (force = false) => {
      if (!article || !isAuthenticated) return;

      const currentProgress = readProgressRef.current;
      const checkpoint = getProgressCheckpoint(currentProgress);
      const progress = force ? (currentProgress >= 96 ? 100 : Math.round(currentProgress)) : checkpoint;
      const readTime = Math.floor(activeReadSecondsRef.current);

      if (progress <= 0 || readTime <= 0) {
        return;
      }

      if (!force && progress <= lastSyncedProgressRef.current) {
        return;
      }

      if (force && progress <= lastSyncedProgressRef.current && readTime < 60) {
        return;
      }

      try {
        await articleAPI.updateReadProgress(article.id, {
          progress,
          read_time: readTime,
        });
        lastSyncedProgressRef.current = progress;
        activeReadSecondsRef.current = 0;
      } catch (err) {
        console.error('Failed to sync read progress:', err);
      }
    },
    [article, isAuthenticated]
  );

  const fetchQuiz = useCallback(async (articleID: number) => {
    try {
      setQuizLoading(true);
      setQuizError('');
      const response = await articleAPI.getQuiz(articleID);
      const nextQuiz = response.data.data as ArticleQuiz;
      setQuiz(nextQuiz);
      if (nextQuiz.latest_attempt?.answers) {
        const answers = nextQuiz.latest_attempt.answers.reduce<Record<number, number>>((acc, answer, index) => {
          const question = nextQuiz.questions[index];
          if (question) {
            acc[question.id] = answer;
          }
          return acc;
        }, {});
        setQuizAnswers(answers);
      }
    } catch (err: any) {
      console.error('Failed to fetch article quiz:', err);
      setQuizError(err.response?.data?.error || '读后测验加载失败');
    } finally {
      setQuizLoading(false);
    }
  }, []);

  const generateStudyNote = useCallback(async (articleID: number, force = false) => {
    try {
      setStudyNoteLoading(true);
      setStudyNoteError('');
      const response = await articleAPI.generateStudyNote(articleID, force);
      setStudyNote(response.data.data as ArticleStudyNote);
    } catch (err: any) {
      console.error('Failed to generate study note:', err);
      setStudyNoteError(err.response?.data?.error || '精读笔记生成失败');
    } finally {
      setStudyNoteLoading(false);
    }
  }, []);

  useEffect(() => {
    const fetchArticle = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await articleAPI.getArticleBySlug(slug);
        setArticle(response.data.data);
      } catch (err: any) {
        setError(err.response?.data?.error || '文章加载失败');
      } finally {
        setLoading(false);
      }
    };

    if (slug) fetchArticle();
  }, [slug]);

  useEffect(() => {
    if (!article || !isAuthenticated) return;

    const fetchUserArticleData = async () => {
      try {
        const [subscriptionsResponse, vocabularyResponse] = await Promise.all([
          subscriptionAPI.getSubscriptions(),
          vocabularyAPI.getVocabulary(),
        ]);
        const subscriptions = subscriptionsResponse.data.data as Subscription[];
        const vocabulary = vocabularyResponse.data.data as Vocabulary[];
        setIsFavorited(subscriptions.some((item) => item.article_id === article.id));
        setVocabularyByWord(
          new Map(
            vocabulary
              .map((item) => [normalizeWord(item.word), item] as const)
              .filter(([word]) => Boolean(word))
          )
        );
      } catch (err) {
        console.error('Failed to fetch user article data:', err);
      }
    };

    fetchUserArticleData();
  }, [article, isAuthenticated]);

  useEffect(() => {
    if (!article || !isAuthenticated || readProgress < 99 || completion || completionLoading) return;

    const fetchCompletion = async () => {
      try {
        setCompletionLoading(true);
        await syncProgress(true);
        const response = await articleAPI.getCompletion(article.id);
        const completionData = response.data.data as ArticleCompletion;
        setCompletion(completionData);
        if (completionData.study_note) {
          setStudyNote(completionData.study_note);
        }
        fetchQuiz(article.id);
      } catch (err) {
        console.error('Failed to fetch completion summary:', err);
      } finally {
        setCompletionLoading(false);
      }
    };

    fetchCompletion();
  }, [article, completion, completionLoading, fetchQuiz, isAuthenticated, readProgress, syncProgress]);

  useEffect(() => {
    if (!article || !isAuthenticated) return;

    lastActiveTickRef.current = Date.now();
    const interval = window.setInterval(() => {
      const now = Date.now();
      const elapsedSeconds = Math.min(5, Math.max(0, (now - lastActiveTickRef.current) / 1000));
      lastActiveTickRef.current = now;

      const hasRecentSignal = now - lastReadingSignalRef.current <= ACTIVE_READING_IDLE_MS;
      const ttsActive = Boolean(ttsPlayingKey && !ttsPaused);
      if (document.visibilityState === 'visible' && (hasRecentSignal || ttsActive)) {
        activeReadSecondsRef.current += elapsedSeconds;
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [article, isAuthenticated, ttsPaused, ttsPlayingKey]);

  useEffect(() => {
    if (!article) return;

    const handleActivity = () => {
      markReadingActive();
    };
    const handleVisibilityChange = () => {
      lastActiveTickRef.current = Date.now();
    };

    window.addEventListener('scroll', handleActivity, { passive: true });
    document.addEventListener('selectionchange', handleActivity);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('scroll', handleActivity);
      document.removeEventListener('selectionchange', handleActivity);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [article, markReadingActive]);

  useEffect(() => {
    const handleScroll = () => {
      if (!contentRef.current) return;

      const rect = contentRef.current.getBoundingClientRect();
      const contentTop = window.scrollY + rect.top;
      const contentHeight = contentRef.current.offsetHeight;
      const viewportBottom = window.scrollY + window.innerHeight;
      const rawProgress = ((viewportBottom - contentTop) / contentHeight) * 100;
      const nextProgress = Math.min(100, Math.max(0, rawProgress));
      readProgressRef.current = nextProgress;
      setReadProgress(nextProgress);
      setProgressCheckpoint(getProgressCheckpoint(nextProgress));
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [article, markReadingActive]);

  useEffect(() => {
    syncProgress();
  }, [progressCheckpoint, syncProgress]);

  useEffect(() => {
    const syncBeforeLeaving = () => {
      syncProgress(true);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        syncBeforeLeaving();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', syncBeforeLeaving);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', syncBeforeLeaving);
      syncBeforeLeaving();
    };
  }, [syncProgress]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
      clearHighlight();
    };
  }, []);

  useEffect(() => {
    if (!assistantOpen) return;
    assistantEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [assistantOpen, assistantMessages, assistantLoading]);

  useEffect(() => {
    if (!article) return;

    const practice = practiceParam;
    if (!practice) return;
    const practiceKey = `${article.id}:${practice}`;
    if (loadedPracticeRef.current === practiceKey) return;

    const allowed = new Set(['rewrite', 'imitation', 'cn-en', 'correction']);
    if (!allowed.has(practice)) return;

    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    setAssistantOpen(true);
    setAssistantError('');
    setAssistantRequiresPremium(false);
    if (assistantMessages.length === 0) {
      setAssistantMessages([
        {
          role: 'assistant',
          content: '我已经准备好和你讨论这篇文章。可以问我文章主旨、段落逻辑、难句、词组或延伸思考。',
        },
      ]);
    }
    setAssistantInput(buildPracticePrompt(practice, article, englishParagraphs));
    loadedPracticeRef.current = practiceKey;
    markReadingActive();
  }, [
    article,
    assistantMessages.length,
    englishParagraphs,
    isAuthenticated,
    markReadingActive,
    practiceParam,
    router,
  ]);

  const clearHighlight = () => {
    window.getSelection()?.removeAllRanges();
  };

  const applyHighlight = (range: Range) => {
    clearHighlight();

    try {
      const selection = window.getSelection();
      if (selection) {
        selection.addRange(range);
      }
      return true;
    } catch (err) {
      console.error('Failed to apply highlight:', err);
      return false;
    }
  };

  const handleFavoriteArticle = async () => {
    if (!article) return;

    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    try {
      setFavoriteLoading(true);
      if (isFavorited) {
        await subscriptionAPI.removeSubscription(article.id);
        setIsFavorited(false);
      } else {
        await subscriptionAPI.addSubscription(article.id);
        setIsFavorited(true);
      }
    } catch (err) {
      console.error('Failed to update favorite article:', err);
    } finally {
      setFavoriteLoading(false);
    }
  };

  const handleShare = async () => {
    if (!article) return;

    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: article.title, url });
      return;
    }

    await navigator.clipboard.writeText(url);
  };

  const openKnowledgeGraph = async () => {
    if (!article) return;
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    setKnowledgeGraphOpen(true);
    if (knowledgeGraph && knowledgeGraph.article.metadata?.article_id === article.id) {
      return;
    }

    try {
      setKnowledgeGraphLoading(true);
      setKnowledgeGraphError('');
      const response = await articleAPI.getKnowledgeGraph(article.id);
      const nextGraph = response.data.data as ArticleKnowledgeGraph;
      setKnowledgeGraph(nextGraph);
      setActiveKnowledgeNodeID(nextGraph.article.id);
    } catch (err: any) {
      console.error('Failed to load article knowledge graph:', err);
      setKnowledgeGraphError(err.response?.data?.error || '文章知识图谱加载失败');
    } finally {
      setKnowledgeGraphLoading(false);
    }
  };

  const handleSubmitQuiz = async () => {
    if (!article || !quiz || quizSubmitting) return;

    const answers = quiz.questions.map((question) => quizAnswers[question.id]);
    if (answers.some((answer) => answer === undefined)) {
      setQuizError('请先完成所有题目');
      return;
    }

    try {
      setQuizSubmitting(true);
      setQuizError('');
      const response = await articleAPI.submitQuiz(article.id, answers as number[]);
      setQuiz(response.data.data);
    } catch (err: any) {
      console.error('Failed to submit article quiz:', err);
      setQuizError(err.response?.data?.error || '测验提交失败');
    } finally {
      setQuizSubmitting(false);
    }
  };

  const handleParagraphClick = (
    event: MouseEvent<HTMLParagraphElement>,
    paragraph: string
  ) => {
    markReadingActive();
    // Clear previous native selection (from a prior word click) so we can detect
    // drag-selections in handleTextSelection on the next mouseup
    window.getSelection()?.removeAllRanges();

    const match = getWordMatchFromPoint(event.clientX, event.clientY);
    if (!match) return;

    setSelectedText(match.word);
    setTooltipContext(paragraph);
    setTooltipMode('dictionary');
    setTooltipPosition({
      x: event.clientX,
      y: event.clientY - 12 + window.scrollY,
    });
    applyHighlight(match.range);
    setShowTranslation(true);
  };

  const closeAnalysis = () => {
    setSentenceAnalysis(null);
    setAnalysisError('');
    setAnalysisRequiresPremium(false);
    setActiveAnalysisKey('');
  };

  const handleTextSelection = (paragraph: string, paragraphIndex: number) => {
    window.requestAnimationFrame(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (!text || text.length < 2) return;
      markReadingActive();

      const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      const rect = range?.getBoundingClientRect();
      if (!range || !rect) return;

      const dictionaryWord = getDictionaryWord(text);

      if (intensiveMode) {
        setShowTranslation(false);
        setSelectedText('');
        setTooltipContext('');
        setActiveIntensiveParagraph(null);
        setAnalysisSelection({
          key: `selection-${paragraphIndex}`,
          text,
          context: paragraph,
          paragraphIndex,
        });
        closeAnalysis();
        applyHighlight(range);
        return;
      }

      setSelectedText(dictionaryWord || text);
      setTooltipContext(paragraph);
      setTooltipMode(dictionaryWord ? 'dictionary' : 'translate');
      setTooltipPosition({
        x: rect.left + rect.width / 2,
        y: rect.top - 12 + window.scrollY,
      });
      applyHighlight(range);
      setShowTranslation(true);
    });
  };

  const handleAnalyzeSentence = async (text: string, analysisKey: string) => {
    const targetText = text.trim();
    if (!targetText) return;

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
      const response = await translationAPI.analyzeSentence(targetText, {
        article_id: article?.id,
        context: analysisSelection?.context || tooltipContext || targetText,
      });
      setSentenceAnalysis(response.data.data);
    } catch (err: any) {
      console.error('Failed to analyze sentence:', err);
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

  const openAssistant = () => {
    if (!isAuthenticated) {
      router.push('/login');
      return false;
    }

    setAssistantOpen(true);
    setAssistantError('');
    setAssistantRequiresPremium(false);
    if (assistantMessages.length === 0) {
      setAssistantMessages([
        {
          role: 'assistant',
          content: '我已经准备好和你讨论这篇文章。可以问我文章主旨、段落逻辑、难句、词组或延伸思考。',
        },
      ]);
    }

    return true;
  };

  const askAssistantAboutText = (text: string, context?: string, promptID: SentenceAIPromptID = 'explain') => {
    const targetText = text.trim();
    if (!targetText) return;
    markReadingActive();

    if (!openAssistant()) return;

    setAssistantInput(buildSentenceAIPrompt(promptID, targetText, context));
    setShowTranslation(false);
    clearHighlight();
  };

  const handleAskAssistant = async (question?: string) => {
    if (!article || assistantLoading) return;

    const content = (question || assistantInput).trim();
    if (!content) return;
    markReadingActive();

    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    const nextMessages: ArticleAssistantMessage[] = [
      ...assistantMessages,
      {
        role: 'user',
        content,
      },
    ];

    const streamingMessage: ArticleAssistantMessage = { role: 'assistant', content: '' };
    setAssistantMessages([...nextMessages, streamingMessage]);
    setAssistantInput('');
    setAssistantError('');
    setAssistantRequiresPremium(false);

    try {
      setAssistantLoading(true);
      const response = await articleAPI.streamAssistant(article.id, {
        messages: nextMessages.slice(-12),
      });

      if (!response.ok) {
        let payload: { error?: string; code?: string } = {};
        try {
          payload = await response.json();
        } catch {
          payload = {};
        }
        const requestError = new Error(payload.error || 'AI 助手暂时不可用') as Error & {
          status?: number;
          code?: string;
        };
        requestError.status = response.status;
        requestError.code = payload.code;
        throw requestError;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('当前浏览器不支持流式输出');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let assistantContent = '';
      let streamDone = false;

      while (!streamDone) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

        const lastBoundary = buffer.lastIndexOf('\n\n');
        if (lastBoundary >= 0) {
          const ready = buffer.slice(0, lastBoundary + 2);
          buffer = buffer.slice(lastBoundary + 2);
          const parsed = parseAssistantStreamChunk(ready);
          if (parsed.error) {
            throw new Error(parsed.error);
          }
          if (parsed.deltas.length > 0) {
            assistantContent += parsed.deltas.join('');
            setAssistantMessages((prev) => [
              ...prev.slice(0, -1),
              { role: 'assistant', content: assistantContent },
            ]);
          }
          streamDone = parsed.done;
        }

        if (done) {
          if (buffer.trim()) {
            const parsed = parseAssistantStreamChunk(`${buffer}\n\n`);
            if (parsed.error) {
              throw new Error(parsed.error);
            }
            if (parsed.deltas.length > 0) {
              assistantContent += parsed.deltas.join('');
              setAssistantMessages((prev) => [
                ...prev.slice(0, -1),
                { role: 'assistant', content: assistantContent },
              ]);
            }
          }
          break;
        }
      }

      if (!assistantContent.trim()) {
        throw new Error('AI 助手结果为空');
      }
    } catch (err: any) {
      console.error('Failed to discuss article with assistant:', err);
      setAssistantMessages((prev) => prev.filter((message) => message.content.trim() !== ''));
      const code = err.code || err.response?.data?.code;
      if (code === 'PREMIUM_REQUIRED' || code === 'MEMBERSHIP_EXPIRED' || code === 'MEMBERSHIP_INVALID') {
        setAssistantRequiresPremium(true);
        setAssistantError(err.message || err.response?.data?.error || 'AI 助手需要会员权限');
      } else if (err.status === 503 || err.response?.status === 503) {
        setAssistantError('AI 助手尚未配置');
      } else {
        setAssistantError(err.message || 'AI 助手暂时不可用');
      }
    } finally {
      setAssistantLoading(false);
    }
  };

  const handleAnalyzeParagraph = (paragraph: string, paragraphIndex: number) => {
    const sentences = splitSentences(paragraph);
    const firstSentence = sentences[0];
    if (!firstSentence) return;
    markReadingActive();

    setShowTranslation(false);
    setAnalysisSelection(null);
    clearHighlight();
    setActiveIntensiveParagraph(paragraphIndex);
    handleAnalyzeSentence(firstSentence, `paragraph-${paragraphIndex}-0`);
  };

  const handleTranslateSelection = (selection: {
    text: string;
    context: string;
  }) => {
    markReadingActive();
    const dictionaryWord = getDictionaryWord(selection.text);
    setSelectedText(dictionaryWord || selection.text);
    setTooltipContext(selection.context);
    setTooltipMode(dictionaryWord ? 'dictionary' : 'translate');
    setTooltipPosition({
      x: window.innerWidth / 2,
      y: window.scrollY + 120,
    });
    setShowTranslation(true);
  };

  const handleTranslateParagraph = async (index: number, paragraph: string) => {
    markReadingActive();
    const current = paragraphTranslations[index];
    if (current?.text && !current.loading) {
      setParagraphTranslations((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      return;
    }

    setParagraphTranslations((prev) => ({
      ...prev,
      [index]: { loading: true },
    }));

    if (chineseParagraphs[index]) {
      setParagraphTranslations((prev) => ({
        ...prev,
        [index]: { loading: false, text: chineseParagraphs[index] },
      }));
      return;
    }

    try {
      const response = await translationAPI.translate({
        text: paragraph,
        target_lang: 'zh',
        article_id: article?.id,
        context: paragraph,
      });
      setParagraphTranslations((prev) => ({
        ...prev,
        [index]: { loading: false, text: response.data.translation },
      }));
    } catch (err) {
      console.error('Failed to translate paragraph:', err);
      setParagraphTranslations((prev) => ({
        ...prev,
        [index]: { loading: false, error: '段落翻译失败' },
      }));
    }
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
    utterance.onend = () => {
      if (onEnd) {
        onEnd();
        return;
      }
      resetTTSState();
    };
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

  const playTTSItem = async (
    item: { key: string; text: string; paragraphIndex: number | null },
    queueIndex: number | null = null
  ) => {
    markReadingActive();
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
      if (ttsRequestIdRef.current !== requestId) {
        return;
      }

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

      playTTSItem(
        {
          key: next.key,
          text: next.text,
          paragraphIndex: next.paragraphIndex,
        },
        currentIndex + 1
      );
    };

    try {
      if (!isAuthenticated) {
        throw new Error('not authenticated');
      }

      const response = await ttsAPI.generateSpeech({
        text: item.text,
        voice: ttsVoice,
        speed: ttsRate,
        format: 'wav',
      });
      if (ttsRequestIdRef.current !== requestId) {
        return;
      }

      const audioUrl = resolveAPIAssetURL(response.data.data.audio_url);
      const audio = new Audio(audioUrl);
      if (ttsRequestIdRef.current !== requestId) {
        audio.pause();
        return;
      }

      audioRef.current = audio;
      audio.onended = playNext;
      audio.onerror = () => {
        if (ttsRequestIdRef.current !== requestId) {
          return;
        }
        setTtsError('模型音频播放失败，已切换浏览器朗读');
        speakWithBrowser(item.text, item.key, item.paragraphIndex, playNext);
      };
      setTtsLoadingKey('');
      setTtsPlayingKey(item.key);
      setTtsPaused(false);
      await audio.play();
    } catch (err: any) {
      if (ttsRequestIdRef.current !== requestId) {
        return;
      }

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

    playTTSItem(
      {
        key: item.key,
        text: item.text,
        paragraphIndex: item.paragraphIndex,
      },
      startIndex
    );
  };

  const handleReadParagraph = (index: number, paragraph: string) => {
    const queueIndex = sentenceQueue.findIndex((item) => item.paragraphIndex === index);
    if (queueIndex >= 0) {
      playSentenceQueueFrom(queueIndex);
      return;
    }

    playTTSItem({ key: `paragraph-${index}`, text: paragraph, paragraphIndex: index });
  };

  const handlePauseOrResumeTTS = () => {
    if (!ttsPlayingKey) return;

    if (ttsPaused) {
      if (audioRef.current) {
        audioRef.current.play().catch(() => setTtsError('音频继续播放失败'));
      } else {
        window.speechSynthesis?.resume();
      }
      setTtsPaused(false);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    } else {
      window.speechSynthesis?.pause();
    }
    setTtsPaused(true);
  };

  const handleSaveSentence = () => {
    if (!article || !sentenceAnalysis) return;

    const savedKey = `${article.id}:${sentenceAnalysis.sentence}`;
    try {
      const current = JSON.parse(localStorage.getItem(SAVED_SENTENCES_KEY) || '[]') as Array<{
        article_id: number;
        article_slug: string;
        article_title: string;
        sentence: string;
        translation: string;
        saved_at: string;
      }>;

      if (!current.some((item) => item.article_id === article.id && item.sentence === sentenceAnalysis.sentence)) {
        current.unshift({
          article_id: article.id,
          article_slug: article.slug,
          article_title: article.title,
          sentence: sentenceAnalysis.sentence,
          translation: sentenceAnalysis.translation,
          saved_at: new Date().toISOString(),
        });
        localStorage.setItem(SAVED_SENTENCES_KEY, JSON.stringify(current.slice(0, 200)));
      }

      setSavedSentenceKeys((prev) => new Set(prev).add(savedKey));
    } catch (err) {
      console.error('Failed to save sentence:', err);
    }
  };

  const renderSentenceText = (sentence: string, sentenceKey: string) =>
    tokenizeParagraph(sentence).map((token, tokenIndex) => {
      const word = normalizeWord(token);
      if (!word || !vocabularyByWord.has(word)) {
        return token;
      }

      return (
        <mark
          key={`${sentenceKey}-${token}-${tokenIndex}`}
          className={`rounded px-0.5 ring-1 ${
            ttsPlayingKey === sentenceKey
              ? 'bg-sky-400/20 text-sky-50 ring-sky-300/30'
              : 'bg-amber-400/20 text-amber-100 ring-amber-400/25'
          }`}
          title="已在生词本，点击复习"
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

  const selectedVocabulary = vocabularyByWord.get(normalizeWord(selectedText));

  const renderAnalysisPanel = (analysisKey: string) => {
    if (activeAnalysisKey !== analysisKey || (!sentenceAnalysis && !analysisError && !analysisLoading)) {
      return null;
    }

    return (
      <div className="mt-4 rounded-lg border border-blue-900/60 bg-blue-950/20 p-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-blue-100">句子精读</h3>
          <button
            type="button"
            onClick={closeAnalysis}
            className="text-sm text-blue-200/70 hover:text-blue-100"
          >
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
              <Link
                href="/membership"
                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-500"
              >
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
                {savedSentenceKeys.has(`${article?.id}:${sentenceAnalysis.sentence}`) ? (
                  <BookmarkCheck className="h-3.5 w-3.5" />
                ) : (
                  <BookmarkPlus className="h-3.5 w-3.5" />
                )}
                {savedSentenceKeys.has(`${article?.id}:${sentenceAnalysis.sentence}`) ? '已收藏' : '收藏句子'}
              </button>
            </div>
            <p className="text-base font-semibold text-white">{sentenceAnalysis.sentence}</p>
            <div className="rounded-md border border-blue-900/60 bg-blue-950/40 p-3">
              {sentenceAnalysis.translation}
            </div>
            <div>
              <h4 className="mb-2 font-semibold text-blue-100">结构拆解</h4>
              <ul className="space-y-1 text-blue-50/90">
                {sentenceAnalysis.structure.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            {sentenceAnalysis.key_phrases.length > 0 && (
              <div>
                <h4 className="mb-2 font-semibold text-blue-100">重点词组</h4>
                <div className="flex flex-wrap gap-2">
                  {sentenceAnalysis.key_phrases.map((phrase) => (
                    <span
                      key={phrase}
                      className="rounded border border-blue-800/70 px-2 py-1 text-xs text-blue-100"
                    >
                      {phrase}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h4 className="mb-2 font-semibold text-blue-100">阅读提示</h4>
              <ul className="space-y-1 text-blue-50/80">
                {sentenceAnalysis.difficulty_tips.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-4">
        <div className="text-center">
          <h1 className="mb-3 text-2xl font-bold">文章未找到</h1>
          <p className="mb-6 text-gray-500">{error || '该文章可能已被删除或不存在'}</p>
          <Link href="/" className="text-sky-500 hover:text-sky-400">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  const coverImageURL = article.cover_image ? resolveAPIAssetURL(article.cover_image) : '';
  const shouldBypassImageOptimizer = isRemoteHTTPURL(coverImageURL);

  return (
    <>
      <div className="fixed left-0 right-0 top-16 z-40 h-1 bg-gray-800">
        <div
          className="h-full bg-red-500 transition-[width] duration-200"
          style={{ width: `${readProgress}%` }}
        />
      </div>

      <div className={`mx-auto max-w-6xl px-4 py-9 transition-[padding] sm:px-6 lg:px-8 ${
        assistantOpen ? 'xl:mr-[440px]' : ''
      }`}>
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-300"
        >
          <ChevronLeft className="h-4 w-4" />
          返回文章列表
        </Link>

        <header className="mb-8">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm font-semibold text-red-500">
            <span>{article.source || 'MITTR'}</span>
            <span className="text-gray-600">|</span>
            <span>{article.category?.name || '外刊精选'}</span>
          </div>

          <h1 className="mb-4 text-4xl font-black leading-tight text-gray-100 md:text-5xl">
            {article.title}
          </h1>

          {article.title_cn && (
            <h2 className="mb-6 text-2xl font-bold leading-relaxed text-gray-400">
              {article.title_cn}
            </h2>
          )}

          <p className="mb-7 text-lg leading-8 text-gray-400">
            {article.summary_cn || article.summary}
          </p>

          <div className="flex flex-col gap-4 border-y border-gray-800 py-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-5 text-sm text-gray-500">
              <span>{format(new Date(article.published_at), 'yyyy-MM-dd')}</span>
              <span className="inline-flex items-center gap-1">
                <Timer className="h-4 w-4" />
                {article.reading_time} 分钟
              </span>
              <span>{article.word_count} 词</span>
              <span>{difficultyLabels[article.difficulty_level]}</span>
              {article.cefr_level && <span>CEFR {article.cefr_level}</span>}
              <span className="inline-flex items-center gap-1">
                <Eye className="h-4 w-4" />
                {article.view_count}
              </span>
              {highlightedVocabularyCount > 0 && (
                <span className="text-amber-300">
                  已高亮 {highlightedVocabularyCount} 个旧词
                </span>
              )}
            </div>

            {article.keywords && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                {article.keywords
                  .split(',')
                  .map((keyword) => keyword.trim())
                  .filter(Boolean)
                  .slice(0, 8)
                  .map((keyword) => (
                    <span key={keyword} className="rounded border border-gray-800 px-2 py-1">
                      {keyword}
                    </span>
                  ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
              <button
                type="button"
                onClick={() => {
                  setIntensiveMode((value) => !value);
                  setShowTranslation(false);
                  closeAnalysis();
                  clearHighlight();
                  setAnalysisSelection(null);
                  setActiveIntensiveParagraph(null);
                }}
                className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
                  intensiveMode
                    ? 'border-blue-500 bg-blue-950/50 text-blue-100'
                    : 'border-gray-700 text-gray-300 hover:bg-gray-900'
                }`}
              >
                <Eye className="h-4 w-4" />
                {intensiveMode ? '精读中' : '精读模式'}
              </button>
              <button
                type="button"
                onClick={openAssistant}
                className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900"
              >
                <Bot className="h-4 w-4" />
                AI 助手
              </button>
              <button
                type="button"
                onClick={openKnowledgeGraph}
                className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-sky-600/70 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-500/10"
              >
                <Network className="h-4 w-4" />
                知识图谱
              </button>
              {chineseParagraphs.length > 0 && (
                <button
                  onClick={() => setShowChinese((value) => !value)}
                  className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
                    showChinese
                      ? 'border-blue-500 bg-blue-950/50 text-blue-100'
                      : 'border-gray-700 text-gray-300 hover:bg-gray-900'
                  }`}
                  title={showChinese ? '隐藏全文中文译文' : '显示全文中文译文'}
                >
                  <Languages className="h-4 w-4" />
                  {showChinese ? '隐藏译文' : '译文'}
                </button>
              )}
              <button
                onClick={handleFavoriteArticle}
                disabled={favoriteLoading}
                className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900 disabled:opacity-50"
              >
                {favoriteLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isFavorited ? (
                  <BookmarkCheck className="h-4 w-4 text-yellow-300" />
                ) : (
                  <BookmarkPlus className="h-4 w-4" />
                )}
                {isFavorited ? '已收藏' : '收藏'}
              </button>
              <button
                onClick={handleShare}
                className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900"
              >
                <Share2 className="h-4 w-4" />
                分享
              </button>
            </div>
          </div>
        </header>

        {coverImageURL && (
          <div className="relative mb-10 aspect-[16/8] overflow-hidden bg-gray-900">
            <Image
              src={coverImageURL}
              alt={article.title}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 1152px"
              className="object-cover"
              unoptimized={shouldBypassImageOptimizer}
            />
          </div>
        )}

        <section className="mb-8 rounded-lg border border-gray-800 bg-gray-950/60 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-gray-100">
                <Volume2 className="h-4 w-4 text-sky-300" />
                听力跟读
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                模型 TTS 优先；逐句播放时可点击正文句子跳到该句继续播放。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => playTTSItem({ key: 'article-full', text: englishParagraphs.join('\n\n'), paragraphIndex: null })}
                disabled={ttsLoadingKey === 'article-full' || englishParagraphs.length === 0}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                  ttsPlayingKey === 'article-full'
                    ? 'border-sky-500 text-sky-300'
                    : 'border-gray-700 text-gray-300 hover:bg-gray-900'
                }`}
              >
                {ttsLoadingKey === 'article-full' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                全文
              </button>
              <button
                type="button"
                onClick={() => playSentenceQueueFrom(0)}
                disabled={sentenceQueue.length === 0 || Boolean(ttsLoadingKey)}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                  ttsQueueIndex !== null
                    ? 'border-sky-500 text-sky-300'
                    : 'border-gray-700 text-gray-300 hover:bg-gray-900'
                }`}
              >
                <SkipForward className="h-4 w-4" />
                逐句
              </button>
              <button
                type="button"
                onClick={handlePauseOrResumeTTS}
                disabled={!ttsPlayingKey}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 transition-colors hover:bg-gray-900 disabled:opacity-40"
              >
                {ttsPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                {ttsPaused ? '继续' : '暂停'}
              </button>
              <button
                type="button"
                onClick={stopTTS}
                disabled={!ttsPlayingKey && !ttsLoadingKey}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 transition-colors hover:bg-gray-900 disabled:opacity-40"
              >
                <Square className="h-4 w-4" />
                停止
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <label className="inline-flex items-center gap-2 text-gray-400">
              <Volume2 className="h-4 w-4" />
              <select
                value={ttsVoice}
                onChange={(event) => setTtsVoice(event.target.value)}
                className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-200"
              >
                {ttsVoices.map((voice) => (
                  <option key={voice} value={voice}>
                    {voice}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-2 text-gray-400">
              <Gauge className="h-4 w-4" />
              <select
                value={ttsRate}
                onChange={(event) => setTtsRate(Number(event.target.value))}
                className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-200"
              >
                {ttsRates.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}x
                  </option>
                ))}
              </select>
            </label>
            {ttsLoadingKey && (
              <span className="inline-flex items-center gap-2 text-sky-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                生成音频中
              </span>
            )}
            {ttsPlayingKey && !ttsPaused && (
              <span className="text-sky-300">正在播放</span>
            )}
            {ttsError && <span className="text-amber-300">{ttsError}</span>}
          </div>
        </section>

        <article ref={contentRef} className="mb-12">
          <div className="space-y-8">
            {englishParagraphs.map((paragraph, index) => {
              const paragraphTranslation = paragraphTranslations[index];
              const selectedInParagraph = analysisSelection?.paragraphIndex === index ? analysisSelection : null;
              const paragraphSentences = splitSentences(paragraph);

              return (
                <section
                  key={`${paragraph}-${index}`}
                  className="group rounded-lg border border-transparent p-0 transition-colors hover:border-gray-800 hover:bg-gray-950/30 sm:p-4"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <p
                      onClick={(event) => handleParagraphClick(event, paragraph)}
                      onMouseUp={() => handleTextSelection(paragraph, index)}
                      className="flex-1 cursor-text whitespace-pre-wrap text-xl font-medium leading-10 text-gray-200"
                    >
                      {renderParagraph(paragraph, index)}
                    </p>

                    <div className="flex shrink-0 items-center gap-2 sm:pt-1">
                      <button
                        type="button"
                        onClick={() => handleTranslateParagraph(index, paragraph)}
                        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-gray-700 px-3 py-1.5 text-sm font-semibold text-gray-300 hover:bg-gray-900"
                      >
                        {paragraphTranslation?.loading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Languages className="h-4 w-4" />
                        )}
                        {paragraphTranslation?.text ? '隐藏' : '翻译'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReadParagraph(index, paragraph)}
                        className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-semibold hover:bg-gray-900 ${
                          speakingIndex === index
                            ? 'border-sky-500 text-sky-300'
                            : 'border-gray-700 text-gray-300'
                        }`}
                      >
                        {ttsLoadingKey === `paragraph-${index}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Volume2 className="h-4 w-4" />
                        )}
                        {speakingIndex === index ? '停止' : '朗读'}
                      </button>
                      {intensiveMode && (
                        <button
                          type="button"
                          onClick={() => handleAnalyzeParagraph(paragraph, index)}
                          disabled={analysisLoading && activeIntensiveParagraph === index}
                          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
                            activeIntensiveParagraph === index
                              ? 'border-blue-500 bg-blue-950/50 text-blue-100'
                              : 'border-gray-700 text-gray-300 hover:bg-gray-900'
                          }`}
                        >
                          {analysisLoading && activeIntensiveParagraph === index ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                          精读
                        </button>
                      )}
                    </div>
                  </div>

                  {activeIntensiveParagraph === index && intensiveMode && !selectedInParagraph && (
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
                                className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                                  isActive
                                    ? 'border-blue-500 bg-blue-950/50 text-blue-100'
                                    : 'border-gray-700 text-gray-300 hover:bg-gray-900'
                                }`}
                              >
                                {analysisLoading && isActive ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" />
                                )}
                                精读
                              </button>
                            </div>
                            {renderAnalysisPanel(analysisKey)}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {selectedInParagraph && intensiveMode && (
                    <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950/70 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <p className="text-sm leading-7 text-gray-400">
                          {selectedInParagraph.text}
                        </p>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleAnalyzeSentence(selectedInParagraph.text, selectedInParagraph.key)}
                            disabled={analysisLoading && activeAnalysisKey === selectedInParagraph.key}
                            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
                          >
                            {analysisLoading && activeAnalysisKey === selectedInParagraph.key ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                            精读
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTranslateSelection(selectedInParagraph)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 transition-colors hover:bg-gray-900"
                          >
                            <Languages className="h-3.5 w-3.5" />
                            翻译
                          </button>
                          <button
                            type="button"
                            onClick={() => askAssistantAboutText(selectedInParagraph.text, selectedInParagraph.context)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 transition-colors hover:bg-gray-900"
                          >
                            <Bot className="h-3.5 w-3.5" />
                            问 AI
                          </button>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-800 pt-4">
                        {sentenceAIPrompts.map((prompt) => (
                          <button
                            key={prompt.id}
                            type="button"
                            onClick={() => askAssistantAboutText(
                              selectedInParagraph.text,
                              selectedInParagraph.context,
                              prompt.id
                            )}
                            className="rounded-md border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 transition-colors hover:border-sky-700 hover:bg-sky-950/30 hover:text-sky-100"
                          >
                            {prompt.label}
                          </button>
                        ))}
                      </div>
                      {renderAnalysisPanel(selectedInParagraph.key)}
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

          {showChinese && chineseParagraphs.length > 0 && (
            <section className="mt-10 border-t border-gray-800 pt-8">
              <h3 className="mb-5 text-xl font-bold text-gray-100">中文翻译</h3>
              <div className="space-y-5 text-lg leading-9 text-gray-400">
                {chineseParagraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          )}
        </article>

        {(completion || completionLoading) && (
          <section className="mb-8 rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-emerald-100">阅读完成</h3>
              {completionLoading && <Loader2 className="h-4 w-4 animate-spin text-emerald-300" />}
            </div>
            {completion && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="rounded-md border border-emerald-900/50 p-3">
                    <div className="text-xs text-emerald-300/80">阅读时长</div>
                    <div className="mt-1 text-xl font-bold text-emerald-50">
                      {Math.max(1, Math.round(completion.stats.read_time / 60))} 分钟
                    </div>
                  </div>
                  <div className="rounded-md border border-emerald-900/50 p-3">
                    <div className="text-xs text-emerald-300/80">本篇生词</div>
                    <div className="mt-1 text-xl font-bold text-emerald-50">
                      {completion.stats.new_words}
                    </div>
                  </div>
                  <div className="rounded-md border border-emerald-900/50 p-3">
                    <div className="text-xs text-emerald-300/80">已掌握</div>
                    <div className="mt-1 text-xl font-bold text-emerald-50">
                      {completion.stats.learned_words}
                    </div>
                  </div>
                  <div className="rounded-md border border-emerald-900/50 p-3">
                    <div className="text-xs text-emerald-300/80">待复习</div>
                    <div className="mt-1 text-xl font-bold text-emerald-50">
                      {completion.stats.due_review_words}
                    </div>
                  </div>
                </div>

                {completion.words.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-emerald-100">本篇新增词</h4>
                    <div className="flex flex-wrap gap-2">
                      {completion.words.slice(0, 12).map((word) => (
                        <span
                          key={word.id}
                          className="rounded border border-emerald-900/70 px-2 py-1 text-xs text-emerald-100"
                        >
                          {word.word}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-sky-900/50 bg-sky-950/20 p-4">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h4 className="flex items-center gap-2 text-base font-bold text-sky-50">
                        <FileText className="h-4 w-4 text-sky-300" />
                        我的精读笔记
                      </h4>
                      <p className="mt-1 text-sm text-sky-200/70">
                        自动整理本篇查词、翻译、句子精读和 AI 问答，生成读后复习材料。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => article && generateStudyNote(article.id, true)}
                      disabled={studyNoteLoading}
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-sky-800/70 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-900/30 disabled:opacity-60"
                    >
                      {studyNoteLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                      {studyNote ? '刷新笔记' : '生成笔记'}
                    </button>
                  </div>

                  {studyNoteError && (
                    <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                      {studyNoteError}
                    </div>
                  )}

                  {studyNote ? (
                    <div className="space-y-5">
                      <div className="rounded-md border border-sky-900/40 bg-gray-950/30 p-4">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-300/80">
                          摘要
                        </div>
                        <p className="whitespace-pre-line text-sm leading-7 text-sky-50/90">{studyNote.summary}</p>
                      </div>

                      {studyNote.keywords.length > 0 && (
                        <div>
                          <div className="mb-2 text-sm font-semibold text-sky-100">关键词</div>
                          <div className="flex flex-wrap gap-2">
                            {studyNote.keywords.map((keyword) => (
                              <span
                                key={keyword}
                                className="rounded border border-sky-900/70 px-2 py-1 text-xs text-sky-100"
                              >
                                {keyword}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {studyNote.difficult_sentences.length > 0 && (
                        <div>
                          <div className="mb-2 text-sm font-semibold text-sky-100">难句复盘</div>
                          <div className="space-y-3">
                            {studyNote.difficult_sentences.slice(0, 3).map((sentence) => (
                              <div
                                key={sentence.text}
                                className="rounded-md border border-sky-900/40 bg-gray-950/30 p-3 text-sm leading-6"
                              >
                                <p className="text-sky-50">{sentence.text}</p>
                                {sentence.translation && (
                                  <p className="mt-2 text-sky-200/75">{sentence.translation}</p>
                                )}
                                {sentence.tips && sentence.tips.length > 0 && (
                                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sky-100/70">
                                    {sentence.tips.slice(0, 2).map((tip) => (
                                      <li key={tip}>{tip}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="grid gap-4 lg:grid-cols-2">
                        {studyNote.grammar_points.length > 0 && (
                          <div>
                            <div className="mb-2 text-sm font-semibold text-sky-100">语法点</div>
                            <div className="space-y-2">
                              {studyNote.grammar_points.slice(0, 3).map((point) => (
                                <div key={point.title} className="rounded-md border border-sky-900/40 bg-gray-950/30 p-3">
                                  <div className="text-sm font-semibold text-sky-50">{point.title}</div>
                                  <p className="mt-1 text-sm leading-6 text-sky-100/75">{point.description}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {studyNote.expression_replacements.length > 0 && (
                          <div>
                            <div className="mb-2 text-sm font-semibold text-sky-100">表达替换</div>
                            <div className="space-y-2">
                              {studyNote.expression_replacements.slice(0, 4).map((expression) => (
                                <div
                                  key={`${expression.original}-${expression.alternative}`}
                                  className="rounded-md border border-sky-900/40 bg-gray-950/30 p-3 text-sm leading-6"
                                >
                                  <div className="font-semibold text-sky-50">{expression.original}</div>
                                  <div className="text-sky-100/75">{expression.alternative}</div>
                                  {expression.note && <div className="mt-1 text-xs text-sky-200/60">{expression.note}</div>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {studyNote.review_plan.length > 0 && (
                        <div>
                          <div className="mb-2 text-sm font-semibold text-sky-100">复习计划</div>
                          <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-sky-100/80">
                            {studyNote.review_plan.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-md border border-sky-900/40 bg-gray-950/30 p-4 text-sm text-sky-100/75">
                      {studyNoteLoading ? '正在整理精读笔记...' : '读完后会自动生成，也可以手动生成当前笔记。'}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-4">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h4 className="text-base font-bold text-emerald-50">读后测验</h4>
                      <p className="mt-1 text-sm text-emerald-200/70">
                        用 5 道题检查主旨、细节、词义和推理理解。
                      </p>
                    </div>
                    {quiz?.latest_attempt && (
                      <div className="rounded-md border border-emerald-800/70 px-3 py-2 text-sm text-emerald-50">
                        得分 {quiz.latest_attempt.score}/{quiz.latest_attempt.total} · {quiz.latest_attempt.percentage}%
                      </div>
                    )}
                  </div>

                  {quizLoading ? (
                    <div className="flex items-center gap-2 text-sm text-emerald-100">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      正在生成测验...
                    </div>
                  ) : quizError ? (
                    <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                      {quizError}
                    </div>
                  ) : quiz ? (
                    <div className="space-y-4">
                      {quiz.questions.map((question, questionIndex) => {
                        const selectedAnswer = quizAnswers[question.id];
                        const hasResult = question.correct_index !== undefined;

                        return (
                          <div key={question.id} className="rounded-md border border-emerald-900/40 bg-gray-950/30 p-4">
                            <div className="mb-3 flex items-start gap-2">
                              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-emerald-500/20 text-xs font-bold text-emerald-100">
                                {questionIndex + 1}
                              </span>
                              <p className="text-sm font-semibold leading-6 text-emerald-50">{question.prompt}</p>
                            </div>
                            <div className="grid gap-2">
                              {question.options.map((option, optionIndex) => {
                                const selected = selectedAnswer === optionIndex;
                                const correct = hasResult && question.correct_index === optionIndex;
                                const wrong = hasResult && selected && !correct;

                                return (
                                  <button
                                    key={`${question.id}-${option}`}
                                    type="button"
                                    disabled={hasResult}
                                    onClick={() =>
                                      setQuizAnswers((prev) => ({
                                        ...prev,
                                        [question.id]: optionIndex,
                                      }))
                                    }
                                    className={`flex items-start gap-2 rounded-md border px-3 py-2 text-left text-sm leading-6 transition-colors disabled:cursor-default ${
                                      correct
                                        ? 'border-green-500/60 bg-green-500/15 text-green-100'
                                        : wrong
                                          ? 'border-red-500/60 bg-red-500/15 text-red-100'
                                          : selected
                                            ? 'border-emerald-400/70 bg-emerald-500/15 text-emerald-50'
                                            : 'border-emerald-900/40 bg-gray-950/40 text-emerald-100/85 hover:border-emerald-700'
                                    }`}
                                  >
                                    <span className="mt-0.5 font-bold">{String.fromCharCode(65 + optionIndex)}.</span>
                                    <span className="flex-1">{option}</span>
                                    {correct && <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-green-300" />}
                                    {wrong && <XCircle className="mt-1 h-4 w-4 shrink-0 text-red-300" />}
                                  </button>
                                );
                              })}
                            </div>
                            {hasResult && question.explanation && (
                              <p className="mt-3 rounded-md border border-emerald-900/40 bg-emerald-950/30 p-3 text-sm leading-6 text-emerald-100/80">
                                {question.explanation}
                              </p>
                            )}
                          </div>
                        );
                      })}

                      {quiz.latest_attempt ? (
                        <button
                          type="button"
                          onClick={() => {
                            setQuizAnswers({});
                            setQuiz((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    latest_attempt: undefined,
                                    questions: prev.questions.map((question) => ({
                                      ...question,
                                      correct_index: undefined,
                                      explanation: undefined,
                                      user_answer: undefined,
                                      is_correct: undefined,
                                    })),
                                  }
                                : prev
                            );
                          }}
                          className="inline-flex rounded-md border border-emerald-800/70 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-900/30"
                        >
                          重新练习
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleSubmitQuiz}
                          disabled={quizSubmitting}
                          className="inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-60"
                        >
                          {quizSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                          提交测验
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => article && fetchQuiz(article.id)}
                      className="inline-flex rounded-md border border-emerald-800/70 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-900/30"
                    >
                      生成读后测验
                    </button>
                  )}
                </div>

                {completion.next_article?.slug && (
                  <Link
                    href={`/articles/${completion.next_article.slug}`}
                    className="inline-flex rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
                  >
                    下一篇同难度文章
                  </Link>
                )}
              </div>
            )}
          </section>
        )}

        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-5 text-sm text-gray-500">
          阅读提示：点击任意英文单词可查词；打开精读模式后，划选句子或长句片段即可精读。登录后会自动记录阅读进度。
        </div>

        {showTranslation && selectedText && (
          <TranslationTooltip
            selectedText={selectedText}
            position={tooltipPosition}
            onClose={() => {
              setShowTranslation(false);
              clearHighlight();
            }}
            articleId={article.id}
            mode={tooltipMode}
            context={tooltipContext}
            existingVocabulary={selectedVocabulary}
            onAskAI={(text) => askAssistantAboutText(text, tooltipContext)}
            onWordAdded={(word) => {
              clearHighlight();
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
              setShowTranslation(false);
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
      </div>

      {knowledgeGraphOpen && (
        <ArticleKnowledgeGraphModal
          graph={knowledgeGraph}
          loading={knowledgeGraphLoading}
          error={knowledgeGraphError}
          activeNodeID={activeKnowledgeNodeID}
          onActiveNodeChange={setActiveKnowledgeNodeID}
          onClose={() => setKnowledgeGraphOpen(false)}
          onAction={(href, focusNodeID) => {
            if (focusNodeID) {
              setActiveKnowledgeNodeID(focusNodeID);
            }
            if (href) {
              router.push(href);
            }
          }}
        />
      )}

      {assistantOpen && (
          <aside className="fixed bottom-0 right-0 top-16 z-40 flex w-full flex-col border-l border-gray-800 bg-gray-950 shadow-2xl sm:w-[420px]">
            <div className="flex items-start justify-between border-b border-gray-800 px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-gray-100">
                  <Bot className="h-5 w-5 text-sky-300" />
                  AI 文章助手
                </h2>
                <p className="mt-1 line-clamp-2 text-sm text-gray-500">{article.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setAssistantOpen(false)}
                className="rounded-md border border-gray-700 p-2 text-gray-400 hover:bg-gray-900 hover:text-gray-100"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-gray-800 px-5 py-3">
              <div className="flex flex-wrap gap-2">
                {['概括这篇文章', '解释核心观点', '列出重点词组'].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => handleAskAssistant(prompt)}
                    disabled={assistantLoading}
                    className="rounded-md border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-900 disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {assistantMessages.map((message, index) => (
                <div
                  key={`${message.role}-${index}-${message.content.slice(0, 20)}`}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[88%] rounded-lg px-4 py-3 text-sm leading-7 ${
                      message.role === 'user'
                        ? 'whitespace-pre-wrap bg-sky-600 text-white'
                        : 'border border-gray-800 bg-gray-900/70 text-gray-200'
                    }`}
                  >
                    {message.role === 'assistant' ? (
                      message.content ? (
                        <AssistantMessageContent content={message.content} />
                      ) : (
                        <span className="inline-flex h-5 items-center text-sky-300">...</span>
                      )
                    ) : (
                      message.content
                    )}
                  </div>
                </div>
              ))}

              {assistantLoading && (
                <div className="flex items-center gap-2 text-sm text-sky-300">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  思考中...
                </div>
              )}

              {assistantError && (
                <div className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span>{assistantError}</span>
                    {assistantRequiresPremium && (
                      <Link
                        href="/membership"
                        className="inline-flex shrink-0 justify-center rounded-md bg-red-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-400"
                      >
                        去会员中心
                      </Link>
                    )}
                  </div>
                </div>
              )}
              <div ref={assistantEndRef} />
            </div>

            <form
              className="border-t border-gray-800 p-4"
              onSubmit={(event) => {
                event.preventDefault();
                handleAskAssistant();
              }}
            >
              <div className="flex items-end gap-2">
                <textarea
                  value={assistantInput}
                  onChange={(event) => setAssistantInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      handleAskAssistant();
                    }
                  }}
                  rows={2}
                  placeholder="问问这篇文章..."
                  className="min-h-[52px] flex-1 resize-none rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm leading-6 text-gray-100 outline-none focus:border-sky-500"
                />
                <button
                  type="submit"
                  disabled={!assistantInput.trim() || assistantLoading}
                  className="inline-flex h-[52px] w-[52px] items-center justify-center rounded-md bg-sky-600 text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="发送"
                >
                  {assistantLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                </button>
              </div>
            </form>
          </aside>
      )}
    </>
  );
}
