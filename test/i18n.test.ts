import { describe, expect, it } from 'vitest';
import { isSimplifiedChineseLocale, resolveUiLanguage } from '../src/shared/i18n.js';
import { localizeRuntimeText, setUiLanguage } from '../src/renderer/i18n.js';

describe('UI language resolution', () => {
  it('matches COS system-language behavior for Simplified and Traditional Chinese locales', () => {
    expect(isSimplifiedChineseLocale('zh-CN')).toBe(true);
    expect(isSimplifiedChineseLocale('zh-Hans')).toBe(true);
    expect(isSimplifiedChineseLocale('zh')).toBe(true);
    expect(isSimplifiedChineseLocale('zh-TW')).toBe(false);
    expect(isSimplifiedChineseLocale('zh-Hant')).toBe(false);
    expect(resolveUiLanguage('system', ['zh-HK'])).toBe('en');
    expect(resolveUiLanguage('system', ['zh-SG'])).toBe('zh-CN');
  });

  it('localizes gateway activity without exposing private route text', () => {
    setUiLanguage('zh-CN', ['zh-CN']);
    expect(localizeRuntimeText('Local Resolve MCP gateway started on 127.0.0.1:54893'))
      .toBe('本机 Resolve MCP 网关已启动：127.0.0.1:54893');
    expect(localizeRuntimeText('request POST mcp/raw → 200 in 50ms (tunnel probe)'))
      .toBe('请求 POST MCP/原始接口 → 200，耗时 50 毫秒（隧道探测）');
    expect(localizeRuntimeText('shutdown connection starting')).toBe('正在断开本机 Resolve 连接。');
    expect(localizeRuntimeText('shutdown connection done')).toBe('本机 Resolve 连接清理完成。');
  });
});
