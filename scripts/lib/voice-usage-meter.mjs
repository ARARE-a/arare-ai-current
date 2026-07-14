const TOKEN_SCALE = 1_000_000;
const USD_MICRO_SCALE = 1_000_000;

export function createVoiceUsageAccumulator() {
  return { sources: {} };
}

export function addVoiceUsage(accumulator, source, usage) {
  if (!accumulator?.sources || !source || !usage) return;
  const normalized = normalizeUsage(usage);
  const current = accumulator.sources[source] ?? emptyUsage();
  for (const key of Object.keys(current)) current[key] += normalized[key];
  accumulator.sources[source] = current;
}

export function buildVoiceCostSummary({ accumulator, durationSeconds, provider, pricing }) {
  const sources = accumulator?.sources ?? {};
  const realtime = sumUsage(
    Object.entries(sources)
      .filter(([source]) => source !== "transcription")
      .map(([, usage]) => usage)
  );
  const transcription = sumUsage(sources.transcription ? [sources.transcription] : []);

  const realtimeUsdMicros = tokenCostUsdMicros(realtime, {
    textInput: pricing.realtimeTextInputUsdPerMToken,
    cachedInput: pricing.realtimeCachedInputUsdPerMToken,
    audioInput: pricing.realtimeAudioInputUsdPerMToken,
    textOutput: pricing.realtimeTextOutputUsdPerMToken,
    audioOutput: pricing.realtimeAudioOutputUsdPerMToken
  });
  const transcriptionUsdMicros = tokenCostUsdMicros(transcription, {
    textInput: pricing.transcriptionTextInputUsdPerMToken,
    cachedInput: 0,
    audioInput: pricing.transcriptionAudioInputUsdPerMToken,
    textOutput: pricing.transcriptionTextOutputUsdPerMToken,
    audioOutput: 0
  });
  const seconds = Math.max(0, Math.round(Number(durationSeconds) || 0));
  const minutes = seconds / 60;
  const twilioFeatureRate =
    ["openai_realtime_media", "openai_realtime_agent"].includes(provider)
      ? pricing.twilioMediaStreamsUsdPerMinute
      : pricing.twilioConversationRelayUsdPerMinute;
  const twilioUsdMicros = Math.round(
    minutes * (pricing.twilioInboundVoiceUsdPerMinute + twilioFeatureRate) * USD_MICRO_SCALE
  );
  const totalUsdMicros = realtimeUsdMicros + transcriptionUsdMicros + twilioUsdMicros;
  const usdToJpy = Math.max(0, Number(pricing.usdToJpy) || 0);

  return {
    schemaVersion: 1,
    provider,
    durationSeconds: seconds,
    usage: {
      sources,
      realtime,
      transcription
    },
    pricing: {
      currency: "USD",
      realtimeTextInputUsdPerMToken: pricing.realtimeTextInputUsdPerMToken,
      realtimeCachedInputUsdPerMToken: pricing.realtimeCachedInputUsdPerMToken,
      realtimeAudioInputUsdPerMToken: pricing.realtimeAudioInputUsdPerMToken,
      realtimeTextOutputUsdPerMToken: pricing.realtimeTextOutputUsdPerMToken,
      realtimeAudioOutputUsdPerMToken: pricing.realtimeAudioOutputUsdPerMToken,
      transcriptionTextInputUsdPerMToken: pricing.transcriptionTextInputUsdPerMToken,
      transcriptionAudioInputUsdPerMToken: pricing.transcriptionAudioInputUsdPerMToken,
      transcriptionTextOutputUsdPerMToken: pricing.transcriptionTextOutputUsdPerMToken,
      twilioInboundVoiceUsdPerMinute: pricing.twilioInboundVoiceUsdPerMinute,
      twilioFeatureUsdPerMinute: twilioFeatureRate,
      usdToJpy,
      realtimeModelForPricing: pricing.realtimeModelForPricing ?? null,
      pricingCheckedAt: pricing.pricingCheckedAt
    },
    estimatedCost: {
      realtimeUsdMicros,
      transcriptionUsdMicros,
      twilioUsdMicros,
      totalUsdMicros,
      totalUsd: totalUsdMicros / USD_MICRO_SCALE,
      totalJpy: Math.ceil((totalUsdMicros / USD_MICRO_SCALE) * usdToJpy),
      billingAmountConfirmed: false
    }
  };
}

function normalizeUsage(usage) {
  const input = usage.input_token_details ?? {};
  const output = usage.output_token_details ?? {};
  const cached = input.cached_tokens_details ?? {};
  const inputTokens = nonNegativeInteger(usage.input_tokens);
  const outputTokens = nonNegativeInteger(usage.output_tokens);
  const inputTextTokens = nonNegativeInteger(input.text_tokens);
  const inputAudioTokens = nonNegativeInteger(input.audio_tokens);
  let cachedTextTokens = Math.min(inputTextTokens, nonNegativeInteger(cached.text_tokens));
  let cachedAudioTokens = Math.min(inputAudioTokens, nonNegativeInteger(cached.audio_tokens));
  const cachedTokens = Math.min(inputTokens, nonNegativeInteger(input.cached_tokens));
  let remainingCachedTokens = Math.max(0, cachedTokens - cachedTextTokens - cachedAudioTokens);
  const additionalCachedText = Math.min(Math.max(0, inputTextTokens - cachedTextTokens), remainingCachedTokens);
  cachedTextTokens += additionalCachedText;
  remainingCachedTokens -= additionalCachedText;
  const additionalCachedAudio = Math.min(Math.max(0, inputAudioTokens - cachedAudioTokens), remainingCachedTokens);
  cachedAudioTokens += additionalCachedAudio;
  remainingCachedTokens -= additionalCachedAudio;
  const categorizedInput = inputTextTokens + inputAudioTokens;
  const uncategorizedCachedTokens = Math.min(Math.max(0, inputTokens - categorizedInput), remainingCachedTokens);
  const uncategorizedInputTokens = Math.max(0, inputTokens - categorizedInput - uncategorizedCachedTokens);
  const outputTextTokens = nonNegativeInteger(output.text_tokens);
  const outputAudioTokens = nonNegativeInteger(output.audio_tokens);
  const categorizedOutput = outputTextTokens + outputAudioTokens;

  return {
    inputTextTokens: Math.max(0, inputTextTokens - cachedTextTokens),
    inputAudioTokens: Math.max(0, inputAudioTokens - cachedAudioTokens),
    inputCachedTokens: cachedTextTokens + cachedAudioTokens + uncategorizedCachedTokens,
    inputOtherTokens: uncategorizedInputTokens,
    outputTextTokens,
    outputAudioTokens,
    outputOtherTokens: Math.max(0, outputTokens - categorizedOutput),
    totalTokens: nonNegativeInteger(usage.total_tokens)
  };
}

function tokenCostUsdMicros(usage, rates) {
  const usd =
    ((usage.inputTextTokens + usage.inputOtherTokens) * rates.textInput +
      usage.inputAudioTokens * rates.audioInput +
      usage.inputCachedTokens * rates.cachedInput +
      (usage.outputTextTokens + usage.outputOtherTokens) * rates.textOutput +
      usage.outputAudioTokens * rates.audioOutput) /
    TOKEN_SCALE;
  return Math.round(usd * USD_MICRO_SCALE);
}

function sumUsage(items) {
  const result = emptyUsage();
  for (const item of items) {
    for (const key of Object.keys(result)) result[key] += nonNegativeInteger(item?.[key]);
  }
  return result;
}

function emptyUsage() {
  return {
    inputTextTokens: 0,
    inputAudioTokens: 0,
    inputCachedTokens: 0,
    inputOtherTokens: 0,
    outputTextTokens: 0,
    outputAudioTokens: 0,
    outputOtherTokens: 0,
    totalTokens: 0
  };
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}
