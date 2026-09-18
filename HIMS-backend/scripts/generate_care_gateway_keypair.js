import crypto from 'crypto';

// One-off helper — NOT part of the idempotent migration runner. Run manually:
//   node scripts/generate_care_gateway_keypair.js
// Generates our gateway's RSA signing identity (used to sign Gateway_Bearer
// JWTs for outbound CARE calls, and to publish our public JWKS at
// GET /openid-configuration for CARE to verify them). Prints values to paste
// into .env by hand rather than writing .env directly, since .env already
// holds other live secrets this script has no business touching.

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const kid = `care-gw-${Date.now().toString(36)}`;
const publicJwk = crypto.createPublicKey(publicKey).export({ format: 'jwk' });

console.log('Paste the following into HIMS-backend/.env:\n');
console.log(`CARE_GATEWAY_KEY_ID=${kid}`);
console.log(`CARE_GATEWAY_PRIVATE_KEY_PEM="${privateKey.replace(/\n/g, '\\n')}"`);
console.log('\nPublic JWK that will be served at GET /openid-configuration (for reference only, not stored in .env):');
console.log(JSON.stringify({ ...publicJwk, use: 'sig', alg: 'RS256', kid }, null, 2));
console.log('\nDo NOT commit the private key. Regenerating replaces our gateway identity — CARE-side registration references the OLD public key until re-synced with them.');
