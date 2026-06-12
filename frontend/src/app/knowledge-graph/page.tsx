'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BookOpen, Brain, CircleDot, ExternalLink, GitBranch, Layers3,
  Loader2, Network, RotateCcw, Search, Target, TriangleAlert, X,
} from 'lucide-react';
import { knowledgeGraphAPI } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import {
  KnowledgeGraph, KnowledgeGraphGroup, KnowledgeGraphLearningPath,
  KnowledgeGraphNode, KnowledgeGraphOverview, KnowledgeGraphRecommendation,
} from '@/types';

/* ── type / filter definitions ───────────────────────────── */
type GraphFilter = 'all' | 'word' | 'article' | 'topic' | 'grammar' | 'context' | 'vocabulary';
type GraphView = 'map' | 'cards';

const filterLabels: Record<GraphFilter, string> = {
  all: '全部', vocabulary: '词汇', word: '单词', article: '文章',
  topic: '主题', grammar: '语法', context: '语境',
};

const nodeLabels: Record<string, string> = {
  word: '单词', meaning: '释义', definition: '解释', context: '语境',
  example: '例句', article: '文章', topic: '主题', grammar: '语法',
  weakness: '薄弱点', review: '复习',
};

const typeColors: Record<string, string> = {
  word: '#3b82f6', meaning: '#10b981', definition: '#06b6d4', context: '#8b5cf6',
  example: '#d946ef', article: '#f59e0b', topic: '#0ea5e9', grammar: '#6366f1',
  weakness: '#ef4444', review: '#84cc16',
};

const groupColors: Record<string, string> = {
  vocabulary: '#3b82f6', context: '#8b5cf6', article: '#f59e0b', study: '#ef4444',
};

/* ── force simulation types ──────────────────────────────── */
interface SimNode {
  id: string; x: number; y: number; vx: number; vy: number;
  type: string; group: string; weight: number; radius: number;
  data: KnowledgeGraphNode; pinned: boolean;
}
interface SimEdge { source: string; target: string; weight: number; }

function nodeRadius(n: KnowledgeGraphNode): number {
  if (n.type === 'word') return Math.max(14, 8 + n.weight * 0.08);
  if (n.type === 'article') return Math.max(12, 7 + n.weight * 0.06);
  if (n.weight >= 80) return 10;
  return 8;
}

function initSimNodes(nodes: KnowledgeGraphNode[]): SimNode[] {
  const cx = 0, cy = 0;
  return nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1);
    const r = 120 + Math.random() * 80;
    return {
      id: n.id, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r,
      vx: 0, vy: 0, type: n.type, group: n.group || 'other',
      weight: n.weight, radius: nodeRadius(n), data: n, pinned: false,
    };
  });
}

function runForceStep(nodes: SimNode[], edges: SimEdge[], alpha: number) {
  const repulsion = 3200, springK = 0.008, springLen = 100;
  const groupPull = 0.003, centerPull = 0.01, damping = 0.72;
  // repulsion
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = a.x - b.x, dy = a.y - b.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const minDist = a.radius + b.radius + 8;
      if (dist < minDist) dist = minDist;
      const force = (repulsion * alpha) / (dist * dist);
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      if (!a.pinned) { a.vx += fx; a.vy += fy; }
      if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
    }
  }
  // spring (edges)
  const posMap = new Map(nodes.map(n => [n.id, n]));
  for (const e of edges) {
    const a = posMap.get(e.source), b = posMap.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = (dist - springLen) * springK * alpha;
    const fx = (dx / dist) * force, fy = (dy / dist) * force;
    if (!a.pinned) { a.vx += fx; a.vy += fy; }
    if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
  }
  // group clustering
  const groupCenters = new Map<string, { x: number; y: number; c: number }>();
  for (const n of nodes) {
    const g = groupCenters.get(n.group) || { x: 0, y: 0, c: 0 };
    g.x += n.x; g.y += n.y; g.c++;
    groupCenters.set(n.group, g);
  }
  for (const n of nodes) {
    if (n.pinned) continue;
    const g = groupCenters.get(n.group);
    if (g && g.c > 1) {
      n.vx += ((g.x / g.c) - n.x) * groupPull * alpha;
      n.vy += ((g.y / g.c) - n.y) * groupPull * alpha;
    }
    n.vx -= n.x * centerPull * alpha;
    n.vy -= n.y * centerPull * alpha;
    n.vx *= damping; n.vy *= damping;
    n.x += n.vx; n.y += n.vy;
  }
}

/* ── mastery helpers ─────────────────────────────────────── */
function masteryColor(v?: number) {
  if (v === undefined) return 'bg-gray-700';
  if (v >= 75) return 'bg-green-500';
  if (v >= 45) return 'bg-amber-500';
  return 'bg-red-500';
}
function masteryPct(v?: number) { return v ?? 0; }

/* ── recommendation / path tones ─────────────────────────── */
function recommendationTone(t: string) {
  if (t === 'review') return 'border-lime-500/50 bg-lime-500/10';
  if (t === 'weakness') return 'border-red-500/50 bg-red-500/10';
  if (t === 'grammar') return 'border-indigo-500/50 bg-indigo-500/10';
  if (t === 'reading') return 'border-amber-500/50 bg-amber-500/10';
  return 'border-blue-500/40 bg-blue-500/10';
}
function learningPathTone(t: string) {
  if (t === 'review') return 'border-lime-500/40 bg-lime-500/10';
  if (t === 'weakness') return 'border-red-500/40 bg-red-500/10';
  if (t === 'topic') return 'border-amber-500/40 bg-amber-500/10';
  return 'border-blue-500/40 bg-blue-500/10';
}

/* ══════════════════════════════════════════════════════════ */
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
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: SimNode } | null>(null);
  const graphRequestRef = useRef(0);

  // canvas + simulation refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<{ nodes: SimNode[]; edges: SimEdge[]; alpha: number; running: boolean }>({
    nodes: [], edges: [], alpha: 1, running: false,
  });
  const dragRef = useRef<{ node: SimNode | null; offsetX: number; offsetY: number }>({ node: null, offsetX: 0, offsetY: 0 });
  const animRef = useRef<number>(0);
  const transformRef = useRef<{ ox: number; oy: number; scale: number }>({ ox: 0, oy: 0, scale: 1 });

  useEffect(() => { setMounted(true); }, []);

  /* ── data loading ──────────────────────────────────────── */
  const loadGraph = useCallback(async (params?: { focus_key?: string; types?: string; search?: string }) => {
    const requestID = graphRequestRef.current + 1;
    graphRequestRef.current = requestID;
    try {
      setGraphLoading(true);
      const response = await knowledgeGraphAPI.getGraph({ depth: params?.focus_key ? 3 : 2, limit: 180, ...params });
      if (requestID !== graphRequestRef.current) return;
      const nextGraph = response.data.data as KnowledgeGraph;
      setGraph(nextGraph);
      setSelectedNode(nextGraph.focus || nextGraph.nodes[0] || null);
    } catch (err: any) {
      if (requestID !== graphRequestRef.current) return;
      setError(err.response?.data?.error || '知识图谱加载失败');
    } finally { if (requestID === graphRequestRef.current) setGraphLoading(false); }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated || !token) { router.replace('/login'); return; }
    const load = async () => {
      const requestID = graphRequestRef.current + 1;
      graphRequestRef.current = requestID;
      try {
        setLoading(true); setError('');
        const [ovR, gR] = await Promise.all([knowledgeGraphAPI.getOverview(), knowledgeGraphAPI.getGraph({ depth: 2, limit: 180 })]);
        if (requestID !== graphRequestRef.current) return;
        setOverview(ovR.data.data as KnowledgeGraphOverview);
        const g = gR.data.data as KnowledgeGraph;
        setGraph(g); setSelectedNode(g.nodes[0] || null);
      } catch (err: any) {
        if (requestID !== graphRequestRef.current) return;
        setError(err.response?.data?.error || '知识图谱加载失败');
      } finally { if (requestID === graphRequestRef.current) setLoading(false); }
    };
    load();
  }, [isAuthenticated, loadGraph, mounted, router, token]);

  /* ── filtered nodes ────────────────────────────────────── */
  const visibleNodes = useMemo(() => {
    if (!graph) return [];
    return graph.nodes.filter((n: KnowledgeGraphNode) => {
      if (hiddenGroups.has(n.group || 'other')) return false;
      if (filter !== 'all') {
        if (filter === 'vocabulary' && n.group !== 'vocabulary') return false;
        if (filter === 'context' && n.group !== 'context') return false;
        if (filter !== 'vocabulary' && filter !== 'context' && n.type !== filter) return false;
      }
      return true;
    });
  }, [graph, filter, hiddenGroups]);

  const searchMatches = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.trim().toLowerCase();
    const ids = new Set<string>();
    visibleNodes.forEach((n: KnowledgeGraphNode) => {
      if (n.label.toLowerCase().includes(q) || (n.description || '').toLowerCase().includes(q)) ids.add(n.id);
    });
    return ids;
  }, [visibleNodes, search]);

  const connectedEdges = useMemo(() => {
    if (!graph || !selectedNode) return [];
    return graph.edges.filter((e: { source: string; target: string }) => e.source === selectedNode.id || e.target === selectedNode.id);
  }, [graph, selectedNode]);

  const nodeByID = useMemo(() => {
    const m = new Map<string, KnowledgeGraphNode>();
    visibleNodes.forEach((n: KnowledgeGraphNode) => m.set(n.id, n));
    return m;
  }, [visibleNodes]);

  /* ── simulation init ───────────────────────────────────── */
  useEffect(() => {
    const vis = visibleNodes;
    const edgeList = (graph?.edges || []).filter((e: { source: string; target: string }) => vis.some((n: KnowledgeGraphNode) => n.id === e.source) && vis.some((n: KnowledgeGraphNode) => n.id === e.target));
    const nodes = initSimNodes(vis);
    const edges: SimEdge[] = edgeList.map((e: { source: string; target: string; weight: number }) => ({ source: e.source, target: e.target, weight: e.weight }));
    simRef.current = { nodes, edges, alpha: 1, running: true };
    transformRef.current = { ox: 0, oy: 0, scale: 1 };
  }, [visibleNodes, graph]);

  /* ── canvas rendering loop ─────────────────────────────── */
  useEffect(() => {
    if (graphView !== 'map') return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      transformRef.current.ox = rect.width / 2;
      transformRef.current.oy = rect.height / 2;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const selectedID = selectedNode?.id;
    const draw = () => {
      const sim = simRef.current;
      const t = transformRef.current;
      const dpr = window.devicePixelRatio;
      const w = canvas.width / dpr, h = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(t.ox, t.oy);
      ctx.scale(t.scale, t.scale);

      // edges
      const posMap = new Map<string, SimNode>(sim.nodes.map((n: SimNode) => [n.id, n] as [string, SimNode]));
      for (const e of sim.edges) {
        const a = posMap.get(e.source), b = posMap.get(e.target);
        if (!a || !b) continue;
        const active = selectedID === e.source || selectedID === e.target;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = active ? 'rgba(96,165,250,0.8)' : 'rgba(75,85,99,0.3)';
        ctx.lineWidth = active ? 2 / t.scale : 0.8 / t.scale;
        ctx.stroke();
      }

      // nodes
      for (const n of sim.nodes) {
        const isSelected = n.id === selectedID;
        const isMatch = searchMatches ? searchMatches.has(n.id) : true;
        const color = typeColors[n.type] || '#6b7280';
        const alpha = searchMatches && !isMatch ? 0.18 : 1;
        ctx.globalAlpha = alpha;
        // glow for selected
        if (isSelected) {
          ctx.beginPath(); ctx.arc(n.x, n.y, n.radius + 6, 0, Math.PI * 2);
          ctx.fillStyle = color + '33'; ctx.fill();
        }
        // circle
        ctx.beginPath(); ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = color + '30'; ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = isSelected ? 2.5 / t.scale : 1.5 / t.scale;
        ctx.stroke();
        // label
        const fontSize = Math.max(9, Math.min(12, n.radius * 0.85));
        ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
        ctx.fillStyle = '#e5e7eb';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        const label = n.data.label.length > 10 ? n.data.label.slice(0, 9) + '…' : n.data.label;
        ctx.fillText(label, n.x, n.y + n.radius + 3);
        // type badge
        ctx.font = `700 ${Math.max(7, n.radius * 0.55)}px system-ui`;
        ctx.fillStyle = color;
        ctx.textBaseline = 'middle';
        const badge = nodeLabels[n.type]?.slice(0, 2) || '?';
        ctx.fillText(badge, n.x, n.y);
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      // simulation step
      if (sim.running && sim.alpha > 0.005) {
        runForceStep(sim.nodes, sim.edges, sim.alpha);
        sim.alpha *= 0.995;
      } else { sim.running = false; }

      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(animRef.current); ro.disconnect(); };
  }, [graphView, selectedNode, searchMatches, visibleNodes]);

  /* ── canvas mouse handlers ─────────────────────────────── */
  const hitTest = useCallback((mx: number, my: number): SimNode | null => {
    const t = transformRef.current;
    const wx = (mx - t.ox) / t.scale, wy = (my - t.oy) / t.scale;
    for (let i = simRef.current.nodes.length - 1; i >= 0; i--) {
      const n = simRef.current.nodes[i];
      const dx = n.x - wx, dy = n.y - wy;
      if (dx * dx + dy * dy <= (n.radius + 4) * (n.radius + 4)) return n;
    }
    return null;
  }, []);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const node = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (node) {
      dragRef.current = { node, offsetX: 0, offsetY: 0 };
      node.pinned = true;
      simRef.current.alpha = Math.max(simRef.current.alpha, 0.3);
      simRef.current.running = true;
    }
  }, [hitTest]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (dragRef.current.node) {
      const t = transformRef.current;
      dragRef.current.node.x = (mx - t.ox) / t.scale;
      dragRef.current.node.y = (my - t.oy) / t.scale;
      setTooltip(null);
    } else {
      const node = hitTest(mx, my);
      if (node) {
        setTooltip({ x: e.clientX, y: e.clientY, node });
        canvasRef.current!.style.cursor = 'pointer';
      } else {
        setTooltip(null);
        canvasRef.current!.style.cursor = 'grab';
      }
    }
  }, [hitTest]);

  const handleCanvasMouseUp = useCallback(() => {
    if (dragRef.current.node) {
      dragRef.current.node.pinned = false;
      dragRef.current.node = null;
    }
  }, []);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const node = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (node) setSelectedNode(node.data);
  }, [hitTest]);

  const handleCanvasDblClick = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const node = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (node) { setSelectedNode(node.data); loadGraph({ focus_key: node.id }); }
  }, [hitTest, loadGraph]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const t = transformRef.current;
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    t.scale = Math.max(0.2, Math.min(4, t.scale * factor));
  }, []);

  /* ── actions ───────────────────────────────────────────── */
  const applyFilters = () => { loadGraph({ types: filter === 'all' ? undefined : filter, search: search.trim() || undefined }); };
  const resetGraph = () => { setFilter('all'); setSearch(''); setHiddenGroups(new Set()); loadGraph(); };
  const focusNode = (node: KnowledgeGraphNode) => { setSelectedNode(node); loadGraph({ focus_key: node.id }); };
  const focusNodeKey = (k: string) => { loadGraph({ focus_key: k }); };
  const handleRecommendation = (r: KnowledgeGraphRecommendation) => {
    if (r.focus_key) { focusNodeKey(r.focus_key); return; }
    if (r.action_href) router.push(r.action_href);
  };
  const handleLearningPathAction = (p: KnowledgeGraphLearningPath) => {
    if (p.focus_key) { focusNodeKey(p.focus_key); return; }
    if (p.action_href) router.push(p.action_href);
  };
  const refreshGraph = async () => {
    try { setRefreshing(true); setError('');
      const r = await knowledgeGraphAPI.refresh();
      setOverview(r.data.data as KnowledgeGraphOverview);
      await loadGraph({ types: filter === 'all' ? undefined : filter, search: search.trim() || undefined });
    } catch (err: any) { setError(err.response?.data?.error || '刷新失败'); }
    finally { setRefreshing(false); }
  };
  const toggleGroup = (g: string) => {
    setHiddenGroups((prev: Set<string>) => { const s = new Set(prev); s.has(g) ? s.delete(g) : s.add(g); return s; });
  };

  /* ── render guards ─────────────────────────────────────── */
  if (!mounted || loading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /></div>;
  if (error && !graph) return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-6 text-red-100">
        <h1 className="mb-2 text-2xl font-bold">无法加载知识图谱</h1>
        <p className="mb-5 text-sm">{error}</p>
        <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400">重新加载</button>
      </div>
    </div>
  );

  const stats = overview?.stats || graph?.stats;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* header */}
      <section className="mb-6 border-b border-gray-800 pb-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-sm font-semibold text-blue-300"><Network className="h-4 w-4" />知识图谱</div>
            <h1 className="text-3xl font-black tracking-tight text-gray-100 md:text-4xl">你的英语学习关系网</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-500">将生词、释义、语境、文章、语法和复习计划连接成清晰的知识网络。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/vocabulary?mode=review" className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"><RotateCcw className="h-4 w-4" />复习</Link>
            <button type="button" onClick={refreshGraph} disabled={refreshing} className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900 disabled:opacity-60">{refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}刷新</button>
          </div>
        </div>
      </section>

      {/* stats */}
      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[{ label: '节点', value: stats?.total_nodes || 0, icon: CircleDot }, { label: '关系', value: stats?.total_edges || 0, icon: GitBranch }, { label: '语法点', value: stats?.grammar_points || 0, icon: Brain }, { label: '待复习', value: stats?.due_reviews || 0, icon: Target }].map(item => {
          const Icon = item.icon;
          return (<div key={item.label} className="rounded-lg border border-gray-800 bg-gray-900/50 p-4"><div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-gray-800 text-blue-300"><Icon className="h-4 w-4" /></div><p className="text-sm text-gray-500">{item.label}</p><p className="mt-1 text-2xl font-bold text-gray-100">{item.value}</p></div>);
        })}
      </section>

      {/* filters */}
      <section className="mb-6 rounded-lg border border-gray-800 bg-gray-900/50 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(filterLabels) as GraphFilter[]).map(key => (
              <button key={key} type="button" onClick={() => setFilter(key)} className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${filter === key ? 'bg-blue-600 text-white' : 'bg-gray-950/60 text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}>{filterLabels[key]}</button>
            ))}
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
            <label className="relative block w-full lg:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applyFilters(); }} placeholder="搜索单词、主题…" className="w-full rounded-md border border-gray-700 bg-gray-950 py-2 pl-9 pr-3 text-sm text-gray-100 outline-none placeholder:text-gray-600 focus:border-blue-500" />
            </label>
            <button type="button" onClick={applyFilters} disabled={graphLoading} className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60">{graphLoading && <Loader2 className="h-4 w-4 animate-spin" />}应用</button>
            <button type="button" onClick={resetGraph} disabled={graphLoading} className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900 disabled:opacity-50"><X className="h-4 w-4" />重置</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span>展示 {visibleNodes.length} 节点 / {graph?.edges.length || 0} 关系</span>
          {graph?.focus && <span className="rounded bg-gray-800 px-2 py-1 text-gray-300">聚焦：{graph.focus.label}</span>}
        </div>
      </section>

      {/* main grid */}
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        {/* graph area */}
        <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2"><Layers3 className="h-5 w-5 text-blue-300" /><h2 className="text-lg font-bold">图谱关系</h2></div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-md border border-gray-800 bg-gray-950/60 p-1">
                {([['map', '图'], ['cards', '卡片']] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setGraphView(k)} className={`rounded px-3 py-1 text-xs font-semibold ${graphView === k ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800'}`}>{l}</button>
                ))}
              </div>
              {graphLoading && <Loader2 className="h-5 w-5 animate-spin text-blue-400" />}
            </div>
          </div>

          {/* legend */}
          {(graph?.groups || []).length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3">
              {graph!.groups!.map(g => (
                <button key={g.id} type="button" onClick={() => toggleGroup(g.id)} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-opacity ${hiddenGroups.has(g.id) ? 'opacity-30' : 'opacity-100'}`} style={{ borderColor: g.color + '66', color: g.color }}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: g.color }} />{g.label}
                  <span className="text-gray-500">({g.node_count})</span>
                </button>
              ))}
            </div>
          )}

          {visibleNodes.length === 0 ? (
            <div className="py-16 text-center text-gray-500">暂无图谱数据</div>
          ) : graphView === 'map' ? (
            <div ref={containerRef} className="relative min-h-[560px] overflow-hidden rounded-lg border border-gray-800 bg-gray-950/50">
              <canvas ref={canvasRef} className="absolute inset-0" onMouseDown={handleCanvasMouseDown} onMouseMove={handleCanvasMouseMove} onMouseUp={handleCanvasMouseUp} onMouseLeave={() => { handleCanvasMouseUp(); setTooltip(null); }} onClick={handleCanvasClick} onDoubleClick={handleCanvasDblClick} onWheel={handleWheel} />
              {tooltip && (
                <div className="pointer-events-none fixed z-50 rounded-lg border border-gray-700 bg-gray-900/95 px-3 py-2 shadow-xl" style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}>
                  <p className="text-xs font-semibold" style={{ color: typeColors[tooltip.node.type] }}>{nodeLabels[tooltip.node.type]} · {tooltip.node.data.label}</p>
                  {tooltip.node.data.mastery !== undefined && <p className="mt-1 text-[11px] text-gray-400">掌握度 {tooltip.node.data.mastery}%</p>}
                  <p className="text-[11px] text-gray-500">单击选中 · 双击聚焦</p>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {visibleNodes.map(node => (
                <button key={node.id} type="button" onClick={() => setSelectedNode(node)} onDoubleClick={() => focusNode(node)} className={`flex flex-col justify-between rounded-lg border p-4 text-left transition-transform hover:-translate-y-0.5 ${selectedNode?.id === node.id ? 'ring-2 ring-blue-400/70' : ''}`} style={{ borderColor: typeColors[node.type] + '55', backgroundColor: typeColors[node.type] + '10' }}>
                  <span>
                    <span className="mb-3 flex items-center justify-between gap-3">
                      <span className="rounded-full bg-black/20 px-2 py-1 text-xs font-semibold" style={{ color: typeColors[node.type] }}>{nodeLabels[node.type]}</span>
                      {node.mastery !== undefined && <span className="flex items-center gap-1 text-xs font-semibold"><span className={`h-2 w-2 rounded-full ${masteryColor(node.mastery)}`} />{node.mastery}</span>}
                    </span>
                    <span className="block break-words text-lg font-bold leading-6 text-gray-100">{node.label}</span>
                    {node.description && <span className="mt-2 line-clamp-3 block text-sm leading-6 text-gray-400">{node.description}</span>}
                  </span>
                  <span className="mt-3 text-xs text-gray-500">双击聚焦</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* sidebar */}
        <aside className="space-y-5">
          {/* node detail */}
          <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <h2 className="mb-3 text-lg font-bold">节点详情</h2>
            {selectedNode ? (
              <div>
                <div className="mb-3 rounded-lg border p-4" style={{ borderColor: typeColors[selectedNode.type] + '55', backgroundColor: typeColors[selectedNode.type] + '10' }}>
                  <p className="mb-1 text-xs font-semibold" style={{ color: typeColors[selectedNode.type] }}>{nodeLabels[selectedNode.type]}</p>
                  <h3 className="break-words text-xl font-bold text-gray-100">{selectedNode.label}</h3>
                  {selectedNode.description && <p className="mt-2 text-sm leading-6 text-gray-400">{selectedNode.description}</p>}
                </div>
                {/* mastery bar */}
                {selectedNode.mastery !== undefined && (
                  <div className="mb-3">
                    <div className="mb-1 flex justify-between text-xs text-gray-500"><span>掌握度</span><span>{selectedNode.mastery}%</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-800"><div className={`h-full rounded-full ${masteryColor(selectedNode.mastery)}`} style={{ width: `${masteryPct(selectedNode.mastery)}%` }} /></div>
                  </div>
                )}
                {/* metadata details */}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-md border border-gray-800 bg-gray-950/40 p-3"><p className="text-gray-500">权重</p><p className="text-lg font-bold text-gray-100">{selectedNode.weight}</p></div>
                  {selectedNode.metadata?.phonetic && <div className="rounded-md border border-gray-800 bg-gray-950/40 p-3"><p className="text-gray-500">音标</p><p className="text-sm font-semibold text-gray-200">{selectedNode.metadata.phonetic}</p></div>}
                  {selectedNode.metadata?.weak_flag && <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3"><p className="text-red-400">薄弱</p><p className="text-sm font-bold text-red-200">忘记 {selectedNode.metadata.forgotten_count} 次</p></div>}
                  {selectedNode.metadata?.review_scheduled && <div className="rounded-md border border-lime-500/30 bg-lime-500/10 p-3"><p className="text-lime-400">复习</p><p className="text-sm font-bold text-lime-200">{selectedNode.metadata.review_date}</p></div>}
                </div>
                {/* actions */}
                <div className="mt-3 flex flex-col gap-2">
                  <button type="button" onClick={() => focusNode(selectedNode)} className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">聚焦展开</button>
                  {selectedNode.metadata?.slug && <Link href={`/articles/${selectedNode.metadata.slug}`} className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900"><BookOpen className="h-4 w-4" />打开文章</Link>}
                  {selectedNode.metadata?.vocabulary_id && <Link href="/vocabulary" className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900"><RotateCcw className="h-4 w-4" />打开生词本</Link>}
                </div>
              </div>
            ) : <p className="text-sm text-gray-500">选择一个节点查看详情</p>}
          </section>

          {/* connected edges */}
          <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><GitBranch className="h-5 w-5 text-gray-400" />关联关系</h2>
            {connectedEdges.length === 0 ? <p className="text-sm text-gray-500">暂无关联</p> : (
              <div className="space-y-2">
                {connectedEdges.slice(0, 12).map(edge => {
                  const otherID = edge.source === selectedNode?.id ? edge.target : edge.source;
                  const other = nodeByID.get(otherID);
                  return (
                    <button key={edge.id} type="button" onClick={() => { if (other) setSelectedNode(other); }} onDoubleClick={() => { if (other) focusNode(other); }} className="block w-full rounded-md border border-gray-800 bg-gray-950/40 p-3 text-left hover:border-blue-500/60">
                      <p className="text-sm font-semibold text-gray-200">{edge.label || edge.relation}</p>
                      <p className="mt-1 line-clamp-1 text-xs" style={{ color: other ? typeColors[other.type] : '#9ca3af' }}>{other ? `${nodeLabels[other.type]} · ${other.label}` : otherID}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* recommendations */}
          <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Target className="h-5 w-5 text-blue-300" />下一步</h2>
            <div className="space-y-3">
              {(overview?.recommendations || []).slice(0, 4).map(item => (
                <button key={item.id} type="button" onClick={() => handleRecommendation(item)} className={`block w-full rounded-lg border p-3 text-left transition-colors hover:border-blue-400/70 ${recommendationTone(item.type)}`}>
                  <span className="flex items-start justify-between gap-3"><span className="text-sm font-semibold text-gray-100">{item.title}</span><span className="rounded bg-black/20 px-2 py-1 text-[11px] font-semibold text-gray-300">{item.priority}</span></span>
                  <span className="mt-2 block text-xs leading-5 text-gray-400">{item.description}</span>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-300">{item.action_label}{item.action_href && !item.focus_key && <ExternalLink className="h-3 w-3" />}</span>
                </button>
              ))}
            </div>
          </section>

          {/* learning paths */}
          {(overview?.learning_paths || []).length > 0 && (
            <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Brain className="h-5 w-5 text-indigo-300" />学习路径</h2>
              <div className="space-y-3">
                {(overview?.learning_paths || []).slice(0, 3).map(path => (
                  <div key={path.id} className={`rounded-lg border p-3 ${learningPathTone(path.type)}`}>
                    <h3 className="text-sm font-semibold text-gray-100">{path.title}</h3>
                    <p className="mt-1 text-xs text-gray-400">{path.description}</p>
                    <div className="mt-2 space-y-1">
                      {path.steps.slice(0, 4).map((step, i) => {
                        const gn = nodeByID.get(step.node.id);
                        return (
                          <button key={`${path.id}-${i}`} type="button" onClick={() => { if (gn) setSelectedNode(gn); else focusNodeKey(step.node.id); }} className="flex w-full items-center gap-2 rounded-md border border-gray-800 bg-gray-950/50 p-2 text-left text-xs hover:border-blue-500/60">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-800 text-[10px] font-bold text-gray-300">{i + 1}</span>
                            <span className="truncate text-gray-200">{nodeLabels[step.node.type]} · {step.node.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <button type="button" onClick={() => handleLearningPathAction(path)} className="mt-2 w-full rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500">{path.action_label}</button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* weak / due */}
          <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><TriangleAlert className="h-5 w-5 text-amber-300" />薄弱与复习</h2>
            <div className="space-y-2">
              {(overview?.weak_nodes || []).slice(0, 3).map(n => (
                <button key={n.id} type="button" onClick={() => focusNode(n)} className="block w-full rounded-md border border-gray-800 bg-gray-950/40 p-2.5 text-left hover:border-amber-500/60">
                  <p className="truncate text-sm font-semibold text-gray-200">{n.label}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{n.description || '薄弱节点'}</p>
                </button>
              ))}
              {(overview?.due_nodes || []).slice(0, 3).map(n => (
                <button key={n.id} type="button" onClick={() => focusNode(n)} className="block w-full rounded-md border border-gray-800 bg-gray-950/40 p-2.5 text-left hover:border-lime-500/60">
                  <p className="truncate text-sm font-semibold text-gray-200">{n.label}</p>
                  <p className="mt-0.5 text-xs text-gray-500">待复习</p>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
