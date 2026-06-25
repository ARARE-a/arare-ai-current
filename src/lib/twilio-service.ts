const JA_TTS_PROVIDER = "Amazon";
const JA_RELAY_VOICE = "Takumi-Neural";
const JA_SAY_VOICE = "Polly.Takumi-Neural";
const JA_SPEECH_RATE = "120%";
const RELAY_SPEECH_TIMEOUT_MS = "600";

const RELAY_HINTS = [
  "\u4e88\u7d04",
  "\u7a7a\u304d\u78ba\u8a8d",
  "\u4eca\u65e5",
  "\u660e\u65e5",
  "\u4eca\u304b\u3089",
  "\u6700\u77ed",
  "60\u5206",
  "90\u5206",
  "120\u5206",
  "\u30d5\u30ea\u30fc",
  "\u6307\u540d",
  "\u672c\u6307\u540d",
  "\u521d\u3081\u3066",
  "\u96fb\u8a71\u756a\u53f7",
  "\u6599\u91d1",
  "\u5834\u6240",
  "\u30b3\u30fc\u30b9",
  "\u30bb\u30e9\u30d4\u30b9\u30c8",
  "\u304a\u3059\u3059\u3081",
  "\u5909\u66f4",
  "\u30ad\u30e3\u30f3\u30bb\u30eb",
  "\u805e\u3053\u3048\u307e\u3059\u304b"
].join(",");

export function twiml(body: string) {
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" }
  });
}

export function sayJa(text: string) {
  return `<Say language="ja-JP" voice="${JA_SAY_VOICE}"><prosody rate="${JA_SPEECH_RATE}">${escapeXml(text)}</prosody></Say>`;
}

export function conversationRelayTwiml(input: {
  websocketUrl: string;
  connectActionUrl: string;
  callReference?: string;
  parameters?: Record<string, string | null | undefined>;
}) {
  const parameters = {
    callReference: input.callReference,
    product: "ARARE AI",
    mode: "reservation-reception",
    ...input.parameters
  };
  const parameterXml = Object.entries(parameters)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([name, value]) => `<Parameter name="${escapeXml(name)}" value="${escapeXml(value)}"/>`)
    .join("\n      ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect action="${escapeXml(input.connectActionUrl)}" method="POST">
    <ConversationRelay
      url="${escapeXml(input.websocketUrl)}"
      welcomeGreeting="\u304a\u96fb\u8a71\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3059\u3002\u81ea\u52d5\u4e88\u7d04\u53d7\u4ed8\u3067\u3059\u3002\u3054\u4e88\u7d04\u3067\u3057\u305f\u3089\u3001\u3054\u5e0c\u671b\u306e\u65e5\u6642\u3068\u30b3\u30fc\u30b9\u3092\u304a\u805e\u304b\u305b\u304f\u3060\u3055\u3044\u3002"
      welcomeGreetingInterruptible="any"
      language="ja-JP"
      transcriptionLanguage="ja-JP"
      ttsLanguage="ja-JP"
      ttsProvider="${JA_TTS_PROVIDER}"
      voice="${JA_RELAY_VOICE}"
      transcriptionProvider="Google"
      speechModel="long"
      interruptible="any"
      interruptSensitivity="high"
      speechTimeout="${RELAY_SPEECH_TIMEOUT_MS}"
      dtmfDetection="true"
      reportInputDuringAgentSpeech="speech"
      events="speaker-events tokens-played"
      debug="debugging"
      hints="${RELAY_HINTS}"
    >
      ${parameterXml}
    </ConversationRelay>
  </Connect>
</Response>`;
}

export function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
