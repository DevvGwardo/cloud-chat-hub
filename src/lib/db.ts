import { getApiBaseUrl } from '@/lib/api';
import type { PullRequestRecord } from '@/lib/pull-request';
import { formatConversationJson, formatConversationMarkdown } from '@/lib/conversation-export';

export interface Conversation {
  id: string;
  title: string;
  provider: string;
  model: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  linesAdded?: number;
  linesRemoved?: number;
  parentConversationId?: string;
  forkPointMessageId?: string;
  forkNumber?: number;
  originalCreatedAt?: string;
  archivedAt?: string | null;
  tags?: string[];
  /** Denormalized GitHub repo (owner/name) attached to this thread, used to group threads by project. */
  repoFullName?: string | null;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  tokenCount?: number;
  error?: string;
  parts?: unknown[];
  toolInvocations?: unknown[];
}

export interface ConversationFiles {
  conversationId: string;
  changeset: {
    activeRepo: {
      owner: string;
      name: string;
      defaultBranch: string;
      fullName: string;
      permissions?: {
        pull?: boolean;
        push?: boolean;
        admin?: boolean;
      };
      baseOwner?: string;
      baseName?: string;
      baseFullName?: string;
      localPath?: string | null;
      issue?: {
        number: number;
        title: string;
        body?: string | null;
        url: string;
        state: string;
        labels: string[];
        updatedAt: string;
      } | null;
    } | null;
    isRepoMode: boolean;
    pullRequest?: PullRequestRecord | null;
    changes: Record<string, { path: string; action: 'create' | 'edit' | 'delete'; content: string; originalContent?: string; staged?: boolean }>;
    repoFileTree: string[];
    repoFileCache?: Record<string, string>;
    selectedRepoFilePath?: string | null;
  };
  preview: {
    files: Array<{ id: string; filename: string; content: string; type: string; timestamp: string }>;
    activeFileId: string | null;
    projectType: string;
    isOpen?: boolean;
    activeView?: string;
  };
  repoFileCache?: Record<string, string>;
}

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type BackendMode = 'unknown' | 'server' | 'legacy';

const DB_NAME = 'cloudchat';
const REQUIRED_STORES = ['conversations', 'messages', 'conversationFiles'];

let backendMode: BackendMode = 'unknown';
let migrationPromise: Promise<void> | null = null;

function isFallbackableServerError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof HttpError && [404, 405, 500, 501, 503].includes(error.status));
}

function createStoresIfNeeded(db: IDBDatabase) {
  if (!db.objectStoreNames.contains('conversations')) {
    const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
    convStore.createIndex('updatedAt', 'updatedAt');
  }
  if (!db.objectStoreNames.contains('messages')) {
    const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
    msgStore.createIndex('conversationId', 'conversationId');
    msgStore.createIndex('timestamp', 'timestamp');
  }
  if (!db.objectStoreNames.contains('conversationFiles')) {
    db.createObjectStore('conversationFiles', { keyPath: 'conversationId' });
  }
}

function openLegacyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const probe = indexedDB.open(DB_NAME);
    probe.onsuccess = () => {
      const probeDb = probe.result;
      const needsUpgrade = REQUIRED_STORES.some((storeName) => !probeDb.objectStoreNames.contains(storeName));
      const currentVersion = probeDb.version;
      probeDb.close();

      if (!needsUpgrade) {
        const request = indexedDB.open(DB_NAME, currentVersion);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        return;
      }

      const request = indexedDB.open(DB_NAME, currentVersion + 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        createStoresIfNeeded((event.target as IDBOpenDBRequest).result);
      };
    };

    probe.onerror = () => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        createStoresIfNeeded((event.target as IDBOpenDBRequest).result);
      };
    };
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getLegacyTx(storeName: string, mode: IDBTransactionMode) {
  const db = await openLegacyDb();
  const transaction = db.transaction(storeName, mode);
  const store = transaction.objectStore(storeName);
  const complete = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
  return { store, complete };
}

const legacyDb = {
  conversations: {
    async getAll(options: { includeArchived?: boolean; archivedOnly?: boolean } = {}): Promise<Conversation[]> {
      const { store, complete } = await getLegacyTx('conversations', 'readonly');
      const all = await reqToPromise<Conversation[]>(store.getAll());
      await complete;
      const filtered = options.archivedOnly
        ? all.filter((c) => c.archivedAt)
        : options.includeArchived
          ? all
          : all.filter((c) => !c.archivedAt);
      return filtered.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    },
    async add(conversation: Conversation): Promise<void> {
      const { store, complete } = await getLegacyTx('conversations', 'readwrite');
      store.add(conversation);
      await complete;
    },
    async update(id: string, fields: Partial<Conversation>): Promise<void> {
      const { store, complete } = await getLegacyTx('conversations', 'readwrite');
      const existing = await reqToPromise<Conversation>(store.get(id));
      if (existing) {
        store.put({ ...existing, ...fields });
      }
      await complete;
    },
    async delete(id: string): Promise<void> {
      const { store, complete } = await getLegacyTx('conversations', 'readwrite');
      store.delete(id);
      await complete;
    },
  },
  messages: {
    async getByConversation(conversationId: string): Promise<Message[]> {
      const { store, complete } = await getLegacyTx('messages', 'readonly');
      const index = store.index('conversationId');
      const all = await reqToPromise<Message[]>(index.getAll(conversationId));
      await complete;
      return all.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    },
    async add(message: Message): Promise<void> {
      const { store, complete } = await getLegacyTx('messages', 'readwrite');
      store.add(message);
      await complete;
    },
    async update(id: string, fields: Partial<Message>): Promise<void> {
      const { store, complete } = await getLegacyTx('messages', 'readwrite');
      const existing = await reqToPromise<Message>(store.get(id));
      if (existing) {
        store.put({ ...existing, ...fields });
      }
      await complete;
    },
    async deleteByConversation(conversationId: string): Promise<void> {
      const { store, complete } = await getLegacyTx('messages', 'readwrite');
      const index = store.index('conversationId');
      const keys = await reqToPromise<IDBValidKey[]>(index.getAllKeys(conversationId));
      for (const key of keys) {
        store.delete(key);
      }
      await complete;
    },
  },
  conversationFiles: {
    async get(conversationId: string): Promise<ConversationFiles | undefined> {
      const { store, complete } = await getLegacyTx('conversationFiles', 'readonly');
      const result = await reqToPromise<ConversationFiles | undefined>(store.get(conversationId));
      await complete;
      return result;
    },
    async save(data: ConversationFiles): Promise<void> {
      const { store, complete } = await getLegacyTx('conversationFiles', 'readwrite');
      store.put(data);
      await complete;
    },
    async delete(conversationId: string): Promise<void> {
      const { store, complete } = await getLegacyTx('conversationFiles', 'readwrite');
      store.delete(conversationId);
      await complete;
    },
  },
};

async function requestServer<T>(
  path: string,
  init?: RequestInit,
  options?: { allowNotFound?: boolean; expectJson?: boolean },
): Promise<T | undefined> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 404 && options?.allowNotFound) {
    return undefined;
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const data = await response.json() as { error?: string };
      if (typeof data.error === 'string' && data.error.trim().length > 0) {
        message = data.error;
      }
    } catch {
      const text = await response.text().catch(() => '');
      if (text.trim().length > 0) {
        message = text;
      }
    }

    throw new HttpError(message, response.status);
  }

  if (options?.expectJson === false || response.status === 204) {
    return undefined;
  }

  return response.json() as Promise<T>;
}

const serverDb = {
  conversations: {
    async getAll(options: { includeArchived?: boolean; archivedOnly?: boolean } = {}): Promise<Conversation[]> {
      const params = new URLSearchParams();
      if (options.archivedOnly) {
        params.set('archivedOnly', '1');
      } else if (options.includeArchived) {
        params.set('includeArchived', '1');
      }
      const query = params.toString();
      const path = query ? `/functions/v1/chat-store/conversations?${query}` : '/functions/v1/chat-store/conversations';
      const response = await requestServer<{ conversations: Conversation[] }>(path);
      return response?.conversations ?? [];
    },
    async add(conversation: Conversation): Promise<void> {
      await requestServer('/functions/v1/chat-store/conversations', {
        method: 'POST',
        body: JSON.stringify(conversation),
      }, { expectJson: false });
    },
    async update(id: string, fields: Partial<Conversation>): Promise<void> {
      await requestServer(`/functions/v1/chat-store/conversations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      }, { expectJson: false });
    },
    async delete(id: string): Promise<void> {
      await requestServer(`/functions/v1/chat-store/conversations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }, { expectJson: false });
    },
  },
  messages: {
    async getByConversation(conversationId: string): Promise<Message[]> {
      const response = await requestServer<{ messages: Message[] }>(
        `/functions/v1/chat-store/conversations/${encodeURIComponent(conversationId)}/messages`,
      );
      return response?.messages ?? [];
    },
    async add(message: Message): Promise<void> {
      await requestServer('/functions/v1/chat-store/messages', {
        method: 'POST',
        body: JSON.stringify(message),
      }, { expectJson: false });
    },
    async update(id: string, fields: Partial<Message>): Promise<void> {
      await requestServer(`/functions/v1/chat-store/messages/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      }, { expectJson: false });
    },
    async deleteByConversation(conversationId: string): Promise<void> {
      await requestServer(`/functions/v1/chat-store/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: 'DELETE',
      }, { expectJson: false });
    },
  },
  conversationFiles: {
    async get(conversationId: string): Promise<ConversationFiles | undefined> {
      const response = await requestServer<{ conversationFiles: ConversationFiles | null }>(
        `/functions/v1/chat-store/conversations/${encodeURIComponent(conversationId)}/files`,
        undefined,
        { allowNotFound: true },
      );
      return response?.conversationFiles ?? undefined;
    },
    async save(data: ConversationFiles): Promise<void> {
      await requestServer(`/functions/v1/chat-store/conversations/${encodeURIComponent(data.conversationId)}/files`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }, { expectJson: false });
    },
    async delete(conversationId: string): Promise<void> {
      await requestServer(`/functions/v1/chat-store/conversations/${encodeURIComponent(conversationId)}/files`, {
        method: 'DELETE',
      }, { expectJson: false });
    },
  },
};

async function detectBackendMode(): Promise<Exclude<BackendMode, 'unknown'>> {
  if (backendMode !== 'unknown') {
    return backendMode;
  }

  try {
    const response = await fetch(`${getApiBaseUrl()}/functions/v1/health`);
    backendMode = response.ok ? 'server' : 'legacy';
  } catch {
    backendMode = 'legacy';
  }

  return backendMode;
}

async function ensureServerMigration(): Promise<void> {
  if (migrationPromise) {
    return migrationPromise;
  }

  migrationPromise = (async () => {
    if (typeof indexedDB === 'undefined') {
      return;
    }

    const serverConversations = await serverDb.conversations.getAll({ includeArchived: true });
    if (serverConversations.length > 0) {
      return;
    }

    const legacyConversations = await legacyDb.conversations.getAll({ includeArchived: true });
    if (legacyConversations.length === 0) {
      return;
    }

    for (const conversation of legacyConversations) {
      await serverDb.conversations.add(conversation);
    }

    for (const conversation of legacyConversations) {
      const messages = await legacyDb.messages.getByConversation(conversation.id);
      for (const message of messages) {
        await serverDb.messages.add(message);
      }

      const conversationFiles = await legacyDb.conversationFiles.get(conversation.id);
      if (conversationFiles) {
        await serverDb.conversationFiles.save(conversationFiles);
      }
    }
  })().catch((error) => {
    migrationPromise = null;
    throw error;
  });

  return migrationPromise;
}

async function withBackend<T>(
  serverOperation: () => Promise<T>,
  legacyOperation: () => Promise<T>,
): Promise<T> {
  const backend = await detectBackendMode();
  if (backend === 'legacy') {
    return legacyOperation();
  }

  try {
    await ensureServerMigration();
    return await serverOperation();
  } catch (error) {
    if (!isFallbackableServerError(error)) {
      throw error;
    }

    backendMode = 'legacy';
    return legacyOperation();
  }
}

export const db = {
  conversations: {
    async getAll(options: { includeArchived?: boolean; archivedOnly?: boolean } = {}): Promise<Conversation[]> {
      return withBackend(
        () => serverDb.conversations.getAll(options),
        () => legacyDb.conversations.getAll(options),
      );
    },
    async add(conversation: Conversation): Promise<void> {
      return withBackend(
        () => serverDb.conversations.add(conversation),
        () => legacyDb.conversations.add(conversation),
      );
    },
    async update(id: string, fields: Partial<Conversation>): Promise<void> {
      return withBackend(
        () => serverDb.conversations.update(id, fields),
        () => legacyDb.conversations.update(id, fields),
      );
    },
    async delete(id: string): Promise<void> {
      return withBackend(
        () => serverDb.conversations.delete(id),
        () => legacyDb.conversations.delete(id),
      );
    },
  },
  messages: {
    async getByConversation(conversationId: string): Promise<Message[]> {
      return withBackend(
        () => serverDb.messages.getByConversation(conversationId),
        () => legacyDb.messages.getByConversation(conversationId),
      );
    },
    async add(message: Message): Promise<void> {
      return withBackend(
        () => serverDb.messages.add(message),
        () => legacyDb.messages.add(message),
      );
    },
    async update(id: string, fields: Partial<Message>): Promise<void> {
      return withBackend(
        () => serverDb.messages.update(id, fields),
        () => legacyDb.messages.update(id, fields),
      );
    },
    async deleteByConversation(conversationId: string): Promise<void> {
      return withBackend(
        () => serverDb.messages.deleteByConversation(conversationId),
        () => legacyDb.messages.deleteByConversation(conversationId),
      );
    },
  },
  conversationFiles: {
    async get(conversationId: string): Promise<ConversationFiles | undefined> {
      return withBackend(
        () => serverDb.conversationFiles.get(conversationId),
        () => legacyDb.conversationFiles.get(conversationId),
      );
    },
    async save(data: ConversationFiles): Promise<void> {
      return withBackend(
        () => serverDb.conversationFiles.save(data),
        () => legacyDb.conversationFiles.save(data),
      );
    },
    async delete(conversationId: string): Promise<void> {
      return withBackend(
        () => serverDb.conversationFiles.delete(conversationId),
        () => legacyDb.conversationFiles.delete(conversationId),
      );
    },
  },
};

export async function archiveConversation(id: string): Promise<void> {
  await db.conversations.update(id, { archivedAt: new Date().toISOString() });
}

export async function unarchiveConversation(id: string): Promise<void> {
  await db.conversations.update(id, { archivedAt: null });
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export async function getAllTags(): Promise<string[]> {
  const all = await db.conversations.getAll({ includeArchived: true });
  const set = new Set<string>();
  for (const conv of all) {
    if (!conv.tags) continue;
    for (const tag of conv.tags) {
      const norm = normalizeTag(tag);
      if (norm) set.add(norm);
    }
  }
  return Array.from(set).sort();
}

export async function addTag(conversationId: string, tag: string): Promise<Conversation> {
  const norm = normalizeTag(tag);
  if (!norm) {
    throw new Error('Tag cannot be empty');
  }
  const all = await db.conversations.getAll({ includeArchived: true });
  const conversation = all.find((c) => c.id === conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }
  const existing = (conversation.tags ?? []).map(normalizeTag).filter((t) => t.length > 0);
  if (existing.includes(norm)) {
    return { ...conversation, tags: existing };
  }
  const nextTags = [...existing, norm];
  await db.conversations.update(conversationId, { tags: nextTags });
  return { ...conversation, tags: nextTags };
}

export async function removeTag(conversationId: string, tag: string): Promise<Conversation> {
  const norm = normalizeTag(tag);
  const all = await db.conversations.getAll({ includeArchived: true });
  const conversation = all.find((c) => c.id === conversationId);
  if (!conversation) {
    throw new Error(`Conversation not found: ${conversationId}`);
  }
  const existing = (conversation.tags ?? []).map(normalizeTag).filter((t) => t.length > 0);
  const nextTags = existing.filter((t) => t !== norm);
  await db.conversations.update(conversationId, { tags: nextTags });
  return { ...conversation, tags: nextTags };
}

async function loadConversationForExport(id: string): Promise<{ conversation: Conversation; messages: Message[] }> {
  const conversations = await db.conversations.getAll();
  const conversation = conversations.find((c) => c.id === id);
  if (!conversation) {
    throw new Error(`Conversation not found: ${id}`);
  }
  const messages = await db.messages.getByConversation(id);
  return { conversation, messages };
}

interface ImportPayload {
  conversation: Conversation;
  messages: Message[];
}

async function serverImportConversation(payload: ImportPayload): Promise<Conversation> {
  const response = await requestServer<{ conversation: Conversation }>(
    '/functions/v1/chat-store/import',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  if (!response?.conversation) {
    throw new Error('Import failed: server did not return a conversation');
  }
  return response.conversation;
}

async function legacyImportConversation(payload: ImportPayload): Promise<Conversation> {
  await legacyDb.conversations.add(payload.conversation);
  for (const message of payload.messages) {
    await legacyDb.messages.add(message);
  }
  return payload.conversation;
}

export async function importConversationJson(file: File): Promise<Conversation> {
  const text = await file.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('File is not a CloudChat conversation export');
  }

  const { schemaVersion, conversation: rawConversation, messages: rawMessages } = parsed as {
    schemaVersion?: unknown;
    conversation?: unknown;
    messages?: unknown;
  };

  if (schemaVersion !== 1) {
    throw new Error(`Unsupported schemaVersion: ${String(schemaVersion)}. Expected 1.`);
  }

  if (!rawConversation || typeof rawConversation !== 'object') {
    throw new Error('Missing "conversation" field in import file');
  }

  if (!Array.isArray(rawMessages)) {
    throw new Error('Missing "messages" array in import file');
  }

  const source = rawConversation as Conversation;
  const newId = crypto.randomUUID();
  const now = new Date().toISOString();

  const newConversation: Conversation = {
    ...source,
    id: newId,
    createdAt: now,
    updatedAt: now,
    originalCreatedAt: source.createdAt,
  };

  const newMessages: Message[] = (rawMessages as Message[]).map((message) => ({
    ...message,
    id: crypto.randomUUID(),
    conversationId: newId,
  }));

  const payload: ImportPayload = { conversation: newConversation, messages: newMessages };

  return withBackend(
    () => serverImportConversation(payload),
    () => legacyImportConversation(payload),
  );
}

export async function exportConversationJson(id: string): Promise<Blob> {
  const { conversation, messages } = await loadConversationForExport(id);
  const body = formatConversationJson(conversation, messages);
  return new Blob([body], { type: 'application/json' });
}

export async function exportConversationMarkdown(id: string): Promise<Blob> {
  const { conversation, messages } = await loadConversationForExport(id);
  const body = formatConversationMarkdown(conversation, messages);
  return new Blob([body], { type: 'text/markdown' });
}

// ---------------------------------------------------------------------------
// Conversation search
// ---------------------------------------------------------------------------

export interface SearchResult {
  conversationId: string;
  messageId: string;
  role: string;
  text: string;
  snippet: string;
  timestamp: string;
}

/** Cap on messages scanned from the local IndexedDB message store per search. */
const SEARCH_LEGACY_SCAN_CAP = 5_000;
/** Cap on most-recent conversations pulled from the server per search. */
const SEARCH_SERVER_CONVERSATION_CAP = 25;
/** Cap on messages fetched from the server per search. */
const SEARCH_SERVER_MESSAGE_CAP = 3_000;
/** Characters of context kept on each side of the first match in a snippet. */
const SEARCH_SNIPPET_RADIUS = 45;

/**
 * Pure snippet builder: returns a ~`radius`-char window of `text` around the
 * first case-insensitive occurrence of `query`, with ellipses when truncated.
 * Returns null when there is no match.
 */
export function buildSearchSnippet(text: string, query: string, radius: number = SEARCH_SNIPPET_RADIUS): string | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery || !text) return null;
  const idx = text.toLowerCase().indexOf(normalizedQuery);
  if (idx === -1) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + normalizedQuery.length + radius);
  let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return snippet;
}

/**
 * Pure ranking + projection over candidate messages. Messages whose content
 * does not contain the query (case-insensitive) are dropped; survivors are
 * ranked by earliest match position, then most recent, then limited.
 */
export function buildSearchResults(
  messages: Message[],
  query: string,
  limit = 20,
): SearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery || messages.length === 0) return [];

  const hits: Array<{ message: Message; matchIndex: number }> = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const text = (message.content ?? '').trim();
    if (!text) continue;
    const matchIndex = text.toLowerCase().indexOf(normalizedQuery);
    if (matchIndex === -1) continue;
    hits.push({ message, matchIndex });
  }

  hits.sort((a, b) => {
    if (a.matchIndex !== b.matchIndex) return a.matchIndex - b.matchIndex;
    return new Date(b.message.timestamp).getTime() - new Date(a.message.timestamp).getTime();
  });

  return hits.slice(0, Math.max(1, limit)).map(({ message }) => ({
    conversationId: message.conversationId,
    messageId: message.id,
    role: message.role,
    text: message.content,
    snippet: buildSearchSnippet(message.content, normalizedQuery) ?? message.content.slice(0, 90),
    timestamp: message.timestamp,
  }));
}

/**
 * Scan the local IndexedDB `messages` store with a chunked cursor, yielding to
 * the event loop every batch so a large store doesn't stall the UI thread.
 * Stops early once `max` records have been collected.
 */
async function scanLegacyMessages(max: number): Promise<Message[]> {
  if (typeof indexedDB === 'undefined') return [];
  const { store, complete } = await getLegacyTx('messages', 'readonly');
  const messages: Message[] = [];
  await new Promise<void>((resolve, reject) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || messages.length >= max) {
        resolve();
        return;
      }
      messages.push(cursor.value as Message);
      if (messages.length % 200 === 0) {
        // Yield one macrotask per batch to keep the UI responsive.
        setTimeout(() => cursor.continue(), 0);
      } else {
        cursor.continue();
      }
    };
    request.onerror = () => reject(request.error);
  });
  await complete;
  return messages;
}

/**
 * Search all conversations' messages for `query` and return the best matches,
 * newest-first tie-broken, each with a short snippet around the match.
 *
 * Sources, merged by message id:
 *  - the local IndexedDB message store (chunked scan, capped), and
 *  - when the server backend is active, the most recent conversations' message
 *    lists (capped) so server-only messages are found too.
 */
export async function searchConversations(query: string, limit = 20): Promise<SearchResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  const [legacyMessages, backend] = await Promise.all([
    scanLegacyMessages(SEARCH_LEGACY_SCAN_CAP).catch(() => [] as Message[]),
    detectBackendMode().catch(() => 'legacy' as BackendMode),
  ]);

  const merged = new Map<string, Message>();
  for (const message of legacyMessages) {
    merged.set(message.id, message);
  }

  if (backend === 'server') {
    try {
      const conversations = await db.conversations.getAll({ includeArchived: true });
      const recent = conversations
        .slice()
        .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
        .slice(0, SEARCH_SERVER_CONVERSATION_CAP);

      let fetched = 0;
      for (let i = 0; i < recent.length && fetched < SEARCH_SERVER_MESSAGE_CAP; i += 5) {
        const batch = recent.slice(i, i + 5);
        const batches = await Promise.all(
          batch.map((conversation) =>
            db.messages.getByConversation(conversation.id).catch(() => [] as Message[]),
          ),
        );
        for (const messages of batches) {
          for (const message of messages) {
            if (fetched >= SEARCH_SERVER_MESSAGE_CAP) break;
            merged.set(message.id, message);
            fetched++;
          }
        }
      }
    } catch {
      // Server search is best-effort; fall through to whatever is local.
    }
  }

  return buildSearchResults(Array.from(merged.values()), normalizedQuery, limit);
}
