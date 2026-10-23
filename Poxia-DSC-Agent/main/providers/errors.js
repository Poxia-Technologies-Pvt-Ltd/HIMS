// Turns the many ways a token or its driver can fail into one short code and a
// plain message for the doctor. Technical detail stays in the audit log.
class SignError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const CKR = [
  [/CKR_PIN_INCORRECT/, 'PIN_INCORRECT', 'The PIN is incorrect.'],
  [/CKR_PIN_LOCKED/, 'PIN_LOCKED', 'The token is locked after too many wrong PINs. Contact your DSC provider to unlock it.'],
  [/CKR_PIN_EXPIRED/, 'PIN_EXPIRED', 'The token PIN has expired. Change it with the token\'s own software.'],
  [/CKR_PIN_LEN_RANGE|CKR_ARGUMENTS_BAD/, 'PIN_INCORRECT', 'The PIN is not the right length.'],
  [/CKR_TOKEN_NOT_PRESENT|CKR_DEVICE_REMOVED|CKR_SLOT_ID_INVALID|CKR_SESSION_HANDLE_INVALID|CKR_DEVICE_ERROR/, 'TOKEN_REMOVED', 'The DSC token was removed or stopped responding. Put it back in and try again.'],
  [/CKR_TOKEN_NOT_RECOGNIZED/, 'TOKEN_UNRECOGNISED', 'The token is not recognised. Install its driver and try again.'],
  [/CKR_MECHANISM_INVALID/, 'MECHANISM', 'This token does not support the required signing method.'],
  [/CKR_KEY_FUNCTION_NOT_PERMITTED|CKR_USER_NOT_LOGGED_IN/, 'NOT_LOGGED_IN', 'The token needs its PIN first.'],
];

/** Maps a PKCS#11 / driver error to a SignError. */
function fromPkcs11(e) {
  if (e instanceof SignError) return e;
  const text = `${e?.message || ''} ${e?.code || ''}`;
  for (const [re, code, message] of CKR) if (re.test(text)) return new SignError(code, message);
  return new SignError('TOKEN_ERROR', 'The token could not complete the request.');
}

module.exports = { SignError, fromPkcs11 };
