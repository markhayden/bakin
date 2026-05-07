import { track } from "./analytics";

export type ConsentValue = "granted" | "denied";

export interface ConsentState {
  analytics_storage: ConsentValue;
  ad_storage: ConsentValue;
}

export type ConsentSource = "default" | "accept" | "reject" | "restore" | "dismiss";

export const CONSENT_COOKIE_NAME = "bakin_consent";
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 15_552_000;
export const CONSENT_SCHEMA_VERSION = 1;

interface StoredConsent {
  a: "g" | "d";
  d: "g" | "d";
  v: number;
  t: number;
}

const toShort = (value: ConsentValue): "g" | "d" => (value === "granted" ? "g" : "d");
const fromShort = (value: "g" | "d"): ConsentValue => (value === "g" ? "granted" : "denied");

const isStoredConsent = (raw: unknown): raw is StoredConsent => {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  return (
    (obj.a === "g" || obj.a === "d") &&
    (obj.d === "g" || obj.d === "d") &&
    typeof obj.v === "number" &&
    typeof obj.t === "number"
  );
};

export const readConsent = (): ConsentState | null => {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${CONSENT_COOKIE_NAME}=`));
  if (!match) return null;

  const rawValue = match.slice(CONSENT_COOKIE_NAME.length + 1);
  try {
    const decoded = decodeURIComponent(rawValue);
    const parsed: unknown = JSON.parse(decoded);
    if (!isStoredConsent(parsed)) return null;
    if (parsed.v !== CONSENT_SCHEMA_VERSION) return null;
    return {
      analytics_storage: fromShort(parsed.a),
      ad_storage: fromShort(parsed.d),
    };
  } catch {
    return null;
  }
};

export const writeConsent = (state: ConsentState): void => {
  if (typeof document === "undefined") return;
  const payload: StoredConsent = {
    a: toShort(state.analytics_storage),
    d: toShort(state.ad_storage),
    v: CONSENT_SCHEMA_VERSION,
    t: Math.floor(Date.now() / 1000),
  };
  const value = encodeURIComponent(JSON.stringify(payload));
  const attrs = [
    `${CONSENT_COOKIE_NAME}=${value}`,
    `Max-Age=${CONSENT_COOKIE_MAX_AGE_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
  ];
  if (window.location.protocol === "https:") {
    attrs.push("Secure");
  }
  document.cookie = attrs.join("; ");
};

export const applyConsent = (state: ConsentState, source: ConsentSource): void => {
  if (typeof window === "undefined") return;
  if (source === "accept" || source === "reject" || source === "dismiss") {
    writeConsent(state);
  }
  if (typeof window.gtag === "function") {
    window.gtag("consent", "update", {
      analytics_storage: state.analytics_storage,
      ad_storage: state.ad_storage,
      ad_user_data: state.ad_storage,
      ad_personalization: state.ad_storage,
    });
  }
  track({
    event: "consent_update",
    analytics_storage: state.analytics_storage,
    ad_storage: state.ad_storage,
    source,
  });
};
