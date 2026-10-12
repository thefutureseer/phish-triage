import { useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAnalyzeContent, useGetAnalysisProviders, useHealthCheck, useTriageVoice, getGetAnalysisProvidersQueryKey, getHealthCheckQueryKey, type AnalysisResult, type VoiceTriageResult } from '@workspace/api-client-react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronRight, Clipboard, FileText, Fingerprint, Globe2, LoaderCircle, Mail, MessageSquareText, Mic, RotateCcw, ScanSearch, Shield, ShieldAlert, ShieldCheck, Upload } from 'lucide-react';
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
    '## Current DNS observations (separate from header claims)',
    ...result.dnsAuthObservations.map((observation) => {
      const label = `${observation.mechanism.toUpperCase()}${observation.selector ? ` selector ${observation.selector}` : ''}${observation.lookupName ? ` at ${observation.lookupName}` : ''}`;
      return `- **${label} — ${observation.status} (${observation.targetSource}):** ${observation.detail}${observation.records.length ? ` Records: ${observation.records.join(' | ')}` : ''}`;
    }),
    '- DNS observations show records published at analysis time; they do not verify the message or prove who sent it.',
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

function makeVoiceReport(result: VoiceTriageResult): string {
  const longestBacktickRun = Math.max(
    0,
    ...Array.from(result.transcript.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1));
  return [
    '# Voice / Vishing Incident Ticket',
    '',
    '- **Source:** VOICE / VISHING',
    `- **Analyzed:** ${new Date(result.analyzedAt).toLocaleString()}`,
    `- **Transcription:** ${result.transcriptionMode.replaceAll('_', ' ')}`,
    `- **Risk assessment:** ${result.riskLevel.toUpperCase()} (${result.riskScore}/100)`,
    `- **Summary:** ${result.summary}`,
    '',
    '## Full call transcript',
    `${fence}text`,
    result.transcript,
    fence,
    '',
    '## Vishing indicators',
    ...(result.vishingIndicators.length
      ? result.vishingIndicators.flatMap((indicator) => [
          `### ${indicator.label} (${indicator.category.replaceAll('_', ' ')})`,
          indicator.detail,
          ...(indicator.quotes.length ? indicator.quotes.map((quote) => `- Exact phrase: "${quote}"`) : ['- No exact phrases returned.']),
          '',
        ])
      : ['- No vishing indicators returned.', '']),
    '## Findings',
    ...(result.findings.length ? result.findings.map((finding) => `- ${finding}`) : ['- No findings returned.']),
    '',
    '## Risk factors',
    ...(result.factors.length
      ? result.factors.map((factor) => `- ${factor.triggered ? '[x]' : '[ ]'} **${factor.label}** (${factor.points} points): ${factor.detail}`)
      : ['- No risk factors returned.']),
    '',
    '> Assessment is heuristic and should be reviewed alongside your organization’s incident response procedures. A low score does not guarantee safety.',
  ].join('\n');
}

function isVoiceTriageResult(value: unknown): value is VoiceTriageResult {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<VoiceTriageResult>;
  return item.source === 'voice'
    && typeof item.analyzedAt === 'string'
    && ['provided', 'openai_whisper'].includes(String(item.transcriptionMode))
    && typeof item.transcript === 'string'
    && typeof item.riskScore === 'number' && item.riskScore >= 0 && item.riskScore <= 100
    && ['low', 'moderate', 'high', 'critical'].includes(String(item.riskLevel))
    && typeof item.summary === 'string'
    && Array.isArray(item.vishingIndicators)
    && item.vishingIndicators.every((indicator) => indicator && ['authority_impersonation', 'fear_urgency', 'high_risk_demand'].includes(String(indicator.category))
      && typeof indicator.label === 'string'
      && typeof indicator.detail === 'string' && Array.isArray(indicator.quotes)
      && indicator.quotes.every((quote) => typeof quote === 'string'))
    && Array.isArray(item.factors) && item.factors.every((factor) => factor && typeof factor.id === 'string'
      && typeof factor.label === 'string' && typeof factor.points === 'number'
      && typeof factor.triggered === 'boolean' && typeof factor.detail === 'string')
    && Array.isArray(item.findings) && item.findings.every((finding) => typeof finding === 'string');
}

function RiskScore({ result }: { result: Pick<AnalysisResult | VoiceTriageResult, 'riskLevel' | 'riskScore'> }) {
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

function VoiceResultView({ result, onCopy, copied }: { result: VoiceTriageResult; onCopy: () => void; copied: boolean }) {
  return (
    <div className="fade-in" data-testid="content-voice-analysis-result">
      <div className="result-kicker">Voice triage assessment</div>
      <RiskScore result={result} />
      <p className="summary-copy">{result.summary}</p>
      <div className="provider-callout configured" role="note">
        <Mic size={15} />
        <span>Transcript source: {result.transcriptionMode === 'openai_whisper' ? 'audio transcription' : 'provided transcript'}.</span>
      </div>
      <section className="result-section" aria-labelledby="voice-transcript-title">
        <div className="section-title" id="voice-transcript-title"><span>Call transcript</span><span className="count-pill">{result.transcript.length.toLocaleString()} chars</span></div>
        <pre className="transcript-output" data-testid="text-voice-transcript">{result.transcript || 'No transcript was returned.'}</pre>
      </section>
      <section className="result-section" aria-labelledby="vishing-indicators-title">
        <div className="section-title" id="vishing-indicators-title"><span>Vishing indicators</span><span className="count-pill">{result.vishingIndicators.length}</span></div>
        {result.vishingIndicators.length ? result.vishingIndicators.map((indicator, index) => (
          <article className="indicator-item voice-indicator" key={`${indicator.category}-${index}`} data-testid={`card-vishing-indicator-${index}`}>
            <div className="indicator-top">
              <span className="indicator-kind">{indicator.category.replaceAll('_', ' ')}</span>
              <span className="rep-tag rep-suspicious">{indicator.label}</span>
            </div>
            <p className="indicator-detail">{indicator.detail}</p>
            {indicator.quotes.length > 0 && (
              <ul className="quote-list">{indicator.quotes.map((quote, quoteIndex) => <li key={`${quote}-${quoteIndex}`}><q>{quote}</q></li>)}</ul>
            )}
          </article>
        )) : <p className="indicator-detail">No vishing indicators were returned.</p>}
      </section>
      <section className="result-section" aria-labelledby="voice-findings-title">
        <div className="section-title" id="voice-findings-title"><span>Key findings</span><span className="count-pill">{result.findings.length}</span></div>
        {result.findings.length ? <ul className="findings-list">{result.findings.map((finding, index) => <li key={`${finding}-${index}`}><ChevronRight size={13} />{finding}</li>)}</ul> : <p className="indicator-detail">No findings were returned.</p>}
      </section>
      <section className="result-section" aria-labelledby="voice-factors-title">
        <div className="section-title" id="voice-factors-title"><span>Scoring factors</span><span className="count-pill">{result.factors.filter((factor) => factor.triggered).length} triggered</span></div>
        {result.factors.length ? result.factors.map((factor) => (
          <div className="factor-row" key={factor.id}>
            <span>{factor.triggered ? 'Triggered · ' : ''}{factor.label}<span className="indicator-detail" style={{ display: 'block' }}>{factor.detail}</span></span>
            <span className="factor-points">{factor.triggered ? '+' : ''}{factor.points}</span>
          </div>
        )) : <p className="indicator-detail">No scoring factors were returned.</p>}
      </section>
      <button type="button" className={`report-button ${copied ? 'copied' : ''}`} onClick={onCopy} data-testid="button-copy-report">
        {copied ? <Check size={15} /> : <Clipboard size={15} />}
        {copied ? 'Incident ticket copied' : 'Copy Incident Ticket'}
      </button>
      <div className="result-meta">ANALYZED {new Date(result.analyzedAt).toLocaleString()}</div>
    </div>
  );
}

function AnalysisResultView({ result, onCopy, copied, onOpenReputation }: { result: AnalysisResult; onCopy: () => void; copied: boolean; onOpenReputation: () => void }) {
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
        {!result.reputationConfigured && <button type="button" className="provider-action" onClick={onOpenReputation} data-testid="button-coming-soon-reputation">Coming soon <ArrowRight size={12} /></button>}
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
          <div className="section-title" id="auth-title"><span>Authentication-Results claims</span><span className="count-pill">{authLabel}</span></div>
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

      {result.source === 'email' && (
        <section className="result-section" aria-labelledby="dns-auth-title">
          <div className="section-title" id="dns-auth-title"><span>Current DNS observations</span><span className="count-pill">DNS</span></div>
          <p className="indicator-detail">These are separate checks of records published at analysis time. They do not verify the pasted headers or prove who sent the message.</p>
          <div className="dns-auth-list">
            {result.dnsAuthObservations.map((observation, index) => (
              <article className="dns-auth-item" key={`${observation.mechanism}-${observation.lookupName ?? 'missing'}-${index}`}>
                <div className="dns-auth-top">
                  <strong>{observation.mechanism.toUpperCase()}{observation.selector ? ` · selector ${observation.selector}` : ''}</strong>
                  <span className={`dns-status dns-status-${observation.status.replaceAll('_', '-')}`}>{observation.status.replaceAll('_', ' ')}</span>
                </div>
                <div className="dns-auth-name">{observation.lookupName ?? 'No safe lookup target in headers'}</div>
                <p className="indicator-detail">Target from {observation.targetSource.replaceAll('-', ' ')}. {observation.detail}</p>
                {observation.records.length > 0 && (
                  <ul className="dns-record-list">
                    {observation.records.map((record, recordIndex) => <li key={`${recordIndex}-${record}`}>{record}</li>)}
                  </ul>
                )}
              </article>
            ))}
          </div>
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

function ComingSoonPage() {
  const [location, setLocation] = useLocation();
  const isAudio = location.endsWith('/audio-transcription');
  const featureTitle = isAudio ? 'Audio transcription' : 'External URL reputation';
  const featureCopy = isAudio
    ? 'Transcribing uploaded call recordings needs a speech-to-text provider connection. Until then, paste a transcript to run vishing analysis.'
    : 'Live URL reputation checks need a VirusTotal or Google Safe Browsing connection. SMS and email analysis still works with local heuristic checks.';
  const requirement = isAudio
    ? 'Audio upload requires an enabled transcription API.'
    : 'External lookups require an enabled reputation API.';
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="brand-mark"><Shield size={19} strokeWidth={1.8} /></span>
          <span>Phish Intake <span style={{ color: '#9dd8be' }}>Analyzer</span></span>
        </div>
        <button type="button" className="topbar-action" onClick={() => setLocation('/')}>Back to analyzer</button>
      </header>
      <div className="workbench coming-soon-workbench">
        <section className="panel coming-soon-panel" aria-labelledby="coming-soon-title">
          <div className="coming-soon-icon">{isAudio ? <Mic size={21} /> : <Globe2 size={21} />}</div>
          <div className="eyebrow">INTEGRATION STATUS · NOT CONFIGURED</div>
          <h1 id="coming-soon-title">Coming soon</h1>
          <h2>{featureTitle}</h2>
          <p>{featureCopy}</p>
          <div className="coming-soon-requirement"><AlertTriangle size={15} /><span>{requirement}</span></div>
          <button type="button" className="analyze-button" onClick={() => setLocation('/')}><ArrowLeft size={15} />Return to analyzer</button>
        </section>
      </div>
    </main>
  );
}

function Home() {
  const [, setLocation] = useLocation();
  const [mode, setMode] = useState<'sms' | 'email' | 'voice'>('sms');
  const [content, setContent] = useState('');
  const [voiceInputMode, setVoiceInputMode] = useState<'transcript' | 'audio'>('transcript');
  const [transcript, setTranscript] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [uploadedVoiceResult, setUploadedVoiceResult] = useState<VoiceTriageResult | null>(null);
  const [audioUploadPending, setAudioUploadPending] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fileError, setFileError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const analysis = useAnalyzeContent();
  const voiceAnalysis = useTriageVoice();
  const providerQuery = useGetAnalysisProviders({ query: { queryKey: getGetAnalysisProvidersQueryKey(), staleTime: 60_000, retry: 1 } });
  const healthQuery = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), staleTime: 30_000, retry: 1 } });
  const result = analysis.data;
  const voiceResult = voiceAnalysis.data;
  const report = useMemo(() => mode === 'voice'
    ? (uploadedVoiceResult ?? voiceResult) ? makeVoiceReport((uploadedVoiceResult ?? voiceResult) as VoiceTriageResult) : ''
    : result ? makeReport(result) : '', [mode, result, voiceResult, uploadedVoiceResult]);

  const chooseMode = (next: 'sms' | 'email' | 'voice') => {
    setMode(next);
    setFileError('');
    setCopied(false);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!content.trim() || content.length > 100000 || analysis.isPending) return;
    setCopied(false);
    setFileError('');
    analysis.mutate({ data: { source: mode === 'email' ? 'email' : 'sms', content: content.trim() } });
  };

  const validAudio = (file: File) => {
    setUploadedVoiceResult(null);
    voiceAnalysis.reset();
    const allowedExtension = /\.(mp3|wav|m4a)$/i.test(file.name);
    if (!allowedExtension) {
      setAudioFile(null);
      setFileError('Choose an MP3, WAV, or M4A audio file.');
      return false;
    }
    if (file.size > 24 * 1024 * 1024) {
      setAudioFile(null);
      setFileError('This recording exceeds the 24 MiB upload limit.');
      return false;
    }
    setFileError('');
    setAudioFile(file);
    return true;
  };

  const submitVoice = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (voiceAnalysis.isPending) return;
    setCopied(false);
    setFileError('');
    if (voiceInputMode === 'transcript') {
      if (!transcript.trim() || transcript.length > 100000) return;
      setUploadedVoiceResult(null);
      voiceAnalysis.mutate({ data: { transcript: transcript.trim() } });
      return;
    }
    if (providerQuery.data?.voiceTranscriptionConfigured !== true) {
      setLocation('/coming-soon/audio-transcription');
      return;
    }
    if (!audioFile || !validAudio(audioFile)) return;
    setUploadedVoiceResult(null);
    voiceAnalysis.reset();
    setAudioUploadPending(true);
    try {
      const body = new FormData();
      body.append('audio', audioFile);
      const response = await fetch('/api/triage/voice', { method: 'POST', body, credentials: 'include' });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
          ? payload.error : 'The audio could not be analyzed. Check your connection and try again.';
        throw new Error(message);
      }
      if (!isVoiceTriageResult(payload)) throw new Error('The server returned an unexpected voice triage response.');
      voiceAnalysis.reset();
      // Keep the result in local state because the generated mutation accepts JSON only.
      setUploadedVoiceResult(payload);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'The audio could not be analyzed. Try again.');
    } finally {
      setAudioUploadPending(false);
    }
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
      setMode('email');
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
    setTranscript('');
    setAudioFile(null);
    setUploadedVoiceResult(null);
    setFileError('');
    analysis.reset();
    voiceAnalysis.reset();
    setCopied(false);
    inputRef.current?.focus();
  };

  const insertExample = () => {
    setMode('sms');
    setContent('Your package is on hold due to an unpaid $1.82 customs fee. Confirm your delivery details within 12 hours: https://parcel-update-check.example/track\n\nReply STOP to opt out.');
    setFileError('');
    inputRef.current?.focus();
  };

  const provider = providerQuery.data;
  const serviceStatus = healthQuery.data?.status;
  const charCount = content.length;
  const remaining = 100000 - charCount;
  const shownVoiceResult = mode === 'voice' ? uploadedVoiceResult ?? voiceAnalysis.data : undefined;
  const voicePending = voiceAnalysis.isPending || (mode === 'voice' && voiceInputMode === 'audio' && audioFile !== null && audioUploadPending);

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
          {providerQuery.isLoading
                ? <span>LOOKUP STATUS…</span>
                : provider?.configured
                  ? <span>REPUTATION ENABLED</span>
                  : <button type="button" className="topbar-action topbar-status-action" onClick={() => setLocation('/coming-soon/reputation')}>HEURISTICS ONLY · COMING SOON</button>}
        </div>
      </header>

      <div className="workbench">
        <section className="intro">
          <div className="eyebrow"><span style={{ width: 23, height: 1, background: '#397a68' }} /> INCIDENT INTAKE · ANALYST WORKBENCH</div>
          <h1>Make the message<br className="hidden sm:block" /> tell its story.</h1>
          <p>Inspect suspicious messages and calls for risk signals, authentication clues, and actionable indicators. Turn uncertain evidence into a defensible triage note.</p>
        </section>

        <div className="work-grid">
          <section className="panel intake-panel" aria-labelledby="intake-title">
            <div className="panel-heading">
              <div><h2 id="intake-title">Inspect an intake</h2><p>Choose a channel, then submit the original evidence.</p></div>
              <span className="step-tag">INTAKE 01</span>
            </div>

            <div className="source-switch" role="group" aria-label="Triage channel">
              <button type="button" aria-pressed={mode === 'email'} className={`source-option ${mode === 'email' ? 'active' : ''}`} onClick={() => chooseMode('email')} data-testid="tab-source-email"><Mail size={14} /><span>Email Headers</span></button>
              <button type="button" aria-pressed={mode === 'sms'} className={`source-option ${mode === 'sms' ? 'active' : ''}`} onClick={() => chooseMode('sms')} data-testid="tab-source-sms"><MessageSquareText size={14} /><span>SMS / Smishing</span></button>
              <button type="button" aria-pressed={mode === 'voice'} className={`source-option ${mode === 'voice' ? 'active' : ''}`} onClick={() => chooseMode('voice')} data-testid="tab-source-voice"><Mic size={14} /><span>Voice / Vishing</span></button>
            </div>

            <form onSubmit={mode === 'voice' ? submitVoice : submit}>
              {mode === 'voice' ? (
                <>
                  <div className="voice-intro">
                    <div className="voice-intro-mark"><Mic size={18} /></div>
                    <div><strong>Voice / Vishing Triage</strong><span>Assess pressure tactics and suspicious payment requests in a call.</span></div>
                  </div>
                  <div className="voice-choice" role="group" aria-label="Voice evidence type">
                    <button type="button" aria-pressed={voiceInputMode === 'audio'} className={`voice-choice-button ${voiceInputMode === 'audio' ? 'active' : ''}`} disabled={providerQuery.isLoading} onClick={() => {
                      if (provider?.voiceTranscriptionConfigured !== true) {
                        setLocation('/coming-soon/audio-transcription');
                        return;
                      }
                      setVoiceInputMode('audio');
                      setUploadedVoiceResult(null);
                      voiceAnalysis.reset();
                      setFileError('');
                    }} data-testid="tab-voice-audio"><Upload size={14} />Upload Call Audio{(providerQuery.isError || (provider && !provider.voiceTranscriptionConfigured)) && <span className="choice-soon">Coming soon</span>}</button>
                    <button type="button" aria-pressed={voiceInputMode === 'transcript'} className={`voice-choice-button ${voiceInputMode === 'transcript' ? 'active' : ''}`} onClick={() => { setVoiceInputMode('transcript'); setUploadedVoiceResult(null); voiceAnalysis.reset(); setFileError(''); }} data-testid="tab-voice-transcript"><FileText size={14} />Paste Transcript</button>
                  </div>
                  {voiceInputMode === 'transcript' ? (
                    <>
                      <div className="field-label-row"><label className="field-label" htmlFor="voice-transcript">Call transcript or voicemail</label><span className="field-hint">UP TO 100 KB</span></div>
                      <textarea id="voice-transcript" className="message-area" value={transcript} onChange={(event) => { setTranscript(event.target.value.slice(0, 100000)); setUploadedVoiceResult(null); voiceAnalysis.reset(); }} placeholder="Paste the caller’s words as heard. Include requests, deadlines, and claimed affiliations…" maxLength={100000} aria-describedby="voice-counter" data-testid="input-voice-transcript" />
                      <div className="input-foot" id="voice-counter"><span>{transcript.length.toLocaleString()} characters</span><span>{(100000 - transcript.length).toLocaleString()} remaining</span></div>
                    </>
                  ) : (
                    <>
                      <div className={`audio-dropzone ${isDragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={(event) => { event.preventDefault(); setIsDragging(false); validAudio(event.dataTransfer.files[0]); }} data-testid="dropzone-voice-audio">
                        <input ref={audioRef} type="file" accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) validAudio(file); event.currentTarget.value = ''; }} data-testid="input-voice-audio" />
                        <span className="audio-drop-icon"><Upload size={19} /></span>
                        <strong>{audioFile ? audioFile.name : 'Drop a call recording here'}</strong>
                        <span>{audioFile ? `${(audioFile.size / (1024 * 1024)).toFixed(1)} MiB · ready to analyze` : 'MP3, WAV, or M4A · 24 MiB maximum'}</span>
                        <button type="button" className="quiet-button" onClick={() => audioRef.current?.click()} data-testid="button-select-audio">{audioFile ? 'Choose a different file' : 'Browse files'}</button>
                      </div>
                      {audioFile && <button type="button" className="quiet-button audio-remove" onClick={() => { setAudioFile(null); if (audioRef.current) audioRef.current.value = ''; }} data-testid="button-remove-audio"><RotateCcw size={13} />Remove recording</button>}
                      <p className="audio-privacy">When transcription is configured, audio is sent to the transcription service. Without it, only a clearly labeled sample transcript is returned. Keep sensitive personal data to a minimum.</p>
                    </>
                  )}
                </>
              ) : (
              <div className="field-label-row">
                <label className="field-label" htmlFor="message-content">{mode === 'sms' ? 'Suspicious message' : 'Raw email content'}</label>
                <span className="field-hint">{mode === 'sms' ? 'TEXT BODY' : 'HEADERS + BODY'}</span>
              </div>
              )}
              {mode !== 'voice' && (
              <>
              <textarea
                ref={inputRef}
                id="message-content"
                className="message-area"
                value={content}
                onChange={(event) => setContent(event.target.value.slice(0, 100000))}
                placeholder={mode === 'sms'
                  ? 'Paste the full text, including links and sender details…'
                  : 'Paste the raw email, including From, Received, Authentication-Results, and body…'}
                aria-describedby="input-counter input-note"
                maxLength={100000}
                data-testid="input-message-content"
              />
              <div className="input-foot" id="input-counter"><span>{charCount.toLocaleString()} characters</span><span>{remaining.toLocaleString()} remaining · 100 KB max</span></div>
              <input ref={fileRef} type="file" accept=".eml,message/rfc822,text/plain" hidden onChange={(event) => loadFile(event.target.files?.[0])} data-testid="input-eml-file" />
              <div className="file-actions">
                {mode === 'email' && <button type="button" className="quiet-button" onClick={() => fileRef.current?.click()} data-testid="button-upload-eml"><Upload size={13} />Open .eml file</button>}
                <button type="button" className="quiet-button" onClick={insertExample} data-testid="button-load-example"><FileText size={13} />Load example</button>
                {content && <button type="button" className="quiet-button" onClick={clearInput} data-testid="button-clear-input"><RotateCcw size={13} />Clear</button>}
              </div>
              </>
              )}

              {fileError && <div className="error-box" role="alert" data-testid="status-file-error">{fileError}</div>}
              {mode !== 'voice' && analysis.isError && (
                <div className="error-box" role="alert" data-testid="status-analysis-error">
                  <strong>Analysis could not be completed.</strong>{' '}
                  {analysis.error instanceof Error ? analysis.error.message : 'Check your connection and try again.'}
                  <button type="button" onClick={() => analysis.mutate({ data: { source: mode === 'email' ? 'email' : 'sms', content: content.trim() } })} style={{ display: 'inline-flex', marginLeft: 7, border: 0, background: 'transparent', color: 'inherit', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }} data-testid="button-retry-analysis">Retry</button>
                </div>
              )}
              {mode === 'voice' && voiceAnalysis.isError && <div className="error-box" role="alert" data-testid="status-voice-analysis-error"><strong>Voice triage could not be completed.</strong>{' '}{voiceAnalysis.error instanceof Error ? voiceAnalysis.error.message : 'Check your connection and try again.'}<button type="button" onClick={() => voiceInputMode === 'transcript' && transcript.trim() ? voiceAnalysis.mutate({ data: { transcript: transcript.trim() } }) : submitVoice()} className="retry-inline" data-testid="button-retry-voice">Retry</button></div>}

              <button type="submit" className="analyze-button" disabled={mode === 'voice' ? voicePending || (voiceInputMode === 'transcript' ? !transcript.trim() || transcript.length > 100000 : !audioFile) : !content.trim() || analysis.isPending || charCount > 100000} data-testid="button-analyze">
                {(mode === 'voice' ? voicePending : analysis.isPending) ? <><LoaderCircle size={16} className="spin" />{mode === 'voice' ? 'Analyzing call…' : 'Reading signals…'}</> : <><ScanSearch size={16} />{mode === 'voice' ? 'Analyze voice evidence' : 'Analyze message'}<ArrowRight size={15} /></>}
              </button>
            </form>
            <p className="safety-note" id={mode === 'voice' ? undefined : 'input-note'}><ShieldCheck size={14} />Analysis is heuristic, not a verdict. Treat scores as one input to human review. Avoid submitting sensitive personal data.</p>
          </section>

          <section className="panel result-panel" aria-labelledby="result-panel-title">
            <div className="panel-heading">
              <div><h2 id="result-panel-title">Triage report</h2><p>Evidence first. Conclusions with context.</p></div>
              <span className="step-tag">ASSESS 02</span>
            </div>
            {(mode === 'voice' ? voicePending : analysis.isPending) ? (
              <div aria-label="Analyzing message" aria-live="polite" data-testid="status-analysis-loading">
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '20px 0' }}>
                  <div className="skeleton" style={{ width: 74, height: 74, borderRadius: '50%' }} />
                  <div style={{ flex: 1 }}><div className="skeleton" style={{ height: 11, width: '35%', marginBottom: 11 }} /><div className="skeleton" style={{ height: 8, width: '60%' }} /></div>
                </div>
                <div className="skeleton" style={{ height: 10, width: '95%', marginBottom: 9 }} /><div className="skeleton" style={{ height: 10, width: '78%', marginBottom: 24 }} />
                <div className="result-section"><div className="skeleton" style={{ height: 10, width: 125, marginBottom: 14 }} /><div className="skeleton" style={{ height: 44, marginBottom: 8 }} /><div className="skeleton" style={{ height: 44 }} /></div>
                <p className="result-meta">{mode === 'voice' ? 'TRANSCRIBING AND CHECKING CALL SIGNALS' : 'CHECKING MESSAGE SIGNALS'}</p>
              </div>
            ) : mode === 'voice' && shownVoiceResult ? (
              <VoiceResultView result={shownVoiceResult} onCopy={copyReport} copied={copied} />
            ) : mode !== 'voice' && result ? (
              <AnalysisResultView result={result} onCopy={copyReport} copied={copied} onOpenReputation={() => setLocation('/coming-soon/reputation')} />
            ) : (
              <div className="empty-result" data-testid="content-empty-result">
                <div className="empty-graphic"><Fingerprint size={34} strokeWidth={1.4} /></div>
                <h3>{mode === 'voice' ? 'Listen for pressure.' : 'Evidence goes here.'}</h3>
                <p>{mode === 'voice' ? 'Submit a call recording or transcript to surface authority claims, urgency, and high-risk demands.' : 'Submit a suspicious message to see its risk signals, extracted indicators, and analyst-ready report.'}</p>
                {providerQuery.isLoading
                  ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 21, color: '#84908a', font: '10px var(--app-font-mono)' }}><Globe2 size={13} />Checking reputation provider…</div>
                  : provider?.configured
                    ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 21, color: '#84908a', font: '10px var(--app-font-mono)' }}><Globe2 size={13} />{`LOOKUPS · ${(provider.provider ?? '').replaceAll('_', ' ').toUpperCase()}`}</div>
                    : <button type="button" className="empty-provider-action" onClick={() => setLocation('/coming-soon/reputation')}><Globe2 size={13} />NO EXTERNAL REPUTATION LOOKUPS · COMING SOON</button>}
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
  return <RoutedErrorBoundary><Switch><Route path="/" component={Home} /><Route path="/coming-soon/:feature" component={ComingSoonPage} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
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
