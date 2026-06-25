# Twilio Auth / SMS Troubleshooting - 2026-06-15

## Confirmed

- Railway `voice-relay` production can read `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER`.
- `TWILIO_ACCOUNT_SID` format is `AC` + 32 hex characters.
- `TWILIO_AUTH_TOKEN` currently has 32 characters and no whitespace.
- Direct Twilio REST authentication against the account endpoint returns `401 Unauthorized`, Twilio error `20003 Authenticate`.
- The latest voice relay code supports both:
  - `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`
  - `TWILIO_ACCOUNT_SID` + `TWILIO_API_KEY` + `TWILIO_API_SECRET`
- `Standard` API keys are appropriate for production SMS/Voice REST calls.
- Twilio official docs state `Main`, `Standard`, and `Restricted` keys can be created in Console. Do not claim that selecting `Main` is definitely the cause of API key creation failure.

## Not Confirmed

- The current Twilio Account SID and Auth Token pair is valid for the selected account.
- The Twilio account has no billing, payment, suspension, permission, or Console-side restriction.
- The Console `Bad input, please modify request and try again` cause.

## Inference

- Twilio error `20003` means the credentials are incorrect, expired, deleted, scoped to the wrong account, test credentials against live resources, or otherwise invalid for the requested resource.
- Console API key creation `Bad input` is not documented by Twilio as a normal field-validation error. If simple names and Standard key type still fail, account/billing/permission/Console-side issues are likely.

## User-Side Checks

1. Confirm the Twilio account selector is on the account with the intended `AC...` SID.
2. Check Billing:
   - valid payment method
   - no expired card
   - no unpaid balance
   - account is upgraded if required
3. Try creating a `Standard` API key with a simple friendly name such as `arare`.
4. Try an incognito/private window with extensions disabled.
5. If it still fails, contact Twilio Support with:
   - screenshot of the `Bad input` error
   - Account SID prefix only, not the full secret/token
   - time of attempt

## Do Not Repeat

- Do not keep telling the user the 32-character Auth Token format is the problem when format checks pass.
- Do not assume `Main` key type is the cause. It is too broad for this app, but Twilio docs say it is Console-creatable.
- Do not send real SMS while auth is failing.
