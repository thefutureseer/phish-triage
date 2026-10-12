import { useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAnalyzeContent, useGetAnalysisProviders, useHealthCheck, getGetAnalysisProvidersQueryKey, getHealthCheckQueryKey, type AnalysisResult } from '@workspace/api-client-react';
import { AlertTriangle, ArrowRight, Check, ChevronRight, Clipboard, FileText, Fingerprint, Globe2, LoaderCircle, Mail, MessageSquareText, RotateCcw, ScanSearch, Shield, ShieldAlert, ShieldCheck, Upload } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

function makeReport(result: AnalysisResult): string {
  const date = new Date(result.analyzedAt).toLocaleString();
  const provider = result.reputationConfigured
    ? (result.reputationProvider ?? 'configured provider').replaceAll('_', ' ')
    : 'Not configured — local heuristic analysis only';
  const lines = [
    '# Phishing Intake Triage Report',
    '',
    `- **Source:** ${result.source.toUpperCase()}`,
    `- **Analyzed:** ${date}`,
    `- **Risk assessment:** ${result.riskLevel.toUpperCase()} (${result.riskScore}/100)`,
    `- **Summary:** ${result.summary}`,
    `- **Reputation lookup:** ${provider}`,
    '',
    '## Findings',
    ...(result.findings.length ? result.findings.map((item) => `- ${item}`) : ['- No findings returned.']),
    '',
    '## Indicators',
    ...(result.indicators.length
      ? result.indicators.map((item) => {
          const extra = [
            item.shortener ? 'shortener detected' : '',
            item.anchorMismatch ? 'display text differs from destination' : '',
            item.redirectChain.length ? `redirect chain: ${item.redirectChain.join(' → ')}` : '',
          ].filter(Boolean);
          return `- **${item.kind} — ${item.reputation}:** \`${item.value}\` — ${item.reputationDetail}${extra.length ? `; ${extra.join('; ')}` : ''}`;
        })
      : ['- No indicators returned.']),
    '',
    '## Email authentication',
    `- **Overall:** ${result.authOverall.replaceAll('_', ' ')}`,
    ...(result.authChecks.length
      ? result.authChecks.map((check) => `- **${check.mechanism.toUpperCase()} — ${check.status}${check.aligned === null ? '' : check.aligned ? ', aligned' : ', not aligned'}${check.domain ? ` (${check.domain})` : ''}:** ${check.detail}`)
      : ['- Not applicable or no authentication checks returned.']),
    '',
    '## Urgency signals',
    ...(result.urgencyFlags.length ? result.urgencyFlags.map((flag) => `- ${flag}`) : ['- None returned.']),
    '',
    '## Risk factors',
    ...(result.factors.length
      ? result.factors.map((factor) => `- ${factor.triggered ? '[x]' : '[ ]'} **${factor.label}** (${factor.points} points): ${factor.detail}`)
      : ['- No risk factors returned.']),
    '',
    '> Assessment is heuristic and should be reviewed alongside your organization’s incident response procedures. A low score does not guarantee safety.',
  ];
  return lines.join('\n');
}

function RiskScore({ result }: { result: AnalysisResult }) {
  const level = result.riskLevel;
  return (
    <div className="score-row" data-testid="status-risk-score">
      <div
        className="score-ring"
        style={{ '--score-angle': `${Math.max(0, Math.min(100, result.riskScore)) * 3.6}deg`, '--score-color': level === 'low' ? '#47836b' : level === 'moderate' ? '#b18135' : level === 'critical' ? '#8f302d' : '#bc634e' } as CSSProperties}
        aria-label={`Risk score ${result.riskScore} out of 100`}
      >
        <span className="score-number">{result.riskScore}</span>
      </div>
      <div>
        <div className={`risk-label risk-${level}`}>{level} risk</div>
        <div className="score-caption">Heuristic score · out of 100</div>
      </div>
    </div>
  );
}

function AnalysisResultView({ result, onCopy, copied }: { result: AnalysisResult; onCopy: () => void; copied: boolean }) {
  const authLabel = result.authOverall.replaceAll('_', ' ');
  return (
    <div className="fade-in" data-testid="content-analysis-result">
      <div className="result-kicker">Triage assessment</div>
      <RiskScore result={result} />
      <p className="summary-copy">{result.summary}</p>

      <div className={`provider-callout ${result.reputationConfigured ? 'configured' : ''}`} role="note" data-testid="status-reputation-provider">
        {result.reputationConfigured ? <ShieldCheck size={15} /> : <AlertTriangle size={15} />}
        <span>
          {result.reputationConfigured
            ? `Reputation lookup enabled via ${(result.reputationProvider ?? 'configured provider').replaceAll('_', ' ')}. Heuristic analysis is not a guarantee.`
            : 'External reputation lookups are not configured. This result uses local heuristic analysis only; no reputation verdicts were checked.'}
        </span>
      </div>

      {result.urgencyFlags.length > 0 && (
        <section className="result-section" aria-labelledby="urgency-title">
          <div className="section-title" id="urgency-title"><span>Urgency signals</span><span className="count-pill">{result.urgencyFlags.length}</span></div>
          <div className="urgency-wrap">{result.urgencyFlags.map((flag, index) => <span className="urgency-pill" key={`${flag}-${index}`}>{flag}</span>)}</div>
        </section>
      )}

      <section className="result-section" aria-labelledby="findings-title">
        <div className="section-title" id="findings-title"><span>Key findings</span><span className="count-pill">{result.findings.length}</span></div>
        {result.findings.length ? (
          <ul className="findings-list">{result.findings.map((finding, index) => <li key={`${finding}-${index}`} data-testid={`text-finding-${index}`}><ChevronRight size={13} />{finding}</li>)}</ul>
        ) : <p className="indicator-detail">No findings were returned for this submission.</p>}
      </section>

      <section className="result-section" aria-labelledby="indicators-title">
        <div className="section-title" id="indicators-title"><span>Extracted indicators</span><span className="count-pill">{result.indicators.length}</span></div>
        {result.indicators.length ? result.indicators.map((indicator, index) => (
          <article className="indicator-item" key={`${indicator.value}-${index}`} data-testid={`card-indicator-${index}`}>
            <div className="indicator-top">
              <span className="indicator-kind">{indicator.kind}</span>
              <span className={`rep-tag rep-${indicator.reputation}`}>{indicator.reputation}</span>
            </div>
            <div className="indicator-value">{indicator.value}</div>
            <p className="indicator-detail">{indicator.reputationDetail}</p>
            {(indicator.shortener || indicator.anchorMismatch || indicator.redirectChain.length > 0) && (
              <p className="indicator-detail">
                {[
                  indicator.shortener ? 'URL shortener' : '',
                  indicator.anchorMismatch ? 'Link text does not match destination' : '',
                  indicator.redirectChain.length ? `Redirects: ${indicator.redirectChain.join(' → ')}` : '',
                ].filter(Boolean).join(' · ')}
              </p>
            )}
          </article>
        )) : <p className="indicator-detail">No indicators were extracted.</p>}
      </section>

      {result.source === 'email' && (
        <section className="result-section" aria-labelledby="auth-title">
          <div className="section-title" id="auth-title"><span>Sender authentication</span><span className="count-pill">{authLabel}</span></div>
          {result.authChecks.length ? (
            <div className="auth-grid">
              {result.authChecks.map((check) => (
                <div className="auth-chip" key={check.mechanism}>
                  <strong>{check.mechanism}</strong>
                  <span className={check.status === 'pass' ? 'risk-low' : check.status === 'fail' ? 'risk-high' : 'risk-moderate'}>{check.status}{check.aligned !== null ? ` · ${check.aligned ? 'aligned' : 'not aligned'}` : ''}</span>
                  {check.domain && <span className="auth-detail">{check.domain}</span>}
                  <span className="auth-detail">{check.detail}</span>
                </div>
              ))}
            </div>
          ) : <p className="indicator-detail">No authentication checks were returned.</p>}
        </section>
      )}

      <section className="result-section" aria-labelledby="factors-title">
        <div className="section-title" id="factors-title"><span>Scoring factors</span><span className="count-pill">{result.factors.filter((factor) => factor.triggered).length} triggered</span></div>
        {result.factors.length ? result.factors.map((factor) => (
          <div className="factor-row" key={factor.id} data-testid={`row-factor-${factor.id}`}>
            <span>{factor.triggered ? 'Triggered · ' : ''}{factor.label}<span className="indicator-detail" style={{ display: 'block' }}>{factor.detail}</span></span>
            <span className="factor-points">{factor.triggered ? '+' : ''}{factor.points}</span>
          </div>
        )) : <p className="indicator-detail">No scoring factors were returned.</p>}
      </section>

      <button type="button" className={`report-button ${copied ? 'copied' : ''}`} onClick={onCopy} data-testid="button-copy-report">
        {copied ? <Check size={15} /> : <Clipboard size={15} />}
        {copied ? 'Report copied to clipboard' : 'Copy analyst report'}
      </button>
      <div className="result-meta">ANALYZED {new Date(result.analyzedAt).toLocaleString()}</div>
    </div>
  );
}

function Home() {
  const [source, setSource] = useState<'sms' | 'email'>('sms');
  const [content, setContent] = useState('');
  const [copied, setCopied] = useState(false);
  const [fileError, setFileError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const analysis = useAnalyzeContent();
  const providerQuery = useGetAnalysisProviders({ query: { queryKey: getGetAnalysisProvidersQueryKey(), staleTime: 60_000, retry: 1 } });
  const healthQuery = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), staleTime: 30_000, retry: 1 } });
  const result = analysis.data;
  const report = useMemo(() => result ? makeReport(result) : '', [result]);

  const chooseSource = (next: 'sms' | 'email') => {
    setSource(next);
    setFileError('');
    if (next === 'sms') setContent((current) => current.length > 100000 ? current.slice(0, 100000) : current);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!content.trim() || content.length > 100000 || analysis.isPending) return;
    setCopied(false);
    setFileError('');
    analysis.mutate({ data: { source, content: content.trim() } });
  };

  const loadFile = (file?: File) => {
    if (!file) return;
    if (file.size > 100000) {
      setFileError('This file is larger than the 100 KB analysis limit. Paste a smaller excerpt instead.');
      return;
    }
    setFileError('');
    const reader = new FileReader();
    reader.onload = () => {
      setContent(String(reader.result ?? '').slice(0, 100000));
      setSource('email');
      if (String(reader.result ?? '').length > 100000) setFileError('Only the first 100 KB was loaded. Review the excerpt before analyzing.');
    };
    reader.onerror = () => setFileError('The file could not be read. Try pasting the message content instead.');
    reader.readAsText(file);
  };

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = report;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      const ok = document.execCommand('copy');
      textArea.remove();
      setCopied(ok);
      window.setTimeout(() => setCopied(false), 2400);
    }
  };

  const clearInput = () => {
    setContent('');
    setFileError('');
    analysis.reset();
    setCopied(false);
    inputRef.current?.focus();
  };

  const insertExample = () => {
    setSource('sms');
    setContent('Your package is on hold due to an unpaid $1.82 customs fee. Confirm your delivery details within 12 hours: https://parcel-update-check.example/track\n\nReply STOP to opt out.');
    setFileError('');
    inputRef.current?.focus();
  };

  const provider = providerQuery.data;
  const serviceStatus = healthQuery.data?.status;
  const charCount = content.length;
  const remaining = 100000 - charCount;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="brand-mark"><Shield size={19} strokeWidth={1.8} /></span>
          <span>Phish Intake <span style={{ color: '#9dd8be' }}>Analyzer</span></span>
        </div>
        <div className="topbar-meta" aria-label="Service status">
          <span className="meta-label"><span className="live-dot" />{healthQuery.isLoading ? 'CHECKING' : healthQuery.isError ? 'STATUS UNKNOWN' : serviceStatus?.toUpperCase() ?? 'ONLINE'}</span>
          <span style={{ opacity: .5 }}>/</span>
          <span>{providerQuery.isLoading ? 'LOOKUP STATUS…' : provider?.configured ? 'REPUTATION ENABLED' : 'HEURISTICS ONLY'}</span>
        </div>
      </header>

      <div className="workbench">
        <section className="intro">
          <div className="eyebrow"><span style={{ width: 23, height: 1, background: '#397a68' }} /> INCIDENT INTAKE · ANALYST WORKBENCH</div>
          <h1>Make the message<br className="hidden sm:block" /> tell its story.</h1>
          <p>Inspect suspicious SMS and email for risk signals, authentication clues, and actionable indicators. Turn an uncertain message into a defensible triage note.</p>
        </section>

        <div className="work-grid">
          <section className="panel intake-panel" aria-labelledby="intake-title">
            <div className="panel-heading">
              <div><h2 id="intake-title">Inspect a message</h2><p>Paste the original content. Headers help with email analysis.</p></div>
              <span className="step-tag">INTAKE 01</span>
            </div>

            <div className="source-switch" role="tablist" aria-label="Message source">
              <button type="button" role="tab" aria-selected={source === 'sms'} className={`source-option ${source === 'sms' ? 'active' : ''}`} onClick={() => chooseSource('sms')} data-testid="tab-source-sms"><MessageSquareText size={14} />SMS / text</button>
              <button type="button" role="tab" aria-selected={source === 'email'} className={`source-option ${source === 'email' ? 'active' : ''}`} onClick={() => chooseSource('email')} data-testid="tab-source-email"><Mail size={14} />Email / .eml</button>
            </div>

            <form onSubmit={submit}>
              <div className="field-label-row">
                <label className="field-label" htmlFor="message-content">{source === 'sms' ? 'Suspicious message' : 'Raw email content'}</label>
                <span className="field-hint">{source === 'sms' ? 'TEXT BODY' : 'HEADERS + BODY'}</span>
              </div>
              <textarea
                ref={inputRef}
                id="message-content"
                className="message-area"
                value={content}
                onChange={(event) => setContent(event.target.value.slice(0, 100000))}
                placeholder={source === 'sms'
                  ? 'Paste the full text, including links and sender details…'
                  : 'Paste the raw email, including From, Received, Authentication-Results, and body…'}
                aria-describedby="input-counter input-note"
                maxLength={100000}
                data-testid="input-message-content"
              />
              <div className="input-foot" id="input-counter"><span>{charCount.toLocaleString()} characters</span><span>{remaining.toLocaleString()} remaining · 100 KB max</span></div>
              <input ref={fileRef} type="file" accept=".eml,message/rfc822,text/plain" hidden onChange={(event) => loadFile(event.target.files?.[0])} data-testid="input-eml-file" />
              <div className="file-actions">
                {source === 'email' && <button type="button" className="quiet-button" onClick={() => fileRef.current?.click()} data-testid="button-upload-eml"><Upload size={13} />Open .eml file</button>}
                <button type="button" className="quiet-button" onClick={insertExample} data-testid="button-load-example"><FileText size={13} />Load example</button>
                {content && <button type="button" className="quiet-button" onClick={clearInput} data-testid="button-clear-input"><RotateCcw size={13} />Clear</button>}
              </div>

              {fileError && <div className="error-box" role="alert" data-testid="status-file-error">{fileError}</div>}
              {analysis.isError && (
                <div className="error-box" role="alert" data-testid="status-analysis-error">
                  <strong>Analysis could not be completed.</strong>{' '}
                  {analysis.error instanceof Error ? analysis.error.message : 'Check your connection and try again.'}
                  <button type="button" onClick={() => analysis.mutate({ data: { source, content: content.trim() } })} style={{ display: 'inline-flex', marginLeft: 7, border: 0, background: 'transparent', color: 'inherit', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }} data-testid="button-retry-analysis">Retry</button>
                </div>
              )}

              <button type="submit" className="analyze-button" disabled={!content.trim() || analysis.isPending || charCount > 100000} data-testid="button-analyze">
                {analysis.isPending ? <><LoaderCircle size={16} className="spin" />Reading signals…</> : <><ScanSearch size={16} />Analyze message<ArrowRight size={15} /></>}
              </button>
            </form>
            <p className="safety-note" id="input-note"><ShieldCheck size={14} />Analysis is heuristic, not a verdict. Treat scores as one input to human review. Avoid submitting sensitive personal data.</p>
          </section>

          <section className="panel result-panel" aria-labelledby="result-panel-title">
            <div className="panel-heading">
              <div><h2 id="result-panel-title">Triage report</h2><p>Evidence first. Conclusions with context.</p></div>
              <span className="step-tag">ASSESS 02</span>
            </div>
            {analysis.isPending ? (
              <div aria-label="Analyzing message" aria-live="polite" data-testid="status-analysis-loading">
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '20px 0' }}>
                  <div className="skeleton" style={{ width: 74, height: 74, borderRadius: '50%' }} />
                  <div style={{ flex: 1 }}><div className="skeleton" style={{ height: 11, width: '35%', marginBottom: 11 }} /><div className="skeleton" style={{ height: 8, width: '60%' }} /></div>
                </div>
                <div className="skeleton" style={{ height: 10, width: '95%', marginBottom: 9 }} /><div className="skeleton" style={{ height: 10, width: '78%', marginBottom: 24 }} />
                <div className="result-section"><div className="skeleton" style={{ height: 10, width: 125, marginBottom: 14 }} /><div className="skeleton" style={{ height: 44, marginBottom: 8 }} /><div className="skeleton" style={{ height: 44 }} /></div>
                <p className="result-meta">CHECKING MESSAGE SIGNALS</p>
              </div>
            ) : result ? (
              <AnalysisResultView result={result} onCopy={copyReport} copied={copied} />
            ) : (
              <div className="empty-result" data-testid="content-empty-result">
                <div className="empty-graphic"><Fingerprint size={34} strokeWidth={1.4} /></div>
                <h3>Evidence goes here.</h3>
                <p>Submit a suspicious message to see its risk signals, extracted indicators, and analyst-ready report.</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 21, color: '#84908a', font: '10px var(--app-font-mono)' }}><Globe2 size={13} />{providerQuery.isLoading ? 'Checking reputation provider…' : provider?.configured ? `LOOKUPS · ${(provider.provider ?? '').replaceAll('_', ' ').toUpperCase()}` : 'NO EXTERNAL REPUTATION LOOKUPS'}</div>
              </div>
            )}
          </section>
        </div>
        <div className="footer-note"><span><ShieldAlert size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />Use findings as supporting evidence, not a standalone verdict.</span><span>CONTENT IS ANALYZED ON SUBMISSION · NO HISTORY STORED HERE</span></div>
      </div>
    </main>
  );
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={Home} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
