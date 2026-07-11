import assert from "node:assert/strict";
import {
  addVoiceUsage,
  buildVoiceCostSummary,
  createVoiceUsageAccumulator
} from "./lib/voice-usage-meter.mjs";

const accumulator = createVoiceUsageAccumulator();
addVoiceUsage(accumulator, "realtime_media", {
  input_tokens: 150,
  output_tokens: 100,
  total_tokens: 250,
  input_token_details: {
    text_tokens: 100,
    audio_tokens: 50,
    cached_tokens: 20,
    cached_tokens_details: { text_tokens: 20, audio_tokens: 0 }
  },
  output_token_details: { text_tokens: 10, audio_tokens: 90 }
});
addVoiceUsage(accumulator, "transcription", {
  input_tokens: 40,
  output_tokens: 10,
  total_tokens: 50,
  input_token_details: { text_tokens: 0, audio_tokens: 40 },
  output_token_details: { text_tokens: 10, audio_tokens: 0 }
});

const pricing = {
  realtimeTextInputUsdPerMToken: 4,
  realtimeCachedInputUsdPerMToken: 0.4,
  realtimeAudioInputUsdPerMToken: 32,
  realtimeTextOutputUsdPerMToken: 24,
  realtimeAudioOutputUsdPerMToken: 64,
  transcriptionTextInputUsdPerMToken: 2.5,
  transcriptionAudioInputUsdPerMToken: 2.5,
  transcriptionTextOutputUsdPerMToken: 10,
  twilioInboundVoiceUsdPerMinute: 0.01,
  twilioMediaStreamsUsdPerMinute: 0.0044,
  twilioConversationRelayUsdPerMinute: 0.07,
  usdToJpy: 150,
  pricingCheckedAt: "2026-07-11"
};

const summary = buildVoiceCostSummary({
  accumulator,
  durationSeconds: 120,
  provider: "openai_realtime_media",
  pricing
});

assert.equal(summary.durationSeconds, 120);
assert.equal(summary.usage.realtime.inputTextTokens, 80);
assert.equal(summary.usage.realtime.inputCachedTokens, 20);
assert.equal(summary.usage.realtime.inputAudioTokens, 50);
assert.equal(summary.usage.transcription.inputAudioTokens, 40);
assert.equal(summary.estimatedCost.twilioUsdMicros, 28_800);
assert.ok(summary.estimatedCost.realtimeUsdMicros > 0);
assert.ok(summary.estimatedCost.transcriptionUsdMicros > 0);
assert.ok(summary.estimatedCost.totalJpy > 0);
assert.equal(summary.estimatedCost.billingAmountConfirmed, false);

const agentSummary = buildVoiceCostSummary({
  accumulator,
  durationSeconds: 120,
  provider: "openai_realtime_agent",
  pricing
});
assert.equal(agentSummary.pricing.twilioFeatureUsdPerMinute, pricing.twilioMediaStreamsUsdPerMinute);
assert.equal(agentSummary.estimatedCost.twilioUsdMicros, 28_800);

const cachedWithoutDetails = createVoiceUsageAccumulator();
addVoiceUsage(cachedWithoutDetails, "text_reasoning", {
  input_tokens: 100,
  output_tokens: 0,
  total_tokens: 100,
  input_token_details: { text_tokens: 100, cached_tokens: 20 }
});
const cachedSummary = buildVoiceCostSummary({
  accumulator: cachedWithoutDetails,
  durationSeconds: 60,
  provider: "conversation_relay",
  pricing
});
assert.equal(cachedSummary.usage.realtime.inputTextTokens, 80);
assert.equal(cachedSummary.usage.realtime.inputCachedTokens, 20);
assert.equal(cachedSummary.usage.realtime.inputTextTokens + cachedSummary.usage.realtime.inputCachedTokens, 100);

console.log("Voice usage meter verification passed.");
