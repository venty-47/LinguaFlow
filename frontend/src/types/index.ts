export interface Article {
  id: number;
  title: string;
  title_cn?: string;
  slug: string;
  summary: string;
  summary_cn?: string;
  content: string;
  content_cn?: string;
  cover_image?: string;
  category_id: number;
  category?: Category;
  tags?: string;
  source?: string;
  source_url?: string;
  author?: string;
  published_at: string;
  difficulty_level: 'easy' | 'medium' | 'hard';
  word_count: number;
  reading_time: number;
  keywords?: string;
  cefr_level?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  view_count: number;
  status: string;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: number;
  name: string;
  name_en?: string;
  slug: string;
  description?: string;
  icon?: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Vocabulary {
  id: number;
  user_id: number;
  word: string;
  phonetic?: string;
  definition?: string;
  translation?: string;
  examples?: string;
  article_id?: number;
  context?: string;
  is_learned: boolean;
  review_count: number;
  forgotten_count: number;
  last_review?: string;
  next_review_at?: string;
  review_interval: number;
  review_ease: number;
  created_at: string;
  updated_at: string;
}

export type VocabularyExerciseType =
  | 'en_to_zh_choice'
  | 'zh_to_en_spelling'
  | 'context_fill_blank'
  | 'audio_word_choice'
  | 'sentence_meaning_choice';

export interface VocabularyExercise {
  vocabulary_id: number;
  word: string;
  type: VocabularyExerciseType;
  prompt: string;
  context?: string;
  options?: string[];
  audio_text?: string;
  placeholder?: string;
}

export interface VocabularyAnswerResult {
  data: Vocabulary;
  correct: boolean;
  rating: 'forgot' | 'hard' | 'good';
  correct_answer: string;
  message: string;
}

export interface KnowledgeGraphNode {
  id: string;
  db_id: number;
  type:
    | 'word'
    | 'meaning'
    | 'definition'
    | 'context'
    | 'example'
    | 'article'
    | 'topic'
    | 'grammar'
    | 'weakness'
    | 'review';
  label: string;
  description?: string;
  weight: number;
  mastery?: number;
  metadata?: {
    vocabulary_id?: number;
    article_id?: number;
    slug?: string;
    phonetic?: string;
    is_learned?: boolean;
    review_count?: number;
    forgotten_count?: number;
    next_review_at?: string | null;
    difficulty_level?: string;
    cefr_level?: string;
    source?: string;
    published_at?: string;
    article_word_count?: number;
  };
}

export interface KnowledgeGraphEdge {
  id: string;
  db_id: number;
  source: string;
  target: string;
  relation: string;
  label: string;
  weight: number;
}

export interface KnowledgeGraphStats {
  total_nodes: number;
  total_edges: number;
  related_words: number;
  articles: number;
  topics: number;
  grammar_points: number;
  weak_signals: number;
  due_reviews: number;
  node_types: Record<string, number>;
}

export interface KnowledgeGraph {
  focus?: KnowledgeGraphNode;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  stats: KnowledgeGraphStats;
}

export type VocabularyKnowledgeGraph = KnowledgeGraph;

export interface KnowledgeGraphRecommendation {
  id: string;
  type: 'review' | 'weakness' | 'grammar' | 'reading' | 'context' | 'build' | string;
  priority: number;
  title: string;
  description: string;
  action_label: string;
  action_href?: string;
  focus_key?: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeGraphPathStep {
  node: KnowledgeGraphNode;
  via?: string;
  relation?: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeGraphLearningPath {
  id: string;
  type: 'review' | 'weakness' | 'topic' | string;
  priority: number;
  title: string;
  description: string;
  action_label: string;
  action_href?: string;
  focus_key?: string;
  steps: KnowledgeGraphPathStep[];
}

export interface KnowledgeGraphTopicCluster {
  id: string;
  topic: KnowledgeGraphNode;
  node_count: number;
  edge_count: number;
  word_count: number;
  article_count: number;
  focus_key: string;
  nodes: KnowledgeGraphNode[];
}

export interface KnowledgeGraphOverview {
  stats: KnowledgeGraphStats;
  weak_nodes: KnowledgeGraphNode[];
  due_nodes: KnowledgeGraphNode[];
  recent_nodes: KnowledgeGraphNode[];
  top_topics: KnowledgeGraphNode[];
  topic_clusters: KnowledgeGraphTopicCluster[];
  recommendations: KnowledgeGraphRecommendation[];
  learning_paths: KnowledgeGraphLearningPath[];
}

export interface ReadHistory {
  id: number;
  user_id: number;
  article_id: number;
  article?: Article;
  read_progress: number;
  read_time: number;
  last_read_at: string;
  is_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface StudyGoal {
  id: number;
  user_id: number;
  daily_read_minutes: number;
  daily_review_words: number;
  daily_articles: number;
  created_at: string;
  updated_at: string;
}

export interface StudyRecord {
  id?: number;
  user_id: number;
  date: string;
  read_seconds: number;
  reviewed_words: number;
  completed_articles: number;
  is_completed: boolean;
  last_activity_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface StudyToday {
  goal: StudyGoal;
  today: StudyRecord;
  progress: {
    read_minutes: number;
    reviewed_words: number;
    completed_articles: number;
  };
  completion: number;
  is_completed: boolean;
  streak: number;
  calendar: StudyRecord[];
}

export interface StudyDiagnostics {
  week_start: string;
  new_word_mastery: {
    total: number;
    mastered: number;
    mastery_pct: number;
  };
  most_forgotten_words: Array<{
    id: number;
    word: string;
    translation?: string;
    forgotten_count: number;
    context?: string;
  }>;
  reading_speed_trend: {
    current_wpm: number;
    previous_wpm: number;
    change_pct: number;
    current_articles: number;
    previous_articles: number;
  };
  difficulty_completions: Array<{
    difficulty: 'easy' | 'medium' | 'hard';
    total: number;
    completed: number;
    rate_pct: number;
  }>;
  weak_grammar_points: Array<{
    name: string;
    count: number;
    description: string;
  }>;
  practice_actions: Array<{
    type: 'rewrite' | 'imitation' | 'cn_en' | 'ai_correction';
    title: string;
    description: string;
    href: string;
  }>;
  generated_at: string;
}

export type VideoLessonStatus =
  | 'uploaded'
  | 'extracting_audio'
  | 'transcribing'
  | 'segmenting'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface VideoLesson {
  id: number;
  user_id: number;
  title: string;
  description?: string;
  source?: string;
  source_url?: string;
  original_filename?: string;
  video_path: string;
  audio_path?: string;
  transcript_path?: string;
  duration_seconds: number;
  file_size_bytes: number;
  mime_type?: string;
  language: string;
  status: VideoLessonStatus;
  progress: number;
  error?: string;
  last_position_seconds: number;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface VideoSubtitle {
  id: number;
  video_lesson_id: number;
  sort_order: number;
  start_seconds: number;
  end_seconds: number;
  text: string;
  translation?: string;
  confidence: number;
  source: 'auto' | 'manual' | 'edited' | 'imported';
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: number;
  user_id: number;
  article_id: number;
  article?: Article;
  created_at: string;
  updated_at: string;
}

export interface MembershipPlan {
  id: 'monthly' | 'yearly' | 'lifetime';
  name: string;
  name_en: string;
  price: number;
  currency: string;
  duration: number;
  save_percent: number;
  features: string[];
  recommended?: boolean;
}

export interface MembershipBenefit {
  id?: number;
  name: string;
  name_en?: string;
  description: string;
  icon?: string;
  for_free: boolean;
  for_premium: boolean;
  sort_order?: number;
}

export interface MembershipInfo {
  is_premium: boolean;
  membership_type: 'free' | 'monthly' | 'yearly' | 'lifetime';
  membership_expiry?: string | null;
  is_lifetime?: boolean;
}

export interface MembershipOrder {
  id: number;
  order_no: string;
  product_type: 'monthly' | 'yearly' | 'lifetime';
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'cancelled' | 'refunded';
  payment_method?: string;
  payment_time?: string | null;
  expiry_time?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranslationResult {
  source_text: string;
  translation: string;
  target_lang: string;
  cached: boolean;
}

export interface SentenceAnalysis {
  sentence: string;
  translation: string;
  word_count: number;
  structure: string[];
  key_phrases: string[];
  difficulty_tips: string[];
  provider?: string;
}

export interface ArticleAssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ArticleAssistantResult {
  message: ArticleAssistantMessage;
  provider: string;
}

export interface ArticleStudyNoteSentence {
  text: string;
  translation?: string;
  reason?: string;
  tips?: string[];
}

export interface ArticleStudyNotePoint {
  title: string;
  description: string;
  examples?: string[];
}

export interface ArticleStudyNoteExpression {
  original: string;
  alternative: string;
  note?: string;
}

export interface ArticleStudyNote {
  id: number;
  user_id: number;
  article_id: number;
  title: string;
  summary: string;
  keywords: string[];
  difficult_sentences: ArticleStudyNoteSentence[];
  grammar_points: ArticleStudyNotePoint[];
  expression_replacements: ArticleStudyNoteExpression[];
  review_plan: string[];
  source_stats: {
    translated_texts: number;
    dictionary_lookups: number;
    saved_words: number;
    analyzed_sentences: number;
    assistant_questions: number;
  };
  provider: string;
  generated_at: string;
  refreshed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ArticleKnowledgeGraphNode {
  id: string;
  type: 'article' | 'topic' | 'structure' | 'word' | 'grammar' | 'sentence' | 'review' | string;
  label: string;
  description?: string;
  weight: number;
  mastery?: number;
  metadata?: Record<string, unknown>;
}

export interface ArticleKnowledgeGraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  label: string;
  weight: number;
}

export interface ArticleKnowledgeGraphLane {
  id: 'structure' | 'vocabulary' | 'grammar' | 'sentences' | 'review' | string;
  title: string;
  description: string;
  node_ids: string[];
  nodes: ArticleKnowledgeGraphNode[];
}

export interface ArticleKnowledgeGraphAction {
  id: string;
  type: string;
  title: string;
  description: string;
  label: string;
  href?: string;
  focus_node_id?: string;
  priority: number;
}

export interface ArticleKnowledgeGraph {
  article: ArticleKnowledgeGraphNode;
  lanes: ArticleKnowledgeGraphLane[];
  edges: ArticleKnowledgeGraphEdge[];
  actions: ArticleKnowledgeGraphAction[];
  stats: {
    total_nodes: number;
    total_edges: number;
    vocabulary_count: number;
    grammar_count: number;
    sentence_count: number;
    review_count: number;
  };
}

export interface ArticleCompletion {
  article: Article;
  history: ReadHistory;
  stats: {
    read_time: number;
    read_progress: number;
    is_completed: boolean;
    new_words: number;
    learned_words: number;
    due_review_words: number;
  };
  words: Vocabulary[];
  study_note?: ArticleStudyNote;
  next_article?: Article;
}

export interface ArticleQuizQuestion {
  id: number;
  question_type: 'single_choice';
  prompt: string;
  options: string[];
  sort_order: number;
  correct_index?: number;
  explanation?: string;
  user_answer?: number;
  is_correct?: boolean;
}

export interface ArticleQuizAttempt {
  id: number;
  score: number;
  total: number;
  percentage: number;
  answers: number[];
  completed_at: string;
}

export interface ArticleQuiz {
  id: number;
  article_id: number;
  title: string;
  questions: ArticleQuizQuestion[];
  latest_attempt?: ArticleQuizAttempt;
}

export interface RSSFeedSummary {
  name: string;
  source: string;
  category_name?: string;
  category_en?: string;
  category_slug?: string;
  tags?: string;
  enabled: boolean;
  article_count: number;
  latest_article?: Article;
  latest_published_at?: string;
}

export interface RSSImportFeedReport {
  name: string;
  url: string;
  created: number;
  updated: number;
  skipped: number;
  errors?: string[];
}

export interface RSSImportReport {
  feeds: RSSImportFeedReport[];
  created: number;
  updated: number;
  skipped: number;
  errors?: string[];
  imported_at: string;
}

export interface AO3WorkSummary {
  id: string;
  title: string;
  authors: string[];
  summary: string;
  fandoms: string[];
  rating: string;
  warnings: string[];
  categories: string[];
  relationships: string[];
  characters: string[];
  tags: string[];
  language: string;
  words: string;
  chapters: string;
  comments: string;
  kudos: string;
  bookmarks: string;
  hits: string;
  updated_at: string;
  url: string;
  ao3_path: string;
}

export interface AO3SearchResponse {
  query: string;
  page: number;
  works: AO3WorkSummary[];
  has_next: boolean;
  source_url: string;
  disclaimer: string;
}

export interface AO3Chapter {
  id: string;
  index: number;
  title: string;
  summary: string;
  notes: string;
  content_html: string;
  content_text: string;
  paragraphs: string[];
}

export interface AO3Work extends Omit<AO3WorkSummary, 'comments' | 'kudos' | 'bookmarks' | 'hits' | 'ao3_path'> {
  notes: string;
  published_at: string;
  content_html: string;
  content_text: string;
  paragraphs: string[];
  chapters_data: AO3Chapter[];
  disclaimer: string;
}

export interface PaginationInfo {
  page: number;
  page_size: number;
  total: number;
  total_page: number;
}

export interface ApiResponse<T> {
  data: T;
  pagination?: PaginationInfo;
  message?: string;
}

export interface AdminArticleInput {
  title: string;
  title_cn?: string;
  slug?: string;
  summary?: string;
  summary_cn?: string;
  content: string;
  content_cn?: string;
  cover_image?: string;
  category_id: number;
  tags?: string;
  source?: string;
  source_url?: string;
  author?: string;
  published_at?: string;
  difficulty_level?: 'easy' | 'medium' | 'hard' | 'auto';
  status?: 'draft' | 'published' | 'archived';
  is_featured?: boolean;
}
