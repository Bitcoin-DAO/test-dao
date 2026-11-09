// WebAuthn passkeys with the PRF extension (protocol 1.5).
import { randomBytes } from '@noble/hashes/utils';
import { bytesToHex, sha256Hex } from '../core/util';

export interface PasskeyCreated {
  credId: string; // hex of rawId
  prfSupported: boolean;
  prf?: Uint8Array; // some platforms evaluate the PRF at creation already
}

/** The relying-party id: the configured passkey domain when the page is on it, otherwise this host (development). */
export function rpId(passkeyDomain: string): { id: string; matches: boolean } {
  const host = location.hostname;
  const matches = host === passkeyDomain || host.endsWith('.' + passkeyDomain);
  return { id: matches ? passkeyDomain : host, matches };
}

export const passkeysAvailable = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;

const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const hexToBuf = (h: string) => buf(new Uint8Array(h.match(/../g)!.map(x => parseInt(x, 16))));

export async function createPasskey(opts: { passkeyDomain: string; rpName: string; userName: string; salt?: Uint8Array }): Promise<PasskeyCreated> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { id: rpId(opts.passkeyDomain).id, name: opts.rpName },
      user: { id: buf(randomBytes(16)), name: opts.userName, displayName: opts.userName },
      challenge: buf(randomBytes(32)),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      extensions: { prf: opts.salt ? { eval: { first: buf(opts.salt) } } : {} } as AuthenticationExtensionsClientInputs,
      timeout: 120000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('passkey-cancelled');
  const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
  const first = ext.prf?.results?.first;
  return {
    credId: bytesToHex(new Uint8Array(cred.rawId)),
    prfSupported: !!ext.prf?.enabled || !!first,
    prf: first ? new Uint8Array(first) : undefined,
  };
}

export interface PasskeyAssertion {
  credId: string;
  credTag: string; // sha256(credential id), the dao.keywrap "c" tag
  prf?: Uint8Array;
}

/** Sign in with a passkey and evaluate the PRF with the DAO's salt. Leave credId empty to let the person pick. */
export async function getPrf(opts: { passkeyDomain: string; salt: Uint8Array; credId?: string }): Promise<PasskeyAssertion> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: buf(randomBytes(32)),
      rpId: rpId(opts.passkeyDomain).id,
      userVerification: 'required',
      allowCredentials: opts.credId ? [{ type: 'public-key', id: hexToBuf(opts.credId) }] : [],
      extensions: { prf: { eval: { first: buf(opts.salt) } } } as AuthenticationExtensionsClientInputs,
      timeout: 120000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('passkey-cancelled');
  const raw = new Uint8Array(cred.rawId);
  const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
  const first = ext.prf?.results?.first;
  return { credId: bytesToHex(raw), credTag: sha256Hex(raw), prf: first ? new Uint8Array(first) : undefined };
}

export const credTagOf = (credIdHex: string) => sha256Hex(new Uint8Array(hexToBuf(credIdHex)));
