import { noteMarkdownToHtml } from './note-markdown';

describe('noteMarkdownToHtml', () => {
  it('escapes raw HTML', () => {
    const html = noteMarkdownToHtml('<script>alert(1)</script>');
    expect(html.indexOf('<script>')).toBe(-1);
    expect(html.indexOf('&lt;script&gt;')).toBeGreaterThan(-1);
  });

  it('renders headings bold italic code', () => {
    const html = noteMarkdownToHtml('# Title\n\n**bold** and *italic* and `code`');
    expect(html).toContain('<h1 class="note-md-h">Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code class="note-md-code">code</code>');
  });

  it('does not leave a leading blank from default paragraph margins', () => {
    const html = noteMarkdownToHtml('hello');
    expect(html).toBe('<div class="note-md-p">hello</div>');
    expect(html.indexOf('<p')).toBe(-1);
  });

  it('skips leading blank lines so the first visible line is content', () => {
    const html = noteMarkdownToHtml('\n\nhello');
    expect(html).toBe('<div class="note-md-p">hello</div>');
  });

  it('renders lists quotes hr and fenced code', () => {
    const src = '- a\n- b\n\n1. one\n\n> tip\n\n---\n\n```\nx = 1\n```';
    const html = noteMarkdownToHtml(src);
    expect(html).toContain('<ul class="note-md-ul">');
    expect(html).toContain('<ol class="note-md-ol">');
    expect(html).toContain('<blockquote class="note-md-quote">');
    expect(html).toContain('<hr class="note-md-hr"/>');
    expect(html).toContain('<pre class="note-md-pre"><code>x = 1</code></pre>');
  });

  it('only allows http(s) links', () => {
    const ok = noteMarkdownToHtml('[go](https://example.com/a)');
    expect(ok).toContain('href="https://example.com/a"');
    const bad = noteMarkdownToHtml('[x](javascript:alert(1))');
    expect(bad.indexOf('href=')).toBe(-1);
  });

  it('keeps ruby after markdown', () => {
    const html = noteMarkdownToHtml('｜漢字《かんじ》');
    expect(html).toContain('<ruby>');
    expect(html).toContain('<rt>かんじ</rt>');
  });
});
