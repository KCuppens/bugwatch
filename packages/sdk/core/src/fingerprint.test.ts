import { describe, it, expect } from 'vitest'
import { generateFingerprint, fingerprintFromException } from './fingerprint'

describe('generateFingerprint', () => {
  it('generates consistent fingerprint for same error', () => {
    const fp1 = generateFingerprint('TypeError', 'Cannot read property x of undefined')
    const fp2 = generateFingerprint('TypeError', 'Cannot read property x of undefined')
    expect(fp1).toBe(fp2)
  })

  it('generates different fingerprints for different error types', () => {
    const fp1 = generateFingerprint('TypeError', 'Some error')
    const fp2 = generateFingerprint('ReferenceError', 'Some error')
    expect(fp1).not.toBe(fp2)
  })

  it('normalizes dynamic values in messages', () => {
    const fp1 = generateFingerprint('Error', 'User 123 not found')
    const fp2 = generateFingerprint('Error', 'User 456 not found')
    expect(fp1).toBe(fp2)
  })

  it('normalizes UUIDs in messages', () => {
    const fp1 = generateFingerprint('Error', 'Object a1b2c3d4-e5f6-7890-abcd-ef1234567890 not found')
    const fp2 = generateFingerprint('Error', 'Object 12345678-1234-5678-1234-567812345678 not found')
    expect(fp1).toBe(fp2)
  })

  it('includes stack trace in fingerprint when provided', () => {
    const stacktrace = [
      { filename: 'app.js', function: 'handleClick', lineno: 42, colno: 10, in_app: true }
    ]
    const fp1 = generateFingerprint('Error', 'Test error', stacktrace)
    const fp2 = generateFingerprint('Error', 'Test error')
    expect(fp1).not.toBe(fp2)
  })
})

describe('fingerprintFromException', () => {
  it('generates fingerprint from exception info', () => {
    const exception = {
      type: 'TypeError',
      value: 'Cannot read property of null',
      stacktrace: [
        { filename: 'index.js', function: 'main', lineno: 1, colno: 1, in_app: true }
      ]
    }
    const fp = fingerprintFromException(exception)
    expect(fp).toBeDefined()
    expect(typeof fp).toBe('string')
    expect(fp.length).toBe(8) // hex string
  })
})
