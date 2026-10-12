import { File } from "node:buffer";
import {
  TriageVoiceResponse,
  type VoiceTriageResult,
  type VoiceTriageResultTranscriptionMode,
} from "@workspace/api-zod";

const MOCK_AUDIO_TRANSCRIPT =
  "This is the bank fraud desk. Your account is frozen, so take immediate action. Buy a gift card and read me the one-time passcode to restore access.";
const MAX_TRANSCRIPT_LENGTH = 100_000;

type VishingCategory =
  VoiceTriageResult["vishingIndicators"][number]["category"];

interface DetectionRule {
  category: VishingCategory;
  label: string;
  points: number;
  detail: string;
  patterns: RegExp[];
}

const DETECTION_RULES: DetectionRule[] = [
  {
    category: "authority_impersonation",
    label: "Authority impersonation",
    points: 24,
    detail:
      "The transcript references a government agency, bank fraud team, or IT helpdesk. Verify the caller using a trusted number.",
    patterns: [
      /\bIRS\b/gi,
      /\bInternal Revenue Service\b/gi,
      /\bSocial Security(?: Administration)?\b/gi,
      /\bSSA\b/gi,
      /\b(?:bank|credit union)\s+fraud\s+(?:desk|department|team)\b/gi,
      /\b(?:fraud|security)\s+department\b/gi,
      /\bIT\s+help[- ]?desk\b/gi,
      /\btechnical support\b/gi,
    ],
  },
  {
    category: "fear_urgency",
    label: "Fear and urgency",
    points: 30,
    detail:
      "Threats, account-freeze claims, or pressure to act immediately can be used to prevent independent verification.",
    patterns: [
      /\bimminent arrest\b/gi,
      /\barrest warrant\b/gi,
      /\b(?:go to jail|face arrest|be arrested)\b/gi,
      /\b(?:your\s+)?(?:account|card)\s+(?:has been|is|will be|was)\s+frozen\b/gi,
      /\bfrozen account\b/gi,
      /\bimmediate action\b/gi,
      /\bact immediately\b/gi,
      /\bwithin\s+(?:\d+|one|two|three|four|five|ten)\s+(?:minutes?|hours?)\b/gi,
      /\burgent(?:ly)?\b/gi,
      /\bfinal (?:notice|warning)\b/gi,
    ],
  },
  {
    category: "high_risk_demand",
    label: "High-risk payment or credential demand",
    points: 46,
    detail:
      "Payment transfers, gift cards, cryptocurrency kiosks, or one-time security codes should never be provided to an unverified caller.",
    patterns: [
      /\bwire\s+transfer\b/gi,
      /\bgift\s+cards?\b/gi,
      /\bBitcoin\s+ATM\b/gi,
      /\b(?:Bitcoin|cryptocurrency|crypto)\b/gi,
      /\bone[- ]time\s+(?:passcode|password|code)\b/gi,
      /\bOTP\b/gi,
      /\b2FA\b/gi,
      /\btwo[- ]factor authentication\b/gi,
      /\bverification code\b/gi,
      /\bsecurity code\b/gi,
      /\b(?:read|tell|share|give|provide)\s+(?:me\s+)?(?:the\s+)?(?:six[- ]digit|verification|security|one[- ]time)\s+code\b/gi,
    ],
  },
];

export class VoiceTranscriptionError extends Error {
  constructor(
    message: string,
    readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = "VoiceTranscriptionError";
  }
}

function extractExactQuotes(text: string, patterns: RegExp[]): string[] {
  const quotes = new Set<string>();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const quote = match[0]?.trim();
      if (quote) quotes.add(quote);
      if (quotes.size >= 8) return [...quotes];
    }
  }
  return [...quotes];
}

function riskLevelFor(score: number): VoiceTriageResult["riskLevel"] {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "moderate";
  return "low";
}

export function analyzeVoiceTranscript(
  transcript: string,
  transcriptionMode: VoiceTriageResultTranscriptionMode,
): VoiceTriageResult {
  const cleanTranscript = transcript.trim();
  const vishingIndicators: VoiceTriageResult["vishingIndicators"] = [];
  const factors: VoiceTriageResult["factors"] = [];

  for (const rule of DETECTION_RULES) {
    const quotes = extractExactQuotes(cleanTranscript, rule.patterns);
    const triggered = quotes.length > 0;
    factors.push({
      id: rule.category,
      label: rule.label,
      points: rule.points,
      triggered,
      detail: triggered
        ? `${rule.detail} Matched ${quotes.length} phrase${quotes.length === 1 ? "" : "s"}.`
        : rule.detail,
    });
    if (triggered) {
      vishingIndicators.push({
        category: rule.category,
        label: rule.label,
        quotes,
        detail: rule.detail,
      });
    }
  }

  const riskScore = Math.min(
    100,
    factors.reduce(
      (total, factor) => total + (factor.triggered ? factor.points : 0),
      0,
    ),
  );
  const riskLevel = riskLevelFor(riskScore);
  const summary =
    riskLevel === "critical"
      ? "Multiple strong vishing signals found. Verify the caller through a trusted channel before taking action."
      : riskLevel === "high"
        ? "High-risk caller behavior was detected. Do not transfer money or share codes; verify independently."
        : riskLevel === "moderate"
          ? "Some caller-pressure signals were detected. Review the exact phrases and verify the caller independently."
          : "Few configured vishing signals were found. This is not proof that the call is safe.";

  const findings = vishingIndicators.map(
    (indicator) =>
      `${indicator.label}: ${indicator.quotes.map((quote) => `“${quote}”`).join(", ")}.`,
  );
  if (!findings.length) {
    findings.push("No configured vishing trigger phrases were detected.");
  }

  return TriageVoiceResponse.parse({
    source: "voice",
    analyzedAt: new Date().toISOString(),
    transcriptionMode,
    transcript: cleanTranscript,
    riskScore,
    riskLevel,
    summary,
    vishingIndicators,
    factors,
    findings,
  });
}

export function getMockAudioTranscript(): string {
  return MOCK_AUDIO_TRANSCRIPT;
}

export async function transcribeWithWhisper(
  audio: Express.Multer.File,
  apiKey: string,
): Promise<string> {
  const extension = audio.originalname.toLowerCase().match(/\.(mp3|wav|m4a)$/)?.[1];
  if (!extension) {
    throw new VoiceTranscriptionError("Upload an MP3, WAV, or M4A audio file.");
  }

  const mimeByExtension: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
  };
  const safeFile = new File(
    [new Uint8Array(audio.buffer)],
    `call.${extension}`,
    { type: mimeByExtension[extension] },
  );
  const form = new FormData();
  form.set("file", safeFile);
  form.set("model", "whisper-1");
  form.set("response_format", "json");

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new VoiceTranscriptionError(
      "Whisper could not be reached. Try again or paste a transcript.",
    );
  }

  if (!response.ok) {
    throw new VoiceTranscriptionError(
      "Whisper could not transcribe this audio. Confirm API access and try again, or paste a transcript.",
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new VoiceTranscriptionError(
      "Whisper returned an unreadable response. Try again or paste a transcript.",
      response.status,
    );
  }

  const transcript =
    typeof payload === "object" &&
    payload !== null &&
    "text" in payload &&
    typeof payload.text === "string"
      ? payload.text.trim()
      : "";
  if (!transcript) {
    throw new VoiceTranscriptionError(
      "No speech transcript was returned. Try another recording or paste a transcript.",
      response.status,
    );
  }
  if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
    throw new VoiceTranscriptionError(
      "The transcript is too long to analyze. Use a shorter audio recording.",
      response.status,
    );
  }

  return transcript;
}
