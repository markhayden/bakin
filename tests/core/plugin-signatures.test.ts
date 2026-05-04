import { describe, expect, it } from 'bun:test'
import { generateKeyPairSync, sign as signBytes } from 'crypto'
import {
  PluginSignatureError,
  canonicalizePluginManifestForSignature,
  pluginSignatureFingerprint,
  verifyPluginManifestSignature,
} from '../../packages/core/src/plugins/signatures'

const baseManifest = {
  id: 'signed-plugin',
  name: 'Signed Plugin',
  version: '1.0.0',
  bakin: '>=1.0.0',
  description: 'A signed test plugin',
  entry: { server: 'index.ts' },
  permissions: [],
}

function createSigningFixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  return { privateKey, publicKeyBase64 }
}

function signedManifest(
  manifest: Record<string, unknown> = baseManifest,
  fixture = createSigningFixture(),
) {
  const body = canonicalizePluginManifestForSignature(manifest)
  const signature = signBytes(null, Buffer.from(body, 'utf-8'), fixture.privateKey).toString('base64')
  return {
    manifest: {
      ...manifest,
      signature: {
        algorithm: 'ed25519',
        signer: 'unit-test',
        publicKey: fixture.publicKeyBase64,
        signature,
      },
    },
    publicKeyBase64: fixture.publicKeyBase64,
  }
}

describe('plugin signature verification', () => {
  it('allows unsigned manifests when requireSignatures is false', () => {
    const result = verifyPluginManifestSignature(baseManifest, {
      requireSignatures: false,
      trustedSigners: [],
    })

    expect(result.required).toBe(false)
    expect(result.verified).toBe(false)
  })

  it('rejects unsigned manifests when requireSignatures is true', () => {
    expect(() => verifyPluginManifestSignature(baseManifest, {
      requireSignatures: true,
      trustedSigners: [],
    })).toThrow(PluginSignatureError)
  })

  it('accepts signed manifests when the public-key fingerprint is trusted', () => {
    const signed = signedManifest()
    const fingerprint = pluginSignatureFingerprint(signed.publicKeyBase64)
    const result = verifyPluginManifestSignature(signed.manifest, {
      requireSignatures: true,
      trustedSigners: [fingerprint],
    })

    expect(result.required).toBe(true)
    expect(result.verified).toBe(true)
    expect(result.fingerprint).toBe(fingerprint)
  })

  it('rejects signed manifests when the signer key is not trusted', () => {
    const signed = signedManifest()

    expect(() => verifyPluginManifestSignature(signed.manifest, {
      requireSignatures: true,
      trustedSigners: ['sha256:0000000000000000000000000000000000000000000000000000000000000000'],
    })).toThrow(/not trusted/)
  })

  it('rejects signed manifests when the signed body is changed', () => {
    const signed = signedManifest()

    expect(() => verifyPluginManifestSignature({
      ...signed.manifest,
      description: 'tampered after signing',
    }, {
      requireSignatures: true,
      trustedSigners: [pluginSignatureFingerprint(signed.publicKeyBase64)],
    })).toThrow(/signature is invalid/)
  })
})
