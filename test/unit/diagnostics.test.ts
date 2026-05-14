import { describe, it, expect } from 'bun:test';
import { summarizeRequestDiagnostics } from '../../src/upstream';

describe('summarizeRequestDiagnostics', () => {
  it('extracts diagnostics from normal request', () => {
    const body = {
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
      max_tokens: 4096,
      tools: [{ type: 'function', function: { name: 'get_weather' } }],
      stream: true,
    };
    const diag = summarizeRequestDiagnostics(body, 'gpt-4', true);
    expect(diag.model).toBe('gpt-4');
    expect(diag.stream).toBe(true);
    expect(diag.messageCount).toBe(2);
    expect(diag.maxTokens).toBe(4096);
    expect(diag.toolCount).toBe(1);
    expect(diag.requestBytes).toBeGreaterThan(0);
  });

  it('handles undefined body', () => {
    const diag = summarizeRequestDiagnostics(undefined, 'model', false);
    expect(diag.messageCount).toBe(0);
    expect(diag.contentTypes).toBe('no body');
    expect(diag.toolCount).toBe(0);
    expect(diag.requestBytes).toBe(0);
  });

  it('handles body without messages', () => {
    const diag = summarizeRequestDiagnostics({ model: 'gpt-4' }, 'gpt-4', false);
    expect(diag.messageCount).toBe(0);
    expect(diag.contentTypes).toBe('no messages');
  });

  it('counts content types', () => {
    const body = {
      messages: [
        { role: 'user', content: 'text msg' },
        { role: 'user', content: [{ type: 'text', text: 'block' }, { type: 'image_url', image_url: { url: 'http://x' } }] },
      ],
    };
    const diag = summarizeRequestDiagnostics(body, 'gpt-4', false);
    expect(diag.contentTypes).toContain('text');
    expect(diag.contentTypes).toContain('image_url');
  });

  it('does not include message content text in output', () => {
    const body = { messages: [{ role: 'user', content: 'secret-sensitive-data' }] };
    const diag = summarizeRequestDiagnostics(body, 'gpt-4', false);
    const json = JSON.stringify(diag);
    expect(json).not.toContain('secret-sensitive-data');
  });

  it('handles null max_tokens', () => {
    const body = { messages: [{ role: 'user', content: 'hi' }] };
    const diag = summarizeRequestDiagnostics(body, 'gpt-4', false);
    expect(diag.maxTokens).toBeNull();
  });
});