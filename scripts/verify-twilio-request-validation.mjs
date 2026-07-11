import assert from "node:assert/strict";
import twilio from "twilio";
import {
  buildExternalRequestUrl,
  isValidTwilioRequest
} from "./lib/twilio-request-validation.mjs";

const authToken = "test_auth_token";
const url = "https://arare-ai-voice-relay.onrender.com/api/twilio/voice/realtime";
const params = {
  CallSid: "CA11111111111111111111111111111111",
  From: "+818011112222",
  To: "+194112396480"
};
const signature = twilio.getExpectedTwilioSignature(authToken, url, params);

assert.equal(isValidTwilioRequest({ authToken, signature, url, params }), true);
assert.equal(isValidTwilioRequest({ authToken, signature: "invalid", url, params }), false);
assert.equal(isValidTwilioRequest({ authToken: "", signature, url, params }), false);
assert.equal(
  buildExternalRequestUrl(
    {
      "x-forwarded-host": "arare-ai-voice-relay.onrender.com, internal.example",
      "x-forwarded-proto": "https",
      host: "internal.example"
    },
    "/api/twilio/voice/realtime"
  ),
  url
);

const websocketUrl = "wss://arare-ai-voice-relay.onrender.com/openai-realtime-media";
const websocketSignature = twilio.getExpectedTwilioSignature(authToken, websocketUrl, {});
assert.equal(
  isValidTwilioRequest({ authToken, signature: websocketSignature, url: websocketUrl, params: {} }),
  true
);

console.log("Twilio request validation verification passed.");
