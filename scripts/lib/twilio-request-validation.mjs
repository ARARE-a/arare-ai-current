import twilio from "twilio";

export function buildExternalRequestUrl(headers, requestUrl) {
  const forwardedHost = firstHeaderValue(headers["x-forwarded-host"]);
  const host = forwardedHost || firstHeaderValue(headers.host);
  const proto = firstHeaderValue(headers["x-forwarded-proto"]) || "https";
  if (!host) return null;
  return `${proto}://${host}${requestUrl || "/"}`;
}

export function isValidTwilioRequest({ authToken, signature, url, params = {} }) {
  if (!authToken || !signature || !url) return false;
  try {
    return twilio.validateRequest(authToken, signature, url, params);
  } catch {
    return false;
  }
}

function firstHeaderValue(value) {
  const text = Array.isArray(value) ? value[0] : String(value ?? "");
  return text.split(",")[0].trim();
}
