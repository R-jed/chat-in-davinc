import { describe, expect, it } from 'vitest';
import { redact } from '../src/main/log.js';

describe('log redaction', () => {
  it('does not retain an OpenAI-shaped secret', () => {
    expect(redact('key=sk-abcdefghijklmnopqrstuvwxyz123456')).toBe('key=sk-***');
    expect(redact('key=sk-abcd-***********wxyz')).toBe('key=sk-***');
  });
});
