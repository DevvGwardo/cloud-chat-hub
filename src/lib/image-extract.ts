import type { Conversation, Message } from '@/lib/db';
import { getLocalImageTarget, LOCAL_IMAGE_TOKEN_RE } from '@/lib/local-images';

export interface ImageItem {
  url: string;
  srcUrl: string;
  conversationId: string;
  conversationTitle: string;
  timestamp: string;
  messageId: string;
}

// Matches markdown image syntax: ![alt](url)
const MARKDOWN_IMAGE_REGEX = /!\[[^\]]*\]\(([^)]+)\)/g;
// Matches standalone image URLs with common extensions (http, https)
const STANDALONE_IMAGE_URL_REGEX = /(?<!\()https?:\/\/[^\s<>"]+\.(?:png|jpg|jpeg|gif|webp|svg|avif|jfif)(?:\?[^\s<>"]*)?/gi;
// Matches cloudchat-asset:// URLs (local images stored by hermes)
const CLOUDCHAT_ASSET_URL_REGEX = /(?<!\()cloudchat-asset:\/\/[^\s<>"]+/gi;
// Matches data URIs for images
const DATA_URI_REGEX = /(data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+)/g;
// Matches local image paths wrapped in inline code spans
const INLINE_CODE_LOCAL_IMAGE_REGEX = /`((?:MEDIA:|:)?(?:~\/\S+|\/(?:Users|home|tmp|var|opt|etc|private)\/\S+?)\.(?:png|jpe?g|gif|webp|svg|avif|bmp))`/gi;

function getRenderableImage(url: string): { originalUrl: string; srcUrl: string } | null {
  const trimmed = url.trim().replace(/^<(.+)>$/, '$1').replace(/^`(.+)`$/, '$1');
  if (!trimmed) return null;

  const localTarget = getLocalImageTarget(trimmed);
  if (localTarget) {
    return {
      originalUrl: trimmed,
      srcUrl: localTarget.srcUrl,
    };
  }

  if (/^(?:https?:\/\/|data:image\/)/i.test(trimmed)) {
    return {
      originalUrl: trimmed,
      srcUrl: trimmed,
    };
  }

  return null;
}

function getToolResultText(result: unknown): string | null {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (typeof r.output === 'string' && r.output.trim()) return r.output;
  if (typeof r.message === 'string' && r.message.trim()) return r.message;
  if (Array.isArray(r.content)) {
    const textParts = r.content
      .filter((c) => typeof c === 'object' && c && (c as Record<string, unknown>).type === 'text')
      .map((c) => ((c as Record<string, unknown>).text as string) || '')
      .filter(Boolean);
    if (textParts.length > 0) return textParts.join('\n');
  }
  if (typeof r.result === 'string' && r.result.trim()) return r.result;
  return null;
}

function collectToolResultTexts(msg: Message): string[] {
  const texts: string[] = [];

  const parts = Array.isArray(msg.parts) ? msg.parts : [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    if (p.type !== 'tool-invocation') continue;
    const invocation = p.toolInvocation as Record<string, unknown> | undefined;
    if (!invocation) continue;
    const text = getToolResultText(invocation.result);
    if (text) texts.push(text);
  }

  const invocations = Array.isArray(msg.toolInvocations) ? msg.toolInvocations : [];
  for (const invocation of invocations) {
    if (!invocation || typeof invocation !== 'object') continue;
    const text = getToolResultText((invocation as Record<string, unknown>).result);
    if (text) texts.push(text);
  }

  return texts;
}

/**
 * Extract every renderable image URL from a conversation's messages — message
 * bodies, tool results, markdown, data URIs, and local asset paths. Deduped by
 * original URL.
 */
export function extractImageUrls(messages: Message[], conv: Conversation): ImageItem[] {
  const images: ImageItem[] = [];
  const seen = new Set<string>();

  const addUrl = (url: string, msg: Message) => {
    const renderable = getRenderableImage(url);
    if (!renderable) return;
    if (seen.has(renderable.originalUrl)) return;
    seen.add(renderable.originalUrl);
    images.push({
      url: renderable.originalUrl,
      srcUrl: renderable.srcUrl,
      conversationId: conv.id,
      conversationTitle: conv.title,
      timestamp: msg.timestamp,
      messageId: msg.id,
    });
  };

  const scanBlob = (text: string, msg: Message) => {
    // Extract from markdown ![alt](url)
    for (const match of text.matchAll(MARKDOWN_IMAGE_REGEX)) {
      const url = match[1]?.trim();
      if (url) addUrl(url, msg);
    }

    // Extract standalone image URLs not already inside markdown syntax
    for (const match of text.matchAll(STANDALONE_IMAGE_URL_REGEX)) {
      addUrl(match[0], msg);
    }

    // Extract cloudchat-asset URLs (local images stored by hermes)
    for (const match of text.matchAll(CLOUDCHAT_ASSET_URL_REGEX)) {
      addUrl(match[0], msg);
    }

    // Extract bare local image paths in plaintext tool output
    const localImageRegex = new RegExp(LOCAL_IMAGE_TOKEN_RE);
    for (const match of text.matchAll(localImageRegex)) {
      const path = match[2]?.trim();
      if (path) addUrl(path, msg);
    }

    // Extract inline-code local image paths rendered by the transcript
    for (const match of text.matchAll(INLINE_CODE_LOCAL_IMAGE_REGEX)) {
      const path = match[1]?.trim();
      if (path) addUrl(path, msg);
    }

    // Extract data URIs
    for (const match of text.matchAll(DATA_URI_REGEX)) {
      addUrl(match[1], msg);
    }
  };

  for (const msg of messages) {
    if (msg.role !== 'assistant' && msg.role !== 'user') continue;

    if (msg.content) scanBlob(msg.content, msg);

    for (const toolText of collectToolResultTexts(msg)) {
      scanBlob(toolText, msg);
    }
  }

  return images;
}
