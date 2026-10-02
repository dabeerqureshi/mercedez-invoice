/**
 * Browserbase + Playwright (CDP) wrapper for the live Mercedes connector.
 *
 * Design notes vs the desktop app:
 *   * The desktop app kept a persistent LOCAL Chromium profile on disk
 *     (config.PROFILE_DIR). In the cloud we use a Browserbase *Context* — an
 *     encrypted, persistent user-data-directory hosted by Browserbase — which
 *     gives the exact same "log in once, stay logged in" behaviour.
 *   * Sessions are created per operation. Price lookups create a short-lived
 *     session with the Context attached (persist: true) and rely on
 *     disconnection to end the session; the manual login session is created
 *     with keepAlive so it survives the API response and can be watched via
 *     the Live View URL until the user finishes signing in.
 */
import { Browserbase } from "@browserbasehq/sdk";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";

export const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY ?? "";
export const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID ?? "";

/** True when the environment has Browserbase credentials. */
export function isBrowserbaseConfigured(): boolean {
  return BROWSERBASE_API_KEY.length > 0;
}

let client: Browserbase | null = null;

function bb(): Browserbase {
  if (!client) {
    client = new Browserbase({
      apiKey: BROWSERBASE_API_KEY,
      ...(BROWSERBASE_PROJECT_ID ? { projectId: BROWSERBASE_PROJECT_ID } : {}),
    });
  }
  return client;
}

export interface CreateSessionOptions {
  /** Browserbase Context (persistent user data) to attach. */
  contextId?: string;
  /** Auto-end timeout in seconds (API min 60 / max 21600). */
  timeoutSeconds?: number;
  /** Keep the session running after CDP disconnects (manual login flow). */
  keepAlive?: boolean;
  viewport?: { width: number; height: number };
}

export interface CreatedSession {
  id: string;
  connectUrl: string;
}

/** Create a browser session, optionally bound to a persistent Context. */
export async function createSession(
  opts: CreateSessionOptions,
): Promise<CreatedSession> {
  const params: Browserbase.SessionCreateParams = {
    ...(BROWSERBASE_PROJECT_ID ? { projectId: BROWSERBASE_PROJECT_ID } : {}),
    ...(opts.timeoutSeconds ? { api_timeout: opts.timeoutSeconds } : {}),
    ...(opts.keepAlive !== undefined ? { keepAlive: opts.keepAlive } : {}),
    browserSettings: {
      ...(opts.contextId
        ? { context: { id: opts.contextId, persist: true } }
        : {}),
      viewport: opts.viewport ?? { width: 1440, height: 900 },
    },
  };
  const session = await bb().sessions.create(params);
  return { id: session.id, connectUrl: session.connectUrl };
}

/** Create a persistent Context (the cloud equivalent of PROFILE_DIR). */
export async function createContext(name: string): Promise<string> {
  const context = await bb().contexts.create({ name });
  return context.id;
}

/** Delete a Context permanently (used by "Disconnect"). */
export async function deleteContext(contextId: string): Promise<void> {
  await bb().contexts.delete(contextId);
}

/** Live View URLs for a running session (login window / debugging). */
export async function getLiveUrls(sessionId: string): Promise<{
  debuggerUrl: string;
  debuggerFullscreenUrl: string;
}> {
  const urls = await bb().sessions.debug(sessionId);
  return {
    debuggerUrl: urls.debuggerUrl,
    debuggerFullscreenUrl: urls.debuggerFullscreenUrl,
  };
}

/** Ask Browserbase to end a session. Never throws (best effort). */
export async function endSession(sessionId: string): Promise<void> {
  try {
    await bb().sessions.update(sessionId, { status: "REQUEST_RELEASE" });
  } catch {
    // Session already ended/expired — nothing to do.
  }
}

/** Connect to a session over CDP with playwright-core. */
export async function connectCdp(connectUrl: string): Promise<Browser> {
  return chromium.connectOverCDP(connectUrl);
}

/**
 * Run *fn* with the first page of a freshly connected session and always
 * disconnect afterwards. Disconnecting ends a non-keepAlive session, which is
 * exactly what we want after a price lookup.
 */
export async function withPage<T>(
  connectUrl: string,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const browser = await connectCdp(connectUrl);
  try {
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error("Browserbase session has no default context.");
    }
    const page = context.pages()[0] ?? (await context.newPage());
    return await fn(page);
  } finally {
    try {
      await browser.close();
    } catch {
      // Ignore disconnect races.
    }
  }
}
