import { useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAnalyzeContent, useGetAnalysisProviders, useHealthCheck, useTriagePhoneNumber, useTriageVoice, getGetAnalysisProvidersQueryKey, getHealthCheckQueryKey, type AnalysisResult, type PhoneTriageResult, type VoiceTriageResult } from '@workspace/api-client-react';
import { AsYouType, getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronRight, Clipboard, FileText, Fingerprint, Globe2, LoaderCircle, Mail, MapPin, MessageSquareText, Mic, Phone, Radio, RotateCcw, ScanSearch, Shield, ShieldAlert, ShieldCheck, Upload } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const phoneRegionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const phoneRegions = getCountries()
  .map((code) => ({ code, name: phoneRegionNames.of(code) ?? code }))
  .sort((left, right) => left.name.localeCompare(right.name));

function formatPhoneAsYouType(value: string, region: CountryCode): string {
  const formatter = value.trimStart().startsWith('+') ? new AsYouType() : new AsYouType(region);
  return formatter.input(value);
}

function parsePhonePreview(value: string, region: CountryCode) {
  return parsePhoneNumberFromString(value, value.trimStart().startsWith('+') ? undefined : region);
}

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

function makePhoneReport(result: PhoneTriageResult): string {
  const externalStatus = result.externalLookupStatus.replaceAll('_', ' ');
  return [
    '# Phone Number OSINT Incident Ticket',
    '',
    '- **Source:** PHONE LOOKUP',
    `- **Analyzed:** ${new Date(result.analyzedAt).toLocaleString()}`,
    `- **Risk assessment:** ${result.riskLevel.toUpperCase()} (${result.riskScore}/100)`,
    `- **E.164:** ${result.e164}`,
    `- **Number validity:** ${result.isValid ? 'valid' : 'not confirmed'} (${result.isPossible ? 'possible length' : 'impossible length'})`,
    `- **Line type:** ${result.lineType.replaceAll('_', ' ')} (${result.lineTypeSource.replaceAll('_', ' ')})`,
    `- **Original carrier:** ${result.carrier ?? 'Not available'}`,
    `- **Carrier source:** ${result.carrierSource.replaceAll('_', ' ')}`,
    `- **Number region:** ${[result.locationCity, result.locationRegion, result.locationCountry].filter(Boolean).join(', ') || 'Not available'}`,
    `- **Claimed caller location:** ${result.claimedLocation ?? 'Not provided'}`,
    `- **Location mismatch:** ${result.locationMismatch ? 'Flagged' : 'Not detected'}`,
    `- **Live lookup:** ${result.externalLookupProvider ?? 'none'} — ${externalStatus}`,
    `- **Summary:** ${result.summary}`,
    '',
    '## Safety recommendation',
    result.safetyRecommendation,
    '',
    '## Findings',
    ...result.findings.map((finding) => `- ${finding}`),
    '',
    '## Risk factors',
    ...result.factors.map((factor) => `- ${factor.triggered ? '[x]' : '[ ]'} **${factor.label}** (${factor.points} points): ${factor.detail}`),
    '',
    '> Phone-number metadata does not verify caller identity or prove fraud. Numbers can be ported, reassigned, or spoofed; confirm claims through an independent trusted channel.',
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

function RiskScore({ result }: { result: Pick<AnalysisResult | VoiceTriageResult | PhoneTriageResult, 'riskLevel' | 'riskScore'> }) {
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

function PhoneResultView({ result, onCopy, copied, onOpenLookup }: { result: PhoneTriageResult; onCopy: () => void; copied: boolean; onOpenLookup: () => void }) {
  const lineTypeLabel = {
    wireless: 'Wireless',
    landline: 'Landline',
    voip_virtual: 'VoIP / Virtual Number',
    other: 'Special-purpose',
    unknown: 'Unknown line type',
  }[result.lineType];
  const lookupText = result.externalLookupStatus === 'success'
    ? 'Live carrier lookup completed. Number-region data is not proof of the caller’s current location.'
    : result.externalLookupStatus === 'not_configured'
      ? 'Live carrier intelligence is not configured. Local number parsing and risk checks still work.'
      : result.externalLookupStatus === 'skipped_invalid'
        ? 'Live lookup was skipped because local validation did not confirm this number.'
        : 'Live carrier lookup is temporarily unavailable. Local number parsing and risk checks are shown.';

  return (
    <div className="fade-in" data-testid="content-phone-analysis-result">
      <div className="result-kicker">Phone number assessment</div>
      <RiskScore result={result} />
      <p className="summary-copy">{result.summary}</p>
      <div className={`provider-callout ${result.externalLookupStatus === 'success' ? 'configured' : ''}`} role="note" data-testid="status-phone-provider">
        {result.externalLookupStatus === 'success' ? <ShieldCheck size={15} /> : <AlertTriangle size={15} />}
        <span>{lookupText}</span>
        {result.externalLookupStatus === 'not_configured' && <button type="button" className="provider-action" onClick={onOpenLookup} data-testid="button-coming-soon-phone">Coming soon <ArrowRight size={12} /></button>}
      </div>

      <section className="result-section" aria-labelledby="phone-overview-title">
        <div className="section-title" id="phone-overview-title"><span>Number profile</span><span className="count-pill">{result.e164}</span></div>
        <div className="phone-metadata-grid">
          <article className="phone-metadata-card">
            <div className="phone-metadata-label"><Phone size={13} />LINE TYPE</div>
            <span className={`phone-type-badge phone-type-${result.lineType}`}>{lineTypeLabel}</span>
            <p className="indicator-detail">Source: {result.lineTypeSource.replaceAll('_', ' ')}</p>
          </article>
          <article className="phone-metadata-card">
            <div className="phone-metadata-label"><Radio size={13} />ORIGINAL CARRIER</div>
            <strong>{result.carrier ?? 'Not available'}</strong>
            <p className="indicator-detail">{result.carrierSource === 'abstract_phone' ? 'Provider-reported carrier' : 'Live lookup required for carrier data'}</p>
          </article>
          <article className="phone-metadata-card">
            <div className="phone-metadata-label"><MapPin size={13} />NUMBER REGION</div>
            <strong>{[result.locationCity, result.locationRegion, result.locationCountry].filter(Boolean).join(', ') || 'Not available'}</strong>
            <p className="indicator-detail">{result.externalLookupStatus === 'success' ? 'Associated with this number, not a live caller location' : `Numbering region · ${result.countryCallingCode}`}</p>
          </article>
          <article className="phone-metadata-card">
            <div className="phone-metadata-label"><ShieldCheck size={13} />VALIDITY</div>
            <strong className={result.isValid ? 'risk-low' : 'risk-high'}>{result.isValid ? 'Valid number range' : 'Not confirmed'}</strong>
            <p className="indicator-detail">{result.isPossible ? 'Possible number length' : 'Number length is not possible for this region'}</p>
          </article>
        </div>
      </section>

      {result.claimedLocation && (
        <div className={`phone-location-check ${result.locationMismatch ? 'mismatch' : ''}`} role="status" data-testid="status-phone-location">
          <MapPin size={14} />
          <span>{result.locationMismatch ? 'Location mismatch flagged' : 'No clear location mismatch detected'}: caller claimed <strong>{result.claimedLocation}</strong>.</span>
        </div>
      )}

      <section className="result-section" aria-labelledby="phone-recommendation-title">
        <div className="section-title" id="phone-recommendation-title"><span>Safety recommendation</span></div>
        <p className="phone-recommendation">{result.safetyRecommendation}</p>
      </section>

      <section className="result-section" aria-labelledby="phone-findings-title">
        <div className="section-title" id="phone-findings-title"><span>Key findings</span><span className="count-pill">{result.findings.length}</span></div>
        <ul className="findings-list">{result.findings.map((finding, index) => <li key={`${finding}-${index}`}><ChevronRight size={13} />{finding}</li>)}</ul>
      </section>

      <section className="result-section" aria-labelledby="phone-factors-title">
        <div className="section-title" id="phone-factors-title"><span>Scoring factors</span><span className="count-pill">{result.factors.filter((factor) => factor.triggered).length} triggered</span></div>
        {result.factors.map((factor) => (
          <div className="factor-row" key={factor.id}>
            <span>{factor.triggered ? 'Triggered · ' : ''}{factor.label}<span className="indicator-detail" style={{ display: 'block' }}>{factor.detail}</span></span>
            <span className="factor-points">{factor.triggered ? '+' : ''}{factor.points}</span>
          </div>
        ))}
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
  const isPhone = location.endsWith('/phone-lookup');
  const featureTitle = isAudio ? 'Audio transcription' : isPhone ? 'Live phone intelligence' : 'External URL reputation';
  const featureCopy = isAudio
    ? 'Transcribing uploaded call recordings needs a speech-to-text provider connection. Until then, paste a transcript to run vishing analysis.'
    : isPhone
      ? 'Live carrier and location lookups need an Abstract Phone Validation API connection. Local number parsing and heuristic scoring still work.'
      : 'Live URL reputation checks need a VirusTotal or Google Safe Browsing connection. SMS and email analysis still works with local heuristic checks.';
  const requirement = isAudio
    ? 'Audio upload requires an enabled transcription API.'
    : isPhone
      ? 'Live phone intelligence requires the ABSTRACT_PHONE_KEY secret.'
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
          <div className="coming-soon-icon">{isAudio ? <Mic size={21} /> : isPhone ? <Phone size={21} /> : <Globe2 size={21} />}</div>
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
  const [mode, setMode] = useState<'sms' | 'email' | 'voice' | 'phone'>('sms');
  const [content, setContent] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneRegion, setPhoneRegion] = useState<CountryCode>('US');
  const [claimedLocation, setClaimedLocation] = useState('');
  const [voiceInputMode, setVoiceInputMode] = useState<'transcript' | 'audio'>('transcript');
  const [transcript, setTranscript] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [uploadedVoiceResult, setUploadedVoiceResult] = useState<VoiceTriageResult | null>(null);
  const [audioUploadPending, setAudioUploadPending] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fileError, setFileError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const analysis = useAnalyzeContent();
  const phoneAnalysis = useTriagePhoneNumber();
  const voiceAnalysis = useTriageVoice();
  const providerQuery = useGetAnalysisProviders({ query: { queryKey: getGetAnalysisProvidersQueryKey(), staleTime: 60_000, retry: 1 } });
  const healthQuery = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), staleTime: 30_000, retry: 1 } });
  const result = analysis.data;
  const phoneResult = phoneAnalysis.data;
  const voiceResult = voiceAnalysis.data;
  const report = useMemo(() => mode === 'phone'
    ? phoneResult ? makePhoneReport(phoneResult) : ''
    : mode === 'voice'
      ? (uploadedVoiceResult ?? voiceResult) ? makeVoiceReport((uploadedVoiceResult ?? voiceResult) as VoiceTriageResult) : ''
      : result ? makeReport(result) : '', [mode, result, phoneResult, voiceResult, uploadedVoiceResult]);

  const chooseMode = (next: 'sms' | 'email' | 'voice' | 'phone') => {
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

  const submitPhone = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!phoneNumber.trim() || phoneAnalysis.isPending) return;
    setCopied(false);
    setFileError('');
    const parsedPhone = parsePhonePreview(phoneNumber, phoneRegion);
    phoneAnalysis.mutate({
      data: {
        phoneNumber: parsedPhone?.isPossible() ? parsedPhone.number : phoneNumber.trim(),
        defaultRegion: phoneRegion,
        ...(claimedLocation.trim() ? { claimedLocation: claimedLocation.trim() } : {}),
      },
    });
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
    setPhoneNumber('');
    setClaimedLocation('');
    setTranscript('');
    setAudioFile(null);
    setUploadedVoiceResult(null);
    setFileError('');
    analysis.reset();
    phoneAnalysis.reset();
    voiceAnalysis.reset();
    setCopied(false);
    if (mode === 'phone') phoneInputRef.current?.focus();
    else inputRef.current?.focus();
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
  const parsedPhonePreview = phoneNumber ? parsePhonePreview(phoneNumber, phoneRegion) : undefined;
  const phoneE164Preview = parsedPhonePreview?.isPossible() ? parsedPhonePreview.number : '';
  const shownVoiceResult = mode === 'voice' ? uploadedVoiceResult ?? voiceAnalysis.data : undefined;
  const voicePending = voiceAnalysis.isPending || (mode === 'voice' && voiceInputMode === 'audio' && audioFile !== null && audioUploadPending);
  const activePending = mode === 'voice' ? voicePending : mode === 'phone' ? phoneAnalysis.isPending : analysis.isPending;

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
          <p>Inspect suspicious messages, calls, and caller IDs for risk signals, authentication clues, and actionable indicators. Turn uncertain evidence into a defensible triage note.</p>
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
              <button type="button" aria-pressed={mode === 'phone'} className={`source-option ${mode === 'phone' ? 'active' : ''}`} onClick={() => chooseMode('phone')} data-testid="tab-source-phone"><Phone size={14} /><span>Phone Lookup</span></button>
            </div>

            <form onSubmit={mode === 'voice' ? submitVoice : mode === 'phone' ? submitPhone : submit}>
              {mode === 'phone' ? (
                <>
                  <div className="voice-intro phone-intro">
                    <div className="voice-intro-mark"><Phone size={18} /></div>
                    <div><strong>Phone Number OSINT</strong><span>Parse the number locally, then compare carrier and region data when live lookup is enabled.</span></div>
                  </div>
                  <div className="phone-input-grid">
                    <div>
                      <label className="field-label" htmlFor="phone-region">Country / region</label>
                      <select id="phone-region" className="phone-field" value={phoneRegion} onChange={(event) => {
                        const nextRegion = event.target.value as CountryCode;
                        setPhoneRegion(nextRegion);
                        if (!phoneNumber.trimStart().startsWith('+')) setPhoneNumber(formatPhoneAsYouType(phoneNumber, nextRegion));
                        phoneAnalysis.reset();
                      }} data-testid="select-phone-region">
                        {phoneRegions.map(({ code, name }) => <option key={code} value={code}>{name} (+{getCountryCallingCode(code)})</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="field-label" htmlFor="phone-number">Phone number</label>
                      <input ref={phoneInputRef} id="phone-number" className="phone-field phone-number-field" type="tel" autoComplete="tel" inputMode="tel" value={phoneNumber} onChange={(event) => {
                        setPhoneNumber(formatPhoneAsYouType(event.target.value, phoneRegion));
                        phoneAnalysis.reset();
                      }} onBlur={() => {
                        const parsed = parsePhonePreview(phoneNumber, phoneRegion);
                        if (parsed?.isPossible()) setPhoneNumber(parsed.number);
                      }} placeholder="+1 415 555 0132 or a local number" aria-describedby="phone-e164-preview" data-testid="input-phone-number" />
                    </div>
                  </div>
                  <div className="phone-preview-row" id="phone-e164-preview"><span>Normalized E.164</span><strong>{phoneE164Preview || 'Enter a number to preview'}</strong></div>
                  <div className="phone-claim-field">
                    <label className="field-label" htmlFor="claimed-location">Claimed caller location <span className="optional-label">OPTIONAL</span></label>
                    <input id="claimed-location" className="phone-field" value={claimedLocation} onChange={(event) => {
                      setClaimedLocation(event.target.value.slice(0, 120));
                      phoneAnalysis.reset();
                    }} placeholder="City, state / province, or country" maxLength={120} data-testid="input-claimed-location" />
                  </div>
                  <p className="phone-privacy">When enabled, the normalized number is sent to Abstract for carrier and regional metadata. Do not submit a private number without authorization. Local parsing works without the provider.</p>
                </>
              ) : mode === 'voice' ? (
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
                      <p className="audio-privacy">When transcription is configured, audio is sent to the transcription service. Without it, upload is unavailable; paste a transcript to continue. Keep sensitive personal data to a minimum.</p>
                    </>
                  )}
                </>
              ) : (
              <div className="field-label-row">
                <label className="field-label" htmlFor="message-content">{mode === 'sms' ? 'Suspicious message' : 'Raw email content'}</label>
                <span className="field-hint">{mode === 'sms' ? 'TEXT BODY' : 'HEADERS + BODY'}</span>
              </div>
              )}
              {mode !== 'voice' && mode !== 'phone' && (
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
              {mode !== 'voice' && mode !== 'phone' && analysis.isError && (
                <div className="error-box" role="alert" data-testid="status-analysis-error">
                  <strong>Analysis could not be completed.</strong>{' '}
                  {analysis.error instanceof Error ? analysis.error.message : 'Check your connection and try again.'}
                  <button type="button" onClick={() => analysis.mutate({ data: { source: mode === 'email' ? 'email' : 'sms', content: content.trim() } })} style={{ display: 'inline-flex', marginLeft: 7, border: 0, background: 'transparent', color: 'inherit', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }} data-testid="button-retry-analysis">Retry</button>
                </div>
              )}
              {mode === 'voice' && voiceAnalysis.isError && <div className="error-box" role="alert" data-testid="status-voice-analysis-error"><strong>Voice triage could not be completed.</strong>{' '}{voiceAnalysis.error instanceof Error ? voiceAnalysis.error.message : 'Check your connection and try again.'}<button type="button" onClick={() => voiceInputMode === 'transcript' && transcript.trim() ? voiceAnalysis.mutate({ data: { transcript: transcript.trim() } }) : submitVoice()} className="retry-inline" data-testid="button-retry-voice">Retry</button></div>}
              {mode === 'phone' && phoneAnalysis.isError && <div className="error-box" role="alert" data-testid="status-phone-analysis-error"><strong>Number analysis could not be completed.</strong>{' '}{phoneAnalysis.error instanceof Error ? phoneAnalysis.error.message : 'Check the number and try again.'}</div>}

              <button type="submit" className="analyze-button" disabled={mode === 'voice' ? voicePending || (voiceInputMode === 'transcript' ? !transcript.trim() || transcript.length > 100000 : !audioFile) : mode === 'phone' ? !phoneNumber.trim() || phoneAnalysis.isPending : !content.trim() || analysis.isPending || charCount > 100000} data-testid="button-analyze">
                {activePending
                  ? <><LoaderCircle size={16} className="spin" />{mode === 'voice' ? 'Analyzing call…' : mode === 'phone' ? 'Analyzing number…' : 'Reading signals…'}</>
                  : <><ScanSearch size={16} />{mode === 'voice' ? 'Analyze voice evidence' : mode === 'phone' ? 'Analyze Number' : 'Analyze message'}<ArrowRight size={15} /></>}
              </button>
            </form>
            <p className="safety-note" id={mode === 'sms' || mode === 'email' ? 'input-note' : undefined}><ShieldCheck size={14} />Analysis is heuristic, not a verdict. Treat scores as one input to human review. Avoid submitting sensitive personal data.</p>
          </section>

          <section className="panel result-panel" aria-labelledby="result-panel-title">
            <div className="panel-heading">
              <div><h2 id="result-panel-title">Triage report</h2><p>Evidence first. Conclusions with context.</p></div>
              <span className="step-tag">ASSESS 02</span>
            </div>
            {activePending ? (
              <div aria-label="Analyzing message" aria-live="polite" data-testid="status-analysis-loading">
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '20px 0' }}>
                  <div className="skeleton" style={{ width: 74, height: 74, borderRadius: '50%' }} />
                  <div style={{ flex: 1 }}><div className="skeleton" style={{ height: 11, width: '35%', marginBottom: 11 }} /><div className="skeleton" style={{ height: 8, width: '60%' }} /></div>
                </div>
                <div className="skeleton" style={{ height: 10, width: '95%', marginBottom: 9 }} /><div className="skeleton" style={{ height: 10, width: '78%', marginBottom: 24 }} />
                <div className="result-section"><div className="skeleton" style={{ height: 10, width: 125, marginBottom: 14 }} /><div className="skeleton" style={{ height: 44, marginBottom: 8 }} /><div className="skeleton" style={{ height: 44 }} /></div>
                <p className="result-meta">{mode === 'voice' ? 'TRANSCRIBING AND CHECKING CALL SIGNALS' : mode === 'phone' ? 'PARSING NUMBER AND CHECKING METADATA' : 'CHECKING MESSAGE SIGNALS'}</p>
              </div>
            ) : mode === 'voice' && shownVoiceResult ? (
              <VoiceResultView result={shownVoiceResult} onCopy={copyReport} copied={copied} />
            ) : mode === 'phone' && phoneResult ? (
              <PhoneResultView result={phoneResult} onCopy={copyReport} copied={copied} onOpenLookup={() => setLocation('/coming-soon/phone-lookup')} />
            ) : (mode === 'sms' || mode === 'email') && result ? (
              <AnalysisResultView result={result} onCopy={copyReport} copied={copied} onOpenReputation={() => setLocation('/coming-soon/reputation')} />
            ) : (
              <div className="empty-result" data-testid="content-empty-result">
                <div className="empty-graphic"><Fingerprint size={34} strokeWidth={1.4} /></div>
                <h3>{mode === 'voice' ? 'Listen for pressure.' : mode === 'phone' ? 'Verify the caller ID.' : 'Evidence goes here.'}</h3>
                <p>{mode === 'voice'
                  ? 'Submit a call recording or transcript to surface authority claims, urgency, and high-risk demands.'
                  : mode === 'phone'
                    ? 'Analyze a number for line type, carrier metadata, location signals, and caller-risk factors.'
                    : 'Submit a suspicious message to see its risk signals, extracted indicators, and analyst-ready report.'}</p>
                {providerQuery.isLoading
                  ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 21, color: '#84908a', font: '10px var(--app-font-mono)' }}><Globe2 size={13} />Checking provider status…</div>
                  : mode === 'phone'
                    ? provider?.phoneLookupConfigured
                      ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 21, color: '#84908a', font: '10px var(--app-font-mono)' }}><Phone size={13} />LIVE PHONE LOOKUP · ABSTRACT</div>
                      : <button type="button" className="empty-provider-action" onClick={() => setLocation('/coming-soon/phone-lookup')}><Phone size={13} />LIVE CARRIER LOOKUP · COMING SOON</button>
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
