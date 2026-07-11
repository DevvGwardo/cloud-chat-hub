import { useState } from 'react';
import { Search, Globe, Terminal, Eye, FileText, Code, ChevronDown, ChevronRight, Check, Zap, Layers, GitMerge, AlertTriangle } from 'lucide-react';

export interface ToolActivityEvent {
  tool: string;
  status: 'running' | 'completed';
  input: string;
  output: string | null;
  /** Byte offset into the accumulated content stream where this tool was emitted. */
  textOffset?: number;
}

const TOOL_ICONS: Record<string, typeof Search> = {
  web_search: Search,
  search: Search,
  browser: Globe,
  browse: Globe,
  terminal: Terminal,
  shell: Terminal,
  vision: Eye,
  image: Eye,
  file: FileText,
  files: FileText,
  code: Code,
  code_execution: Code,
  'moa.reference': Layers,
  'moa.aggregating': GitMerge,
  'lsp.diagnostic': AlertTriangle,
};

function getToolIcon(toolName: string) {
  const lower = toolName.toLowerCase();
  if (TOOL_ICONS[lower]) return TOOL_ICONS[lower];
  for (const [key, Icon] of Object.entries(TOOL_ICONS)) {
    if (lower.includes(key)) return Icon;
  }
  return Code;
}

function parseJsonSafe(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input.trim());
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Extract a short label from tool input JSON */
function extractLabel(tool: string, input: string): string {
  if (tool === 'moa.reference') {
    const meta = parseJsonSafe(input);
    if (meta?.label) return String(meta.label);
    return 'Advisor';
  }
  if (tool === 'moa.aggregating') {
    const meta = parseJsonSafe(input);
    if (meta?.aggregator) return String(meta.aggregator);
    return 'Synthesizing';
  }
  try {
    const parsed = JSON.parse(input.trim());
    if (parsed.path) return parsed.path.split('/').slice(-2).join('/');
    if (parsed.filename) return parsed.filename;
    if (parsed.query) return parsed.query.slice(0, 50);
    if (parsed.url) return parsed.url.slice(0, 60);
  } catch { /* ignore */ }
  return input.slice(0, 60) + (input.length > 60 ? '...' : '');
}

function isMoaEvent(tool: string): boolean {
  return tool === 'moa.reference' || tool === 'moa.aggregating';
}

function isLspDiagnosticEvent(tool: string): boolean {
  return tool === 'lsp.diagnostic';
}

function ToolEvent({ event }: { event: ToolActivityEvent }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = getToolIcon(event.tool);
  const isRunning = event.status === 'running';
  const label = extractLabel(event.tool, event.input);
  const moa = isMoaEvent(event.tool);
  const lsp = isLspDiagnosticEvent(event.tool);
  const meta = moa || lsp ? parseJsonSafe(event.input) : null;

  const title =
    event.tool === 'moa.reference'
      ? `Advisor${meta?.label ? ` · ${meta.label}` : ''}`
      : event.tool === 'moa.aggregating'
        ? `Aggregating${meta?.aggregator ? ` · ${meta.aggregator}` : ''}`
        : event.tool === 'lsp.diagnostic'
          ? `LSP${meta?.path ? ` · ${String(meta.path).split('/').slice(-2).join('/')}` : ''}`
          : event.tool;

  return (
    <div className={`border-b border-border/30 last:border-b-0 ${moa ? 'bg-primary/[0.03]' : ''} ${lsp ? 'bg-amber-500/[0.04]' : ''}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-[12px] hover:bg-muted/30 transition-colors duration-75"
      >
        {isRunning ? (
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
          </span>
        ) : (
          <Check className="w-3 h-3 text-emerald-500 shrink-0" />
        )}
        <Icon className={`w-3 h-3 shrink-0 ${moa ? 'text-primary/80' : lsp ? 'text-amber-400/80' : 'text-muted-foreground/60'}`} />
        <span className={`font-mono text-[11px] truncate ${moa || lsp ? 'text-foreground/80' : 'text-muted-foreground'}`}>
          {title}
        </span>
        {!moa && !lsp && (
          <span className="text-muted-foreground/40 font-mono text-[10px] truncate ml-1">
            {label}
          </span>
        )}
        {event.tool === 'moa.reference' && meta?.index != null && meta?.count != null && (
          <span className="text-[10px] font-mono text-muted-foreground/50 ml-1">
            {Number(meta.index) + 1}/{String(meta.count)}
          </span>
        )}
        <div className="ml-auto shrink-0">
          {expanded ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground/40" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
          )}
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-1">
          {lsp && event.output ? (
            <div className="text-[11px] text-muted-foreground/70">
              <span className="font-medium text-amber-400/90">Diagnostics</span>
              {meta?.source_tool ? (
                <span className="ml-2 font-mono text-[10px] text-muted-foreground/50">
                  via {String(meta.source_tool)}
                </span>
              ) : null}
              <pre className="font-mono whitespace-pre-wrap mt-1 bg-amber-500/5 rounded-md p-2 max-h-48 overflow-auto text-[10px] border border-amber-500/15 text-amber-100/80">
                {event.output}
              </pre>
            </div>
          ) : moa && event.output ? (
            <div className="text-[11px] text-muted-foreground/70">
              <span className="font-medium text-muted-foreground">
                {event.tool === 'moa.reference' ? 'Advice' : 'Status'}
              </span>
              <pre className="font-mono whitespace-pre-wrap mt-1 bg-muted/30 rounded-md p-2 max-h-48 overflow-auto text-[10px] border border-border/20">
                {event.output}
              </pre>
            </div>
          ) : (
            <>
              <div className="text-[11px] text-muted-foreground/70">
                <span className="font-medium text-muted-foreground">Input</span>
                <pre className="font-mono whitespace-pre-wrap mt-1 bg-muted/30 rounded-md p-2 max-h-32 overflow-auto text-[10px] border border-border/20">
                  {event.input}
                </pre>
              </div>
              {event.output && (
                <div className="text-[11px] text-muted-foreground/70">
                  <span className="font-medium text-muted-foreground">Output</span>
                  <pre className="font-mono whitespace-pre-wrap mt-1 bg-muted/30 rounded-md p-2 max-h-32 overflow-auto text-[10px] border border-border/20">
                    {event.output}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentActivity({ events }: { events: ToolActivityEvent[] }) {
  const [expanded, setExpanded] = useState(false);

  if (events.length === 0) return null;

  const completedCount = events.filter((e) => e.status === 'completed').length;
  const runningCount = events.filter((e) => e.status === 'running').length;
  const moaAdvisorCount = events.filter((e) => e.tool === 'moa.reference').length;
  const lspCount = events.filter((e) => e.tool === 'lsp.diagnostic').length;
  const hasMoa = moaAdvisorCount > 0 || events.some((e) => e.tool === 'moa.aggregating');
  const hasLsp = lspCount > 0;

  let headerLabel: string;
  if (hasMoa) {
    if (runningCount > 0) {
      headerLabel = `MoA · ${runningCount} running`;
    } else if (moaAdvisorCount > 0) {
      headerLabel = `MoA · ${moaAdvisorCount} advisor${moaAdvisorCount === 1 ? '' : 's'}`;
    } else {
      headerLabel = 'MoA · synthesizing';
    }
  } else if (hasLsp) {
    headerLabel = `LSP · ${lspCount} diagnostic${lspCount === 1 ? '' : 's'}`;
  } else if (runningCount > 0) {
    headerLabel = `${runningCount} running`;
  } else {
    headerLabel = `${completedCount} completed`;
  }

  return (
    <div className="mt-2 rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/30 transition-colors duration-75"
      >
        {hasMoa ? (
          <Layers className="w-3.5 h-3.5 text-primary/80 shrink-0" />
        ) : hasLsp ? (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
        ) : (
          <Zap className="w-3.5 h-3.5 text-primary/80 shrink-0" />
        )}
        <span className="text-xs text-muted-foreground font-medium tracking-tight">
          {headerLabel}
        </span>
        <div className="flex items-center gap-1 ml-1">
          {runningCount > 0 && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75 motion-reduce:animate-none" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
            </span>
          )}
          {completedCount > 0 && !hasMoa && (
            <span className="text-[10px] text-emerald-500/70 font-mono">
              {completedCount} done
            </span>
          )}
        </div>
        <div className="ml-auto">
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />
          )}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border/30">
          {events.map((event, i) => (
            <ToolEvent key={`${event.tool}-${i}`} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
