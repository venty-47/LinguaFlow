'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  Brain,
  CircleDot,
  ExternalLink,
  GitBranch,
  Layers3,
  Loader2,
  Network,
  RotateCcw,
  Search,
  Target,
  TriangleAlert,
  X,
} from 'lucide-react';
import { knowledgeGraphAPI } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import {
  KnowledgeGraph,
  KnowledgeGraphLearningPath,
  KnowledgeGraphNode,
  KnowledgeGraphOverview,
  KnowledgeGraphRecommendation,
} from '@/types';

type GraphFilter = 'all' | 'word' | 'article' | 'topic' | 'grammar' | 'weakness' | 'review';
type GraphView = 'map' | 'cards';

const filterLabels: Record<GraphFilter, string> = {
  all: '全部',
  word: '单词',
  article: '文章',
  topic: '主题',
  grammar: '语法',
  weakness: '薄弱点',
  review: '复习',
};

const nodeLabels: Record<KnowledgeGraphNode['type'], string> = {
  word: '单词',
  meaning: '释义',
  definition: '解释',
  context: '语境',
  example: '例句',
  article: '文章',
  topic: '主题',
  grammar: '语法',
  weakness: '薄弱点',
  review: '复习',
};

const nodeClasses: Record<KnowledgeGraphNode['type'], string> = {
  word: 'border-blue-500/70 bg-blue-500/15 text-blue-100',
  meaning: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100',
  definition: 'border-cyan-500/60 bg-cyan-500/10 text-cyan-100',
  context: 'border-violet-500/60 bg-violet-500/10 text-violet-100',
  example: 'border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-100',
  article: 'border-amber-500/60 bg-amber-500/10 text-amber-100',
  topic: 'border-sky-500/50 bg-sky-500/10 text-sky-100',
  grammar: 'border-indigo-500/60 bg-indigo-500/10 text-indigo-100',
  weakness: 'border-red-500/60 bg-red-500/10 text-red-100',
  review: 'border-lime-500/50 bg-lime-500/10 text-lime-100',
};

function masteryColor(value?: number) {
  if (value === undefined) return 'bg-gray-700';
  if (value >= 75) return 'bg-green-500';
  if (value >= 45) return 'bg-amber-500';
  return 'bg-red-500';
}

function nodeLayoutClass(node: KnowledgeGraphNode) {
  if (node.type === 'word' && node.weight >= 85) return 'min-h-36 lg:col-span-2';
  if (node.type === 'article') return 'min-h-32 lg:col-span-2';
  if (node.weight >= 80) return 'min-h-32';
  return 'min-h-28';
}

function graphNodePoint(node: KnowledgeGraphNode, index: number, total: number, selected: boolean) {
  if (selected) {
    return { x: 50, y: 50 };
  }
  const ring = node.weight >= 80 ? 26 : 38;
  const angle = total <= 1 ? 0 : (Math.PI * 2 * index) / total - Math.PI / 2;
  return {
    x: 50 + Math.cos(angle) * ring,
    y: 50 + Math.sin(angle) * ring,
  };
}

function graphNodeRadius(node: KnowledgeGraphNode, selected: boolean) {
  if (selected) return 7.5;
  if (node.weight >= 90) return 6.5;
  if (node.weight >= 70) return 5.5;
  return 4.6;
}

function recommendationTone(type: KnowledgeGraphRecommendation['type']) {
  if (type === 'review') return 'border-lime-500/50 bg-lime-500/10';
  if (type === 'weakness') return 'border-red-500/50 bg-red-500/10';
  if (type === 'grammar') return 'border-indigo-500/50 bg-indigo-500/10';
  if (type === 'reading') return 'border-amber-500/50 bg-amber-500/10';
  return 'border-blue-500/40 bg-blue-500/10';
}

function learningPathTone(type: KnowledgeGraphLearningPath['type']) {
  if (type === 'review') return 'border-lime-500/40 bg-lime-500/10';
  if (type === 'weakness') return 'border-red-500/40 bg-red-500/10';
  if (type === 'topic') return 'border-amber-500/40 bg-amber-500/10';
  return 'border-blue-500/40 bg-blue-500/10';
}

export default function KnowledgeGraphPage() {
  const router = useRouter();
  const { isAuthenticated, token } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [graphLoading, setGraphLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [overview, setOverview] = useState<KnowledgeGraphOverview | null>(null);
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [selectedNode, setSelectedNode] = useState<KnowledgeGraphNode | null>(null);
  const [filter, setFilter] = useState<GraphFilter>('all');
  const [graphView, setGraphView] = useState<GraphView>('map');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const graphRequestRef = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadGraph = useCallback(async (params?: { focus_key?: string; types?: string; search?: string }) => {
    const requestID = graphRequestRef.current + 1;
    graphRequestRef.current = requestID;
    try {
      setGraphLoading(true);
      const response = await knowledgeGraphAPI.getGraph({
        depth: params?.focus_key ? 3 : 2,
        limit: 180,
        ...params,
      });
      if (requestID !== graphRequestRef.current) return;
      const nextGraph = response.data.data as KnowledgeGraph;
      setGraph(nextGraph);
      setSelectedNode(nextGraph.focus || nextGraph.nodes[0] || null);
    } catch (err: any) {
      if (requestID !== graphRequestRef.current) return;
      setError(err.response?.data?.error || '知识图谱加载失败');
    } finally {
      if (requestID === graphRequestRef.current) {
        setGraphLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated || !token) {
      router.replace('/login');
      return;
    }

    const load = async () => {
      const requestID = graphRequestRef.current + 1;
      graphRequestRef.current = requestID;
      try {
        setLoading(true);
        setError('');
        const [overviewResponse, graphResponse] = await Promise.all([
          knowledgeGraphAPI.getOverview(),
          knowledgeGraphAPI.getGraph({ depth: 2, limit: 180 }),
        ]);
        if (requestID !== graphRequestRef.current) return;
        setOverview(overviewResponse.data.data as KnowledgeGraphOverview);
        const nextGraph = graphResponse.data.data as KnowledgeGraph;
        setGraph(nextGraph);
        setSelectedNode(nextGraph.nodes[0] || null);
      } catch (err: any) {
        if (requestID !== graphRequestRef.current) return;
        setError(err.response?.data?.error || '知识图谱加载失败');
      } finally {
        if (requestID === graphRequestRef.current) {
          setLoading(false);
        }
      }
    };

    load();
  }, [isAuthenticated, loadGraph, mounted, router, token]);

  const visibleNodes = useMemo(() => graph?.nodes || [], [graph]);
  const nodePoints = useMemo(() => {
    const selectedID = selectedNode?.id;
    const others = visibleNodes.filter((node) => node.id !== selectedID);
    const points: Record<string, { x: number; y: number }> = {};
    if (selectedNode && visibleNodes.some((node) => node.id === selectedNode.id)) {
      points[selectedNode.id] = graphNodePoint(selectedNode, 0, 1, true);
    }
    others.forEach((node, index) => {
      points[node.id] = graphNodePoint(node, index, others.length, false);
    });
    return points;
  }, [selectedNode, visibleNodes]);
  const connectedEdges = useMemo(() => {
    if (!graph || !selectedNode) return [];
    return graph.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id);
  }, [graph, selectedNode]);
  const nodeByID = useMemo(() => {
    const map = new Map<string, KnowledgeGraphNode>();
    visibleNodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [visibleNodes]);
  const activeFilterLabel = filter === 'all' ? '' : filterLabels[filter];
  const hasActiveQuery = filter !== 'all' || search.trim() !== '' || Boolean(graph?.focus);

  const applyFilters = () => {
    loadGraph({
      types: filter === 'all' ? undefined : filter,
      search: search.trim() || undefined,
    });
  };

  const resetGraph = () => {
    setFilter('all');
    setSearch('');
    loadGraph();
  };

  const focusNode = (node: KnowledgeGraphNode) => {
    setSelectedNode(node);
    loadGraph({ focus_key: node.id });
  };

  const focusNodeKey = (focusKey: string) => {
    loadGraph({ focus_key: focusKey });
  };

  const handleRecommendation = (recommendation: KnowledgeGraphRecommendation) => {
    if (recommendation.focus_key) {
      focusNodeKey(recommendation.focus_key);
      return;
    }
    if (recommendation.action_href) {
      router.push(recommendation.action_href);
    }
  };

  const handleLearningPathAction = (path: KnowledgeGraphLearningPath) => {
    if (path.focus_key) {
      focusNodeKey(path.focus_key);
      return;
    }
    if (path.action_href) {
      router.push(path.action_href);
    }
  };

  const refreshGraph = async () => {
    try {
      setRefreshing(true);
      setError('');
      const overviewResponse = await knowledgeGraphAPI.refresh();
      setOverview(overviewResponse.data.data as KnowledgeGraphOverview);
      await loadGraph({
        types: filter === 'all' ? undefined : filter,
        search: search.trim() || undefined,
      });
    } catch (err: any) {
      setError(err.response?.data?.error || '知识图谱刷新失败');
    } finally {
      setRefreshing(false);
    }
  };

  if (!mounted || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error && !graph) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-6 text-red-100">
          <h1 className="mb-2 text-2xl font-bold">无法加载知识图谱</h1>
          <p className="mb-5 text-sm">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  const stats = overview?.stats || graph?.stats;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="mb-6 border-b border-gray-800 pb-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-sm font-semibold text-blue-300">
              <Network className="h-4 w-4" />
              知识图谱
            </div>
            <h1 className="text-3xl font-black tracking-tight text-gray-100 md:text-4xl">
              你的英语学习关系网
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-500">
              这里把生词、文章、主题、语法、语境、复习计划和薄弱点连接起来，用同一张图展示学习路径。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/vocabulary?mode=review"
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
            >
              <RotateCcw className="h-4 w-4" />
              复习薄弱点
            </Link>
            <button
              type="button"
              onClick={refreshGraph}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900 disabled:opacity-60"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              刷新图谱
            </button>
            <Link
              href="/latest"
              className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900"
            >
              <BookOpen className="h-4 w-4" />
              扩展阅读
            </Link>
          </div>
        </div>
      </section>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: '节点', value: stats?.total_nodes || 0, icon: CircleDot },
          { label: '关系', value: stats?.total_edges || 0, icon: GitBranch },
          { label: '语法点', value: stats?.grammar_points || 0, icon: Brain },
          { label: '待复习', value: stats?.due_reviews || 0, icon: Target },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-gray-800 text-blue-300">
                <Icon className="h-4 w-4" />
              </div>
              <p className="text-sm text-gray-500">{item.label}</p>
              <p className="mt-1 text-2xl font-bold text-gray-100">{item.value}</p>
            </div>
          );
        })}
      </section>

      <section className="mb-6 rounded-lg border border-gray-800 bg-gray-900/50 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(filterLabels) as GraphFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                  filter === key
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-950/60 text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
              >
                {filterLabels[key]}
              </button>
            ))}
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <label className="relative block w-full lg:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyFilters();
                }}
                placeholder="搜索单词、主题、文章、语法"
                className="w-full rounded-md border border-gray-700 bg-gray-950 py-2 pl-9 pr-3 text-sm text-gray-100 outline-none transition-colors placeholder:text-gray-600 focus:border-blue-500"
              />
            </label>
            <button
              type="button"
              onClick={applyFilters}
              disabled={graphLoading}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
            >
              {graphLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              应用
            </button>
            <button
              type="button"
              onClick={resetGraph}
              disabled={graphLoading || !hasActiveQuery}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-4 w-4" />
              全图
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span>当前展示 {visibleNodes.length} 个节点、{graph?.edges.length || 0} 条关系</span>
          {graph?.focus && <span className="rounded bg-gray-800 px-2 py-1 text-gray-300">聚焦：{graph.focus.label}</span>}
          {activeFilterLabel && <span className="rounded bg-gray-800 px-2 py-1 text-gray-300">类型：{activeFilterLabel}</span>}
          {search.trim() && <span className="rounded bg-gray-800 px-2 py-1 text-gray-300">搜索：{search.trim()}</span>}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers3 className="h-5 w-5 text-blue-300" />
              <h2 className="text-lg font-bold">图谱关系</h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-md border border-gray-800 bg-gray-950/60 p-1">
                {[
                  ['map', '图'],
                  ['cards', '卡片'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setGraphView(key as GraphView)}
                    className={`rounded px-3 py-1 text-xs font-semibold ${
                      graphView === key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {graphLoading && <Loader2 className="h-5 w-5 animate-spin text-blue-400" />}
            </div>
          </div>

          {visibleNodes.length === 0 ? (
            <div className="py-16 text-center text-gray-500">还没有可展示的图谱数据</div>
          ) : graphView === 'map' ? (
            <div className="relative min-h-[620px] overflow-hidden rounded-lg border border-gray-800 bg-gray-950/50">
              <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                {graph?.edges
                  .filter((edge) => nodePoints[edge.source] && nodePoints[edge.target])
                  .slice(0, 180)
                  .map((edge) => {
                    const source = nodePoints[edge.source];
                    const target = nodePoints[edge.target];
                    const active = selectedNode?.id === edge.source || selectedNode?.id === edge.target;
                    return (
                      <line
                        key={edge.id}
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        stroke={active ? 'rgba(96, 165, 250, 0.85)' : 'rgba(75, 85, 99, 0.45)'}
                        strokeWidth={active ? 0.35 : 0.18}
                      />
                    );
                  })}
              </svg>
              {visibleNodes.map((node) => {
                const point = nodePoints[node.id];
                const selected = selectedNode?.id === node.id;
                if (!point) return null;
                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => setSelectedNode(node)}
                    onDoubleClick={() => focusNode(node)}
                    className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center transition-transform hover:z-10 hover:scale-105 ${
                      selected ? 'z-20' : 'z-0'
                    }`}
                    style={{ left: `${point.x}%`, top: `${point.y}%`, width: selected ? 150 : 118 }}
                  >
                    <span
                      className={`flex items-center justify-center rounded-full border shadow-lg ${nodeClasses[node.type]} ${
                        selected ? 'ring-2 ring-blue-300/80' : ''
                      }`}
                      style={{
                        width: `${graphNodeRadius(node, selected) * 8}px`,
                        height: `${graphNodeRadius(node, selected) * 8}px`,
                      }}
                    >
                      <span className="text-[10px] font-bold">{nodeLabels[node.type].slice(0, 2)}</span>
                    </span>
                    <span className="line-clamp-2 rounded bg-gray-950/80 px-2 py-1 text-xs font-semibold text-gray-200">
                      {node.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {visibleNodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setSelectedNode(node)}
                  onDoubleClick={() => focusNode(node)}
                  className={`flex flex-col justify-between rounded-lg border p-4 text-left transition-transform hover:-translate-y-0.5 ${nodeClasses[node.type]} ${nodeLayoutClass(node)} ${
                    selectedNode?.id === node.id ? 'ring-2 ring-blue-400/70' : ''
                  }`}
                >
                  <span>
                    <span className="mb-3 flex items-center justify-between gap-3">
                      <span className="rounded-full bg-black/20 px-2 py-1 text-xs font-semibold">
                        {nodeLabels[node.type]}
                      </span>
                      {node.mastery !== undefined && (
                        <span className="flex items-center gap-1 text-xs font-semibold">
                          <span className={`h-2 w-2 rounded-full ${masteryColor(node.mastery)}`} />
                          {node.mastery}
                        </span>
                      )}
                    </span>
                    <span className="block break-words text-lg font-bold leading-6">{node.label}</span>
                    {node.description && (
                      <span className="mt-2 line-clamp-4 block text-sm leading-6 opacity-80">
                        {node.description}
                      </span>
                    )}
                  </span>
                  <span className="mt-3 text-xs opacity-70">双击聚焦</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
              <Target className="h-5 w-5 text-blue-300" />
              下一步
            </h2>
            <div className="space-y-3">
              {(overview?.recommendations || []).slice(0, 5).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleRecommendation(item)}
                  className={`block w-full rounded-lg border p-3 text-left transition-colors hover:border-blue-400/70 ${recommendationTone(item.type)}`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="text-sm font-semibold text-gray-100">{item.title}</span>
                    <span className="rounded bg-black/20 px-2 py-1 text-[11px] font-semibold text-gray-300">
                      {item.priority}
                    </span>
                  </span>
                  <span className="mt-2 block text-xs leading-5 text-gray-400">{item.description}</span>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-300">
                    {item.action_label}
                    {item.action_href && !item.focus_key && <ExternalLink className="h-3 w-3" />}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {(overview?.learning_paths || []).length > 0 && (
            <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
                <Brain className="h-5 w-5 text-indigo-300" />
                学习路径
              </h2>
              <div className="space-y-3">
                {(overview?.learning_paths || []).slice(0, 4).map((path) => (
                  <div key={path.id} className={`rounded-lg border p-3 ${learningPathTone(path.type)}`}>
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-100">{path.title}</h3>
                        <p className="mt-1 text-xs leading-5 text-gray-400">{path.description}</p>
                      </div>
                      <span className="rounded bg-black/20 px-2 py-1 text-[11px] font-semibold text-gray-300">
                        {path.priority}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {path.steps.slice(0, 6).map((step, index) => {
                        const graphNode = nodeByID.get(step.node.id);
                        return (
                          <button
                            key={`${path.id}-${step.node.id}-${index}`}
                            type="button"
                            onClick={() => {
                              if (graphNode) {
                                setSelectedNode(graphNode);
                              } else {
                                focusNodeKey(step.node.id);
                              }
                            }}
                            onDoubleClick={() => focusNodeKey(step.node.id)}
                            className="flex w-full items-start gap-3 rounded-md border border-gray-800 bg-gray-950/50 p-2 text-left hover:border-blue-500/60"
                          >
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-800 text-xs font-bold text-gray-300">
                              {index + 1}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-gray-200">
                                {nodeLabels[step.node.type]} · {step.node.label}
                              </span>
                              {step.via && (
                                <span className="mt-1 block truncate text-xs text-gray-500">
                                  通过 {step.via}
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleLearningPathAction(path)}
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500"
                    >
                      {path.action_label}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(overview?.topic_clusters || []).length > 0 && (
            <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
                <Layers3 className="h-5 w-5 text-sky-300" />
                主题簇
              </h2>
              <div className="space-y-3">
                {(overview?.topic_clusters || []).slice(0, 4).map((cluster) => (
                  <div key={cluster.id} className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3">
                    <button
                      type="button"
                      onClick={() => focusNodeKey(cluster.focus_key)}
                      className="block w-full text-left"
                    >
                      <span className="block truncate text-sm font-semibold text-gray-100">
                        {cluster.topic.label}
                      </span>
                      <span className="mt-1 block text-xs text-gray-400">
                        {cluster.node_count} 节点 · {cluster.edge_count} 关系 · {cluster.article_count} 文章 · {cluster.word_count} 单词
                      </span>
                    </button>
                    {cluster.nodes.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {cluster.nodes.slice(0, 6).map((node) => {
                          const graphNode = nodeByID.get(node.id);
                          return (
                            <button
                              key={`${cluster.id}-${node.id}`}
                              type="button"
                              onClick={() => {
                                if (graphNode) {
                                  setSelectedNode(graphNode);
                                } else {
                                  focusNodeKey(node.id);
                                }
                              }}
                              className="max-w-full truncate rounded-full border border-gray-700 bg-gray-950/50 px-2 py-1 text-xs text-gray-300 hover:border-blue-500/60"
                            >
                              {nodeLabels[node.type]} · {node.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <h2 className="mb-3 text-lg font-bold">当前节点</h2>
            {selectedNode ? (
              <div>
                <div className={`mb-3 rounded-lg border p-4 ${nodeClasses[selectedNode.type]}`}>
                  <p className="mb-2 text-xs font-semibold opacity-80">{nodeLabels[selectedNode.type]}</p>
                  <h3 className="break-words text-xl font-bold">{selectedNode.label}</h3>
                  {selectedNode.description && (
                    <p className="mt-2 text-sm leading-6 opacity-80">{selectedNode.description}</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-md border border-gray-800 bg-gray-950/40 p-3">
                    <p className="text-gray-500">权重</p>
                    <p className="text-lg font-bold text-gray-100">{selectedNode.weight}</p>
                  </div>
                  <div className="rounded-md border border-gray-800 bg-gray-950/40 p-3">
                    <p className="text-gray-500">掌握度</p>
                    <p className="text-lg font-bold text-gray-100">{selectedNode.mastery ?? '-'}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => focusNode(selectedNode)}
                  className="mt-3 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
                >
                  聚焦展开
                </button>
                {selectedNode.metadata?.slug && (
                  <Link
                    href={`/articles/${selectedNode.metadata.slug}`}
                    className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900"
                  >
                    <BookOpen className="h-4 w-4" />
                    打开来源文章
                  </Link>
                )}
                {selectedNode.metadata?.vocabulary_id && (
                  <Link
                    href="/vocabulary"
                    className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900"
                  >
                    <RotateCcw className="h-4 w-4" />
                    打开生词本
                  </Link>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">选择一个节点查看详情</p>
            )}
          </section>

          <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
              <GitBranch className="h-5 w-5 text-gray-400" />
              直接关系
            </h2>
            {connectedEdges.length === 0 ? (
              <p className="text-sm text-gray-500">暂无直接关系</p>
            ) : (
              <div className="space-y-2">
                {connectedEdges.slice(0, 12).map((edge) => (
                  (() => {
                    const otherID = edge.source === selectedNode?.id ? edge.target : edge.source;
                    const otherNode = nodeByID.get(otherID);
                    return (
                      <button
                        key={edge.id}
                        type="button"
                        onClick={() => {
                          if (otherNode) setSelectedNode(otherNode);
                        }}
                        onDoubleClick={() => {
                          if (otherNode) focusNode(otherNode);
                        }}
                        className="block w-full rounded-md border border-gray-800 bg-gray-950/40 p-3 text-left hover:border-blue-500/60"
                      >
                        <p className="text-sm font-semibold text-gray-200">{edge.label || edge.relation}</p>
                        <p className="mt-1 line-clamp-1 text-xs text-gray-400">
                          {otherNode ? `${nodeLabels[otherNode.type]} · ${otherNode.label}` : otherID}
                        </p>
                        <p className="mt-1 text-xs text-gray-600">权重 {edge.weight}</p>
                      </button>
                    );
                  })()
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
              <TriangleAlert className="h-5 w-5 text-amber-300" />
              薄弱与复习
            </h2>
            <div className="space-y-3">
              {(overview?.weak_nodes || []).slice(0, 4).map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => focusNode(node)}
                  className="block w-full rounded-md border border-gray-800 bg-gray-950/40 p-3 text-left hover:border-amber-500/60"
                >
                  <p className="truncate text-sm font-semibold text-gray-200">{node.label}</p>
                  <p className="mt-1 text-xs text-gray-500">{node.description || '薄弱节点'}</p>
                </button>
              ))}
              {(overview?.due_nodes || []).slice(0, 4).map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => focusNode(node)}
                  className="block w-full rounded-md border border-gray-800 bg-gray-950/40 p-3 text-left hover:border-lime-500/60"
                >
                  <p className="truncate text-sm font-semibold text-gray-200">{node.label}</p>
                  <p className="mt-1 text-xs text-gray-500">待复习</p>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
