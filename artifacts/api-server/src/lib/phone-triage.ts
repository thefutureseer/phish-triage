import * as googlePhone from "google-libphonenumber";
import type { PhoneTriageResult } from "@workspace/api-zod";

const phoneUtil = googlePhone.PhoneNumberUtil.getInstance();
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

const usStateNames: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC",
};

const virtualNumberBrands = [
  "burner",
  "dingtone",
  "google voice",
  "hushed",
  "pinger",
  "sideline",
  "talkatone",
  "textfree",
  "textnow",
];

type AbstractPhoneResponse = {
  valid: boolean | null;
  type: string | null;
  carrier: string | null;
  countryCode: string | null;
  countryName: string | null;
  location: string | null;
};

export class PhoneNumberInputError extends Error {}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeProviderString(value: unknown, maxLength = 120): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function readAbstractResponse(value: unknown): AbstractPhoneResponse | null {
  const data = asRecord(value);
  if (!data) return null;
  const country = asRecord(data.country);
  return {
    valid: typeof data.valid === "boolean" ? data.valid : null,
    type: safeProviderString(data.type, 40),
    carrier: safeProviderString(data.carrier),
    countryCode: safeProviderString(country?.code, 2)?.toUpperCase() ?? null,
    countryName: safeProviderString(country?.name),
    location: safeProviderString(data.location),
  };
}

async function lookupAbstractPhone(
  e164: string,
  apiKey: string,
): Promise<AbstractPhoneResponse | null> {
  const url = new URL("https://phonevalidation.abstractapi.com/v1/");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("phone", e164);

  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return null;
  const payload: unknown = await response.json().catch(() => null);
  return readAbstractResponse(payload);
}

function lineTypeFromGoogle(number: googlePhone.PhoneNumber): PhoneTriageResult["lineType"] {
  switch (phoneUtil.getNumberType(number)) {
    case googlePhone.PhoneNumberType.MOBILE:
      return "wireless";
    case googlePhone.PhoneNumberType.FIXED_LINE:
      return "landline";
    case googlePhone.PhoneNumberType.VOIP:
      return "voip_virtual";
    case googlePhone.PhoneNumberType.UNKNOWN:
      return "unknown";
    default:
      return "other";
  }
}

function lineTypeFromAbstract(value: string | null): PhoneTriageResult["lineType"] | null {
  switch (value?.toLowerCase().replace(/[^a-z]/g, "")) {
    case "mobile":
      return "wireless";
    case "landline":
    case "fixedline":
      return "landline";
    case "voip":
    case "nonfixedvoip":
    case "virtual":
      return "voip_virtual";
    case "satellite":
    case "premium":
    case "paging":
    case "special":
    case "tollfree":
      return "other";
    default:
      return null;
  }
}

function splitLocation(location: string | null): { city: string | null; region: string | null } {
  if (!location) return { city: null, region: null };
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { city: null, region: location };
  return {
    city: parts.slice(0, -1).join(", "),
    region: parts[parts.length - 1] ?? null,
  };
}

function mentionPattern(value: string): RegExp {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i");
}

function findUsState(value: string): string | null {
  const normalized = value.toLowerCase();
  for (const [name, code] of Object.entries(usStateNames)) {
    if (mentionPattern(name).test(normalized)) return code;
  }
  for (const code of new Set(Object.values(usStateNames))) {
    if (mentionPattern(code).test(value)) return code;
  }
  return null;
}

function findClaimedCountry(value: string): string | null {
  for (const region of phoneUtil.getSupportedRegions()) {
    const name = regionNames.of(region);
    if (name && name.length > 3 && mentionPattern(name).test(value)) return region;
  }
  return null;
}

function hasLocationMismatch(
  claimedLocation: string | null,
  countryCode: string | null,
  countryName: string | null,
  region: string | null,
): boolean {
  if (!claimedLocation) return false;
  const isUnitedStates = countryCode === "US"
    || countryName?.toLowerCase() === "united states";
  if (isUnitedStates) {
    const claimedState = findUsState(claimedLocation);
    if (claimedState) {
      const actualState = region ? findUsState(region) : null;
      return actualState !== null && actualState !== claimedState;
    }
  }

  const claimedCountry = findClaimedCountry(claimedLocation);
  if (claimedCountry && countryCode && claimedCountry !== countryCode) return true;

  return false;
}

function virtualBrand(carrier: string | null): string | null {
  const normalized = carrier?.toLowerCase();
  if (!normalized) return null;
  return virtualNumberBrands.find((brand) => normalized.includes(brand)) ?? null;
}

function riskLevel(score: number): PhoneTriageResult["riskLevel"] {
  if (score >= 70) return "critical";
  if (score >= 45) return "high";
  if (score >= 20) return "moderate";
  return "low";
}

export async function analyzePhoneNumber(
  input: { phoneNumber: string; defaultRegion: string; claimedLocation?: string },
  apiKey?: string,
): Promise<PhoneTriageResult> {
  const defaultRegion = input.defaultRegion.toUpperCase();
  if (!phoneUtil.getSupportedRegions().includes(defaultRegion as googlePhone.RegionCode)) {
    throw new PhoneNumberInputError("Choose a supported country or region.");
  }

  let parsed: googlePhone.PhoneNumber;
  try {
    parsed = phoneUtil.parseAndKeepRawInput(input.phoneNumber.trim(), defaultRegion);
  } catch {
    throw new PhoneNumberInputError("Enter a phone number with a valid country calling code.");
  }

  const e164 = phoneUtil.format(parsed, googlePhone.PhoneNumberFormat.E164);
  const nationalFormat = phoneUtil.format(parsed, googlePhone.PhoneNumberFormat.NATIONAL);
  const isPossible = phoneUtil.isPossibleNumber(parsed);
  const localValidity = phoneUtil.isValidNumber(parsed);
  const callingCode = parsed.getCountryCodeOrDefault();
  const parsedRegion = phoneUtil.getRegionCodeForNumber(parsed) ?? "ZZ";
  const localCountryCode = parsedRegion === "ZZ" ? null : parsedRegion;
  const localCountryName = localCountryCode ? regionNames.of(localCountryCode) ?? null : null;
  const localLineType = lineTypeFromGoogle(parsed);

  let external: AbstractPhoneResponse | null = null;
  let externalLookupStatus: PhoneTriageResult["externalLookupStatus"] = "not_configured";
  if (apiKey && !localValidity) {
    externalLookupStatus = "skipped_invalid";
  } else if (apiKey) {
    try {
      external = await lookupAbstractPhone(e164, apiKey);
      externalLookupStatus = external ? "success" : "unavailable";
    } catch {
      externalLookupStatus = "unavailable";
    }
  }

  const externalLineType = lineTypeFromAbstract(external?.type ?? null);
  const lineType = externalLineType ?? localLineType;
  const lineTypeSource: PhoneTriageResult["lineTypeSource"] = externalLineType
    ? "abstract_phone"
    : localLineType === "unknown" ? "unknown" : "google_libphonenumber";
  const carrier = external?.carrier ?? null;
  const carrierSource: PhoneTriageResult["carrierSource"] = carrier ? "abstract_phone" : "none";
  const locationParts = splitLocation(external?.location ?? null);
  const countryCode = external?.countryCode ?? localCountryCode;
  const countryName = external?.countryName ?? (countryCode ? regionNames.of(countryCode) ?? localCountryName : localCountryName);
  const locationCountry = countryName;
  const claimedLocation = input.claimedLocation?.trim().slice(0, 120) || null;
  const locationMismatch = hasLocationMismatch(
    claimedLocation,
    countryCode,
    locationCountry,
    locationParts.region,
  );
  const identifiedVirtualBrand = virtualBrand(carrier);
  const isValid = localValidity && external?.valid !== false;

  const factors: PhoneTriageResult["factors"] = [
    {
      id: "caller_id_not_identity",
      label: "Caller ID is not proof of identity",
      points: 8,
      triggered: true,
      detail: "Caller ID can be spoofed or reassigned. Verify any claimed organization independently.",
    },
    {
      id: "invalid_number",
      label: "Number failed validity checks",
      points: 30,
      triggered: !isValid,
      detail: "The number failed local or provider validity checks; this does not establish who controls it.",
    },
    {
      id: "voip_number",
      label: "VoIP / virtual line type",
      points: 25,
      triggered: lineType === "voip_virtual",
      detail: "Internet-based numbers can be legitimate, but caller identity is harder to infer from the number alone.",
    },
    {
      id: "virtual_number_brand",
      label: "Virtual-number service match",
      points: 20,
      triggered: Boolean(identifiedVirtualBrand),
      detail: identifiedVirtualBrand
        ? `Provider metadata matched ${identifiedVirtualBrand}; these services can have legitimate uses and are not a fraud verdict.`
        : "No listed consumer virtual-number service matched the returned carrier name.",
    },
    {
      id: "claimed_location_mismatch",
      label: "Number region conflicts with claimed location",
      points: 25,
      triggered: locationMismatch,
      detail: locationMismatch
        ? "The number's country or available regional metadata conflicts with the caller's stated location. Number portability and spoofing limit this signal."
        : claimedLocation
          ? "No clear country or state-level conflict was found in the available number metadata."
          : "No claimed caller location was provided for comparison.",
    },
  ];

  const riskScore = Math.min(
    100,
    factors.filter((factor) => factor.triggered).reduce((total, factor) => total + factor.points, 0),
  );
  const findings = [
    isValid
      ? `Number parses as ${e164} and passes ${external?.valid === true ? "local and provider" : "local"} validity checks.`
      : "The number did not pass all validity checks; treat the result as incomplete.",
    `Line type: ${lineType.replaceAll("_", " ")}${lineTypeSource === "google_libphonenumber" ? " (numbering-plan estimate)" : ""}.`,
    carrier
      ? `Carrier metadata: ${carrier}.`
      : "Carrier data was not returned; no carrier identity has been inferred.",
    locationMismatch
      ? "The supplied caller location conflicts with the available number-region metadata."
      : claimedLocation
        ? "No clear mismatch with the supplied caller location was detected."
        : "Add a claimed caller location to check for a country or state-level mismatch.",
  ];

  if (externalLookupStatus === "not_configured") {
    findings.push("Live carrier and location lookup is not configured; this result uses local numbering-plan analysis only.");
  } else if (externalLookupStatus === "unavailable") {
    findings.push("The live carrier lookup could not be reached; local numbering-plan analysis is shown instead.");
  } else if (externalLookupStatus === "skipped_invalid") {
    findings.push("Live lookup was skipped because the number did not pass local validity checks.");
  }

  const summary = !isValid
    ? "This number could not be confirmed as valid. Do not treat the displayed number metadata as caller identity."
    : lineType === "voip_virtual" || identifiedVirtualBrand || locationMismatch
      ? "This number has one or more signals that warrant independent caller verification; the score is not proof of fraud."
      : "The number parses successfully, but phone-number metadata cannot verify who placed the call.";
  const safetyRecommendation = riskScore >= 45
    ? "Possible virtual or spoofed caller ID. Do not return calls or share verification codes; contact the claimed organization through a number published on its official website."
    : "Treat caller ID as unverified. Do not share passwords or one-time codes; verify unexpected requests using an independently published contact number.";

  return {
    source: "phone",
    analyzedAt: new Date(),
    submittedNumber: input.phoneNumber.trim(),
    e164,
    nationalFormat,
    isValid,
    isPossible,
    countryCode,
    countryName,
    countryCallingCode: `+${callingCode}`,
    lineType,
    lineTypeSource,
    carrier,
    carrierSource,
    locationCity: locationParts.city,
    locationRegion: locationParts.region ?? localCountryCode,
    locationCountry,
    claimedLocation,
    locationMismatch,
    externalLookupStatus,
    externalLookupProvider: apiKey ? "abstract_phone" : null,
    riskScore,
    riskLevel: riskLevel(riskScore),
    summary,
    safetyRecommendation,
    factors,
    findings,
  };
}
