import { StringUtil } from './core/system/util/string-util';

/**
 * Safe Markdown subset for shared notes.
 * Pipeline: extract code → escapeHtml → MD blocks/inlines → restore code → ruby.
 * No raw HTML, images, or scripts. Links must be http(s).
 */
export function noteMarkdownToHtml(src: string, options?: { ruby?: boolean }): string {
  if (src == null || src === '') return '';
  const withRuby = options?.ruby !== false;
  let text = String(src);

  const slots: string[] = [];
  const stash = (html: string) => {
    const i = slots.length;
    slots.push(html);
    return `\u0000SLOT${i}\u0000`;
  };

  // Fenced code before escape (backticks would become &#x60;).
  text = text.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_m, _lang: string, body: string) => {
    const safe = StringUtil.escapeHtml(body.replace(/\n$/, ''));
    return stash(`<pre class="note-md-pre"><code>${safe}</code></pre>`);
  });

  // Inline code before escape.
  text = text.replace(/`([^`\n]+)`/g, (_m, body: string) => {
    return stash(`<code class="note-md-code">${StringUtil.escapeHtml(body)}</code>`);
  });

  text = StringUtil.escapeHtml(text);

  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  // Skip leading blank lines so plain notes do not look like they start empty.
  while (i < lines.length && lines[i].trim() === '') i += 1;

  while (i < lines.length) {
    const line = lines[i];

    const slotOnly = line.match(/^\u0000SLOT(\d+)\u0000$/);
    if (slotOnly) {
      out.push(slots[+slotOnly[1]]);
      i += 1;
      continue;
    }

    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      out.push('<hr class="note-md-hr"/>');
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level} class="note-md-h">${inlineMd(heading[2], slots)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^&gt;\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^&gt;\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote class="note-md-quote">${inlineMd(quoteLines.join('<br/>'), slots)}</blockquote>`);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inlineMd(lines[i].replace(/^[-*]\s+/, ''), slots)}</li>`);
        i += 1;
      }
      out.push(`<ul class="note-md-ul">${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inlineMd(lines[i].replace(/^\d+\.\s+/, ''), slots)}</li>`);
        i += 1;
      }
      out.push(`<ol class="note-md-ol">${items.join('')}</ol>`);
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length
      && lines[i].trim() !== ''
      && !/^\u0000SLOT\d+\u0000$/.test(lines[i])
      && !/^---+\s*$/.test(lines[i])
      && !/^\*\*\*+\s*$/.test(lines[i])
      && !/^#{1,3}\s+/.test(lines[i])
      && !/^&gt;\s?/.test(lines[i])
      && !/^[-*]\s+/.test(lines[i])
      && !/^\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(`<div class="note-md-p">${inlineMd(para.join('<br/>'), slots)}</div>`);
  }

  let html = out.join('');
  html = html.replace(/\u0000SLOT(\d+)\u0000/g, (_m, n) => slots[+n] || '');
  if (withRuby) html = StringUtil.rubyToHtml(html);
  return html;
}

function inlineMd(s: string, slots: string[]): string {
  let t = s;
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__(.+?)__/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  t = t.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, '<a class="note-md-a" href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  t = t.replace(/\u0000SLOT(\d+)\u0000/g, (_m, n) => slots[+n] || '');
  return t;
}
