import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as http from "node:http";
import * as https from "node:https";
import { AnalyzeContentResponse } from "@workspace/api-zod";

type AnalysisResult = ReturnType<typeof AnalyzeContentResponse.parse>;
type Indicator = AnalysisResult["indicators"][number];
type AuthCheck = AnalysisResult["authChecks"][number];
type RiskFactor = AnalysisResult["factors"][number];
type Reputation = Indicator["reputation"];

const MAX_URLS = 10;
const MAX_REDIRECTS = 4;
const REQUEST_TIMEOUT_MS = 4_000;
const KNOWN_SHORTENERS = new Set([
  "bit.ly",
  "t.co",
  "tinyurl.com",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "cutt.ly",
  "rebrand.ly",
  "lnkd.in",
  "shorturl.at",
  "rb.gy",
]);
const PRESSURE_PHRASES = [
  "act now",
  "immediately",
  "urgent",
  "expires today",
  "final notice",
  "account suspended",
  "verify now",
  "within 24 hours",
  "limited time",
  "avoid interruption",
  "suspicious activity",
  "unauthorized login",
];
const CREDENTIAL_PHRASES = [
  "password",
  "verify your account",
  "sign in",
  "login",
  "one-time code",
  "verification code",
  "bank account",
  "credit card",
  "payment details",
  "social security",
  "recovery phrase",
];
const BRAND_DOMAINS: Record<string, string[]> = {
  paypal: ["paypal.com", "paypalobjects.com"],
  amazon: ["amazon.com", "amazon.co.uk", "amazon.ca", "amazon.de"],
  apple: ["apple.com", "icloud.com"],
  microsoft: ["microsoft.com", "live.com", "outlook.com"],
  google: ["google.com", "gmail.com"],
  netflix: ["netflix.com"],
  coinbase: ["coinbase.com"],
  chase: ["chase.com"],
  "wells fargo": ["wellsfargo.com"],
  "bank of america": ["bankofamerica.com"],
  dhl: ["dhl.com"],
  fedex: ["fedex.com"],
  usps: ["usps.com"],
  ups: ["ups.com"],
  spotify: ["spotify.com"],
};

type ExtractedUrl = {
  original: string;
  normalized: string;
  host: string;
  shortener: boolean;
  anchorMismatch: boolean;
};

type ReputationResult = {
  reputation: Reputation;
  detail: string;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanUrlCandidate(value: string): string {
  return decodeHtml(value).replace(/[),.;!?:\]}]+$/g, "");
}

function normalizeUrl(value: string): URL | null {
  try {
    const normalized = value.startsWith("www.") ? `https://${value}` : value;
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function extractUrls(content: string, source: "sms" | "email"): ExtractedUrl[] {
  const candidates = new Set<string>();
  const urlPattern = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
  for (const match of content.matchAll(urlPattern)) {
    candidates.add(cleanUrlCandidate(match[0]));
  }

  const anchors: Array<{ href: string; text: string }> = [];
  if (source === "email") {
    const anchorPattern =
      /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi;
    for (const match of content.matchAll(anchorPattern)) {
      const href = cleanUrlCandidate(match[1] ?? "");
      const text = decodeHtml(match[2] ?? "").replace(/<[^>]*>/g, " ").trim();
      const url = normalizeUrl(href);
      if (url) {
        candidates.add(href);
        anchors.push({ href: url.href, text });
      }
    }
  }

  const results: ExtractedUrl[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const url = normalizeUrl(candidate);
    if (!url) continue;
    const normalized = url.href;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const mismatch = anchors.some((anchor) => {
      if (normalizeUrl(anchor.href)?.href !== normalized) return false;
      const text = anchor.text.toLowerCase();
      return Object.entries(BRAND_DOMAINS).some(([brand, domains]) => {
        if (!text.includes(brand)) return false;
        return !domains.some(
          (domain) => host === domain || host.endsWith(`.${domain}`),
        );
      });
    });
    results.push({
      original: candidate,
      normalized,
      host,
      shortener: KNOWN_SHORTENERS.has(host),
      anchorMismatch: mismatch,
    });
    if (results.length >= MAX_URLS) break;
  }
  return results;
}

function defang(value: string): string {
  return value
    .replace(/^https:\/\//i, "hxxps://")
    .replace(/^http:\/\//i, "hxxp://")
    .replace(/\./g, "[.]");
}

function getPhones(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(/\+?\d[\d ().-]{5,}\d/g)) {
    const value = match[0].trim();
    const digits = value.replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15) found.add(value);
  }
  return [...found].slice(0, 15);
}

function getDomainsAndIps(content: string, urls: ExtractedUrl[]): string[] {
  const values = new Set<string>();
  const ipPattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  for (const match of content.matchAll(ipPattern)) {
    if (isIP(match[0]) === 4) values.add(match[0]);
  }
  const domainPattern =
    /(?<![@\w.-])(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}\b/gi;
  for (const match of content.matchAll(domainPattern)) {
    values.add(match[0].toLowerCase());
  }
  for (const item of urls) {
    if (isIP(item.host) === 4) values.add(item.host);
    else if (isIP(item.host) === 0) values.add(item.host);
  }
  return [...values].slice(0, 30);
}

function splitEmail(raw: string): { headers: Map<string, string[]>; body: string } {
  const separator = raw.search(/\r?\n\r?\n/);
  const headerText = separator < 0 ? raw : raw.slice(0, separator);
  const body = separator < 0 ? "" : raw.slice(separator).replace(/^\r?\n\r?\n/, "");
  const unfolded = headerText.replace(/\r?\n[ \t]+/g, " ");
  const headers = new Map<string, string[]>();
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    const values = headers.get(name) ?? [];
    values.push(value);
    headers.set(name, values);
  }
  return { headers, body };
}

function emailDomain(fromHeader: string): string | null {
  const address = fromHeader.match(/<?[^<>\s@]+@([^<>\s,;]+)>?/);
  return address?.[1]?.replace(/[)>].*$/, "").toLowerCase() ?? null;
}

function isAligned(domain: string | null, fromDomain: string | null): boolean | null {
  if (!domain || !fromDomain) return null;
  const a = domain.toLowerCase().replace(/\.$/, "");
  const b = fromDomain.toLowerCase().replace(/\.$/, "");
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function parseAuthChecks(raw: string): AuthCheck[] {
  const { headers } = splitEmail(raw);
  const fromDomain = emailDomain((headers.get("from") ?? [""])[0] ?? "");
  const authResult = (headers.get("authentication-results") ?? []).join("; ");
  const receivedSpf = (headers.get("received-spf") ?? []).join("; ");
  const source = `${authResult}; ${receivedSpf}`;
  const readStatus = (mechanism: string): "pass" | "fail" | "neutral" | "unknown" => {
    const match = source.match(
      new RegExp(`\\b${mechanism}=(pass|fail|softfail|neutral|none|temperror|permerror)\\b`, "i"),
    );
    if (!match) return "unknown";
    const status = match[1]?.toLowerCase();
    if (status === "pass") return "pass";
    if (status === "fail" || status === "softfail" || status === "permerror") {
      return "fail";
    }
    return "neutral";
  };
  const readDomain = (pattern: RegExp): string | null =>
    source.match(pattern)?.[1]?.replace(/[>,;)}]+$/, "").toLowerCase() ?? null;

  const spfDomain = readDomain(/\b(?:smtp\.mailfrom|envelope-from|smtp\.helo)=<?([^;\s]+)/i);
  const dkimDomain = readDomain(/\b(?:header\.d|header\.i|d)=<?([^;\s]+)/i);
  const dmarcDomain = readDomain(/\bheader\.from=([^;\s]+)/i) ?? fromDomain;
  const spfStatus = readStatus("spf");
  const dkimStatus = readStatus("dkim");
  const dmarcStatus = readStatus("dmarc");
  const makeCheck = (
    mechanism: "spf" | "dkim" | "dmarc",
    status: AuthCheck["status"],
    domain: string | null,
    aligned: boolean | null,
  ): AuthCheck => ({
    mechanism,
    status,
    domain,
    aligned,
    detail:
      status === "unknown"
        ? "No result for this mechanism was found in the pasted headers."
        : mechanism === "dmarc"
          ? `Header reports DMARC ${status}${fromDomain ? ` for ${defang(fromDomain)}` : ""}.`
          : `${mechanism.toUpperCase()} reports ${status}${domain ? ` for ${defang(domain)}` : ""}${aligned === false ? "; domain is not aligned with From." : ""}.`,
  });

  return [
    makeCheck("spf", spfStatus, spfDomain, isAligned(spfDomain, fromDomain)),
    makeCheck("dkim", dkimStatus, dkimDomain, isAligned(dkimDomain, fromDomain)),
    makeCheck(
      "dmarc",
      dmarcStatus,
      dmarcDomain,
      dmarcStatus === "pass" ? true : dmarcStatus === "fail" ? false : null,
    ),
  ];
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    const number =
      (((parts[0] ?? 0) << 24) |
        ((parts[1] ?? 0) << 16) |
        ((parts[2] ?? 0) << 8) |
        (parts[3] ?? 0)) >>>
      0;
    const blocked = [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ] as const;
    return blocked.some(([base, prefix]) => {
      const baseParts = base.split(".").map(Number);
      const baseNumber =
        (((baseParts[0] ?? 0) << 24) |
          ((baseParts[1] ?? 0) << 16) |
          ((baseParts[2] ?? 0) << 8) |
          (baseParts[3] ?? 0)) >>>
        0;
      const mask = (0xffffffff << (32 - prefix)) >>> 0;
      return (number & mask) === (baseNumber & mask);
    });
  }
  if (version !== 6) return true;

  const ip = address.toLowerCase().split("%", 1)[0] ?? address.toLowerCase();
  if (ip === "::" || ip === "::1") return true;
  if (ip.startsWith("::ffff:")) {
    const mapped = ip.slice(7);
    return isIP(mapped) === 4 ? isPrivateAddress(mapped) : true;
  }
  const firstGroup = Number.parseInt(ip.split(":")[0] || "0", 16);
  return (
    (firstGroup & 0xfe00) === 0xfc00 ||
    (firstGroup & 0xffc0) === 0xfe80 ||
    (firstGroup & 0xff00) === 0xff00 ||
    ip.startsWith("2001:db8:")
  );
}

async function lookupPublicHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid")
  ) {
    throw new Error("Private or reserved host");
  }
  const addresses =
    isIP(host) !== 0
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some((record) => isPrivateAddress(record.address))
  ) {
    throw new Error("Private or reserved address");
  }
  return addresses;
}

function safeHeadRequest(url: URL): Promise<{ status: number; location: string | null }> {
  const transport = url.protocol === "https:" ? https : http;
  return lookupPublicHost(url.hostname).then(
    (addresses): Promise<{ status: number; location: string | null }> =>
      new Promise((resolve, reject) => {
        const pinnedLookup = ((_: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
          if (options?.all) {
            callback(null, addresses);
            return;
          }
          const first = addresses[0];
          if (!first) {
            callback(new Error("DNS lookup returned no addresses"));
            return;
          }
          callback(null, first.address, first.family);
        }) as never;
        const agent =
          url.protocol === "https:"
            ? new https.Agent({ keepAlive: false, lookup: pinnedLookup })
            : new http.Agent({ keepAlive: false, lookup: pinnedLookup });
        const request = transport.request(
          {
            protocol: url.protocol,
            hostname: url.hostname.replace(/^\[|\]$/g, ""),
            port: url.port || undefined,
            path: `${url.pathname}${url.search}`,
            method: "HEAD",
            headers: {
              "user-agent": "PhishIntakeAnalyzer/1.0",
              accept: "*/*",
            },
            agent,
            servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) ? undefined : url.hostname,
          },
          (response) => {
            const result = {
              status: response.statusCode ?? 0,
              location: response.headers.location ?? null,
            };
            response.resume();
            response.on("end", () => {
              agent.destroy();
              resolve(result);
            });
          },
        );
        request.setTimeout(REQUEST_TIMEOUT_MS, () =>
          request.destroy(new Error("URL check timed out")),
        );
        request.on("error", (error) => {
          agent.destroy();
          reject(error);
        });
        request.end();
      }),
  );
}

async function resolveShortener(initial: string): Promise<string[]> {
  const chain = [initial];
  let current = new URL(initial);
  for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
    let response: { status: number; location: string | null };
    try {
      response = await safeHeadRequest(current);
    } catch {
      break;
    }
    if (
      !response.location ||
      ![301, 302, 303, 307, 308].includes(response.status)
    ) {
      break;
    }
    let next: URL;
    try {
      next = new URL(response.location, current);
    } catch {
      break;
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") break;
    if (next.username || next.password || chain.includes(next.href)) break;
    chain.push(next.href);
    current = next;
  }
  return chain;
}

function configuredProvider(): AnalysisResult["reputationProvider"] {
  if (process.env.VIRUSTOTAL_API_KEY) return "virustotal";
  if (process.env.GOOGLE_SAFE_BROWSING_API_KEY) return "google_safe_browsing";
  return null;
}

async function checkReputation(url: string): Promise<ReputationResult> {
  const provider = configuredProvider();
  if (!provider) {
    return {
      reputation: "unknown",
      detail: "Reputation lookup is not configured; local analysis only.",
    };
  }
  try {
    if (provider === "virustotal") {
      const identifier = Buffer.from(url).toString("base64url");
      const response = await fetch(
        `https://www.virustotal.com/api/v3/urls/${identifier}`,
        {
          headers: { "x-apikey": process.env.VIRUSTOTAL_API_KEY ?? "" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (response.status === 404) {
        return { reputation: "unknown", detail: "Not yet rated by VirusTotal." };
      }
      if (!response.ok) throw new Error("VirusTotal lookup failed");
      const result: unknown = await response.json();
      const stats = (
        result as {
          data?: { attributes?: { last_analysis_stats?: Record<string, number> } };
        }
      ).data?.attributes?.last_analysis_stats;
      const malicious = stats?.malicious ?? 0;
      const suspicious = stats?.suspicious ?? 0;
      if (malicious > 0) {
        return {
          reputation: "malicious",
          detail: `VirusTotal: ${malicious} engine${malicious === 1 ? "" : "s"} marked this URL malicious.`,
        };
      }
      if (suspicious > 0) {
        return {
          reputation: "suspicious",
          detail: `VirusTotal: ${suspicious} engine${suspicious === 1 ? "" : "s"} marked this URL suspicious.`,
        };
      }
      if (stats) {
        return { reputation: "safe", detail: "No malicious or suspicious VirusTotal detections." };
      }
      return { reputation: "unknown", detail: "VirusTotal returned no analysis data." };
    }

    const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY ?? "";
    const response = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client: { clientId: "phish-intake-analyzer", clientVersion: "1.0" },
          threatInfo: {
            threatTypes: [
              "MALWARE",
              "SOCIAL_ENGINEERING",
              "UNWANTED_SOFTWARE",
              "POTENTIALLY_HARMFUL_APPLICATION",
            ],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: [{ url }],
          },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (!response.ok) throw new Error("Safe Browsing lookup failed");
    const result = (await response.json()) as { matches?: unknown[] };
    return result.matches?.length
      ? { reputation: "malicious", detail: "Google Safe Browsing reported a threat match." }
      : { reputation: "safe", detail: "No Google Safe Browsing match was reported." };
  } catch {
    return {
      reputation: "unknown",
      detail: "Reputation provider could not complete this lookup.",
    };
  }
}

function makeFactor(
  id: string,
  label: string,
  points: number,
  triggered: boolean,
  detail: string,
): RiskFactor {
  return { id, label, points: triggered ? points : 0, triggered, detail };
}

export async function analyzeMessage(
  source: "sms" | "email",
  content: string,
): Promise<AnalysisResult> {
  const urls = extractUrls(content, source);
  const reputation = await Promise.all(
    urls.map(async (url) => ({
      url,
      result: await checkReputation(url.normalized),
    })),
  );
  const reputationByUrl = new Map(reputation.map((item) => [item.url.normalized, item.result]));

  const resolved = await Promise.all(
    urls.map(async (url) => ({
      url,
      chain: url.shortener ? await resolveShortener(url.normalized) : [url.normalized],
    })),
  );
  const chainByUrl = new Map(resolved.map((item) => [item.url.normalized, item.chain]));
  const indicators: Indicator[] = [];

  for (const item of urls) {
    const verdict = reputationByUrl.get(item.normalized) ?? {
      reputation: "unknown" as const,
      detail: "No reputation result.",
    };
    const chain = chainByUrl.get(item.normalized) ?? [item.normalized];
    indicators.push({
      kind: "url",
      value: defang(item.normalized),
      reputation: verdict.reputation,
      reputationDetail: verdict.detail,
      redirectChain: chain.map(defang),
      shortener: item.shortener,
      anchorMismatch: item.anchorMismatch,
    });
  }

  for (const value of getDomainsAndIps(content, urls)) {
    const kind = isIP(value) === 4 ? "ip" : "domain";
    const alreadyCovered = urls.some((url) => url.host === value);
    if (alreadyCovered) continue;
    indicators.push({
      kind,
      value: defang(value),
      reputation: "unknown",
      reputationDetail: "Extracted indicator; reputation checks apply to URLs only.",
      redirectChain: [],
      shortener: false,
      anchorMismatch: false,
    });
  }
  for (const value of getPhones(content)) {
    indicators.push({
      kind: "phone",
      value,
      reputation: "unknown",
      reputationDetail: "Phone number extracted from message.",
      redirectChain: [],
      shortener: false,
      anchorMismatch: false,
    });
  }

  const urgencyFlags = PRESSURE_PHRASES.filter((phrase) =>
    content.toLowerCase().includes(phrase),
  ).map((phrase) => `High-pressure language: “${phrase}”`);
  const authChecks = source === "email" ? parseAuthChecks(content) : [];
  const knownAuth = authChecks.filter((check) => check.status !== "unknown");
  const failedAuth = authChecks.filter((check) => check.status === "fail");
  const passedAuth = authChecks.filter((check) => check.status === "pass");
  const authOverall =
    source === "sms"
      ? "not_applicable"
      : knownAuth.length === 0
        ? "unavailable"
        : failedAuth.length > 0 && passedAuth.length > 0
          ? "mixed"
          : failedAuth.length > 0
            ? "fail"
            : passedAuth.length === knownAuth.length
              ? "pass"
              : "mixed";

  const maliciousCount = reputation.filter(
    (item) => item.result.reputation === "malicious",
  ).length;
  const suspiciousCount = reputation.filter(
    (item) => item.result.reputation === "suspicious",
  ).length;
  const hasShortener = urls.some((url) => url.shortener);
  const hasMismatch = urls.some((url) => url.anchorMismatch);
  const hasCredentialLure = CREDENTIAL_PHRASES.some((phrase) =>
    content.toLowerCase().includes(phrase),
  );
  const hasManyLinks = urls.length > 3;
  const dmarcFailed = authChecks.some(
    (check) => check.mechanism === "dmarc" && check.status === "fail",
  );
  const spfFailed = authChecks.some(
    (check) => check.mechanism === "spf" && check.status === "fail",
  );
  const dkimFailed = authChecks.some(
    (check) => check.mechanism === "dkim" && check.status === "fail",
  );
  const factors: RiskFactor[] = [
    makeFactor(
      "malicious-url",
      "Malicious URL reputation",
      50,
      maliciousCount > 0,
      maliciousCount > 0 ? `${maliciousCount} URL(s) reported malicious.` : "No malicious URL verdict.",
    ),
    makeFactor(
      "suspicious-url",
      "Suspicious URL reputation",
      28,
      suspiciousCount > 0 && maliciousCount === 0,
      suspiciousCount > 0 ? `${suspiciousCount} URL(s) reported suspicious.` : "No suspicious URL verdict.",
    ),
    makeFactor(
      "anchor-mismatch",
      "Displayed brand and link destination differ",
      25,
      hasMismatch,
      hasMismatch ? "A link mentions a known brand but points to an unrelated domain." : "No known brand/link mismatch found.",
    ),
    makeFactor(
      "dmarc-failure",
      "DMARC failed",
      20,
      dmarcFailed,
      dmarcFailed ? "Pasted Authentication-Results report DMARC failure." : "No reported DMARC failure.",
    ),
    makeFactor(
      "pressure",
      "High-pressure language",
      14,
      urgencyFlags.length > 0,
      urgencyFlags.length > 0 ? `${urgencyFlags.length} urgency phrase(s) found.` : "No configured urgency phrases found.",
    ),
    makeFactor(
      "shortener",
      "Known URL shortener",
      14,
      hasShortener,
      hasShortener ? "A known shortener obscures the destination." : "No known URL shortener found.",
    ),
    makeFactor(
      "credential-lure",
      "Credential or payment request",
      13,
      hasCredentialLure,
      hasCredentialLure ? "Message includes credential, account, or payment language." : "No configured credential/payment phrase found.",
    ),
    makeFactor(
      "spf-failure",
      "SPF failed",
      8,
      spfFailed,
      spfFailed ? "Pasted Authentication-Results report SPF failure." : "No reported SPF failure.",
    ),
    makeFactor(
      "dkim-failure",
      "DKIM failed",
      8,
      dkimFailed,
      dkimFailed ? "Pasted Authentication-Results report DKIM failure." : "No reported DKIM failure.",
    ),
    makeFactor(
      "many-links",
      "Multiple links",
      5,
      hasManyLinks,
      hasManyLinks ? `${urls.length} URLs extracted.` : "Four or fewer URLs extracted.",
    ),
  ];
  const riskScore = Math.min(
    100,
    factors.reduce((total, factor) => total + factor.points, 0),
  );
  const riskLevel =
    riskScore >= 75
      ? "critical"
      : riskScore >= 50
        ? "high"
        : riskScore >= 25
          ? "moderate"
          : "low";

  const findings = [
    `${urls.length} URL(s) extracted (maximum ${MAX_URLS} analyzed).`,
    `${indicators.filter((item) => item.kind === "domain").length} domain(s), ${indicators.filter((item) => item.kind === "ip").length} IP address(es), and ${indicators.filter((item) => item.kind === "phone").length} phone number(s) extracted.`,
    source === "email"
      ? `SPF, DKIM, and DMARC results are parsed from supplied headers only; DNS authentication checks are not performed.${authOverall === "unavailable" ? " No usable Authentication-Results were present." : ""}`
      : "Email authentication checks do not apply to SMS input.",
    configuredProvider()
      ? `URL reputation checked with ${configuredProvider() === "virustotal" ? "VirusTotal" : "Google Safe Browsing"} when available.`
      : "No reputation API key is configured; score uses local indicators only.",
    "Risk score is a triage aid, not a guarantee of safety.",
  ];
  if (hasMismatch) findings.push("At least one known-brand anchor points to an unrelated domain.");
  if (resolved.some((item) => item.url.shortener && item.chain.length > 1)) {
    findings.push(`Shortened URL resolution stopped after at most ${MAX_REDIRECTS} redirects.`);
  }

  const summary =
    riskLevel === "critical"
      ? "Multiple strong risk signals found. Treat as malicious until verified."
      : riskLevel === "high"
        ? "Several risk signals found. Verify through a trusted channel before acting."
        : riskLevel === "moderate"
          ? "Some risk signals found. Review the indicators and verify independently."
          : "Few configured risk signals found. This is not proof that the message is safe.";

  return AnalyzeContentResponse.parse({
    source,
    analyzedAt: new Date().toISOString(),
    riskScore,
    riskLevel,
    summary,
    indicators,
    urgencyFlags,
    authChecks,
    authOverall,
    factors,
    findings,
    reputationConfigured: Boolean(configuredProvider()),
    reputationProvider: configuredProvider(),
  });
}
