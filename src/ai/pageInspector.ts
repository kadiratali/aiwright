import * as fs from 'fs';
import * as path from 'path';
import { chromium, Page } from '@playwright/test';
import * as dotenv from 'dotenv';
import { redact } from './redact';
import { registerAllSensitive } from '../fixtures/data';
import { config } from '../config';

dotenv.config();

const MAX_ELEMENTS = 80;

export type SelectorStrategy = 'data-test' | 'id' | 'role' | 'text' | 'css';

export interface SelectorEntry {
  /** Usable selector. CSS for data-test/id/css; Playwright builder hint for role/text. */
  selector: string;
  strategy: SelectorStrategy;
  role?: string;
  /** Accessible name / label (already PII-redacted). */
  name?: string;
  tag: string;
  inputType?: string;
  /** How many elements the selector matches (1 = unique). */
  count: number;
  ambiguous: boolean;
  /** True when the selector matched nothing (count 0) - needs manual attention. */
  unresolved?: boolean;
  /** Ancestor selector used to disambiguate, if any. */
  scope?: string;
  /** If this entry represents a repeated structure, how many siblings it stands for. */
  repeats?: number;
  note?: string;
}

export interface SelectorMap {
  url: string;
  title: string;
  generatedAt: string;
  entries: SelectorEntry[];
  warnings: string[];
}

/** Raw element descriptor collected in the browser (shadow-piercing walk). */
interface RawEl {
  tag: string;
  role: string;
  name: string;
  dataTest: string | null;
  /** Which test-id attribute the value came from (data-test, data-test-id, data-cy, ...). */
  dataTestAttr: string | null;
  id: string | null;
  classes: string;
  type: string | null;
  ancestorDataTest: string | null;
  ancestorDataTestAttr: string | null;
  cssPath: string;
}

// ---- Stability heuristics (run in Node) -----------------------------------

/** True if an id/class value looks framework-generated (unique but NOT stable). */
function looksGenerated(s: string): boolean {
  return (
    /\d{3,}/.test(s) || // long digit runs: MuiButton-root-238
    /^:r[0-9a-z]+:?$/i.test(s) || // React useId: :r0:
    /^«r.+»$/.test(s) ||
    /(^|[-_])css-[a-z0-9]{4,}/i.test(s) || // emotion
    /(^|[-_])sc-[a-z0-9]{5,}/i.test(s) || // styled-components
    /[a-f0-9]{8,}/i.test(s) || // hashes
    /(^|[-_])(radix|headlessui|mui|ember|chakra)[-_]/i.test(s)
  );
}

/** True if text is safe & stable to use as a selector (static UI label). */
function isStableText(name: string): boolean {
  if (!name) return false;
  if (name.includes('[REDACTED')) return false; // redaction touched it -> PII
  if (/\d/.test(name)) return false; // counts, dates, ids
  if (name.trim().split(/\s+/).length > 5) return false; // long/dynamic copy
  if (/@|https?:\/\//.test(name)) return false;
  return true;
}

function escAttr(v: string): string {
  return v.replace(/"/g, '\\"');
}

// ---- Browser-side collection ----------------------------------------------

/**
 * Walks the document AND open shadow roots, collecting candidate interactive /
 * assertable elements with an AT-style role + accessible name as the primary
 * descriptor. Closed shadow roots are unreachable and counted as a warning.
 */
function collectScript(maxEls: number, testIdAttrs: string[]): string {
  return `(() => {
    const MAX = ${maxEls};
    const TESTID_ATTRS = ${JSON.stringify(testIdAttrs)};
    const out = [];
    let closedShadow = 0;
    let iframeCount = 0;

    const roleFromTag = (el) => {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === 'a' && el.hasAttribute('href')) return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (/^h[1-6]$/.test(tag)) return 'heading';
      if (tag === 'input') {
        const t = (el.getAttribute('type') || 'text').toLowerCase();
        if (t === 'checkbox') return 'checkbox';
        if (t === 'radio') return 'radio';
        if (t === 'number') return 'spinbutton';
        if (t === 'range') return 'slider';
        if (['submit','button','reset','image'].includes(t)) return 'button';
        return 'textbox';
      }
      return '';
    };

    const accName = (el) => {
      const aria = el.getAttribute('aria-label');
      if (aria) return aria.trim();
      const labelledby = el.getAttribute('aria-labelledby');
      if (labelledby) {
        const ref = el.getRootNode().getElementById?.(labelledby);
        if (ref) return (ref.textContent || '').trim();
      }
      if (el.id) {
        const lab = el.getRootNode().querySelector?.('label[for="' + CSS.escape(el.id) + '"]');
        if (lab) return (lab.textContent || '').trim();
      }
      const closestLabel = el.closest && el.closest('label');
      if (closestLabel) return (closestLabel.textContent || '').trim();
      const ph = el.getAttribute('placeholder');
      if (ph) return ph.trim();
      if (el.tagName === 'IMG') return (el.getAttribute('alt') || '').trim();
      const val = el.getAttribute('value');
      if (val && el.tagName === 'INPUT') return val.trim();
      // Skip textContent for container elements (those wrapping other interactive
      // nodes) - otherwise a menuitem/nav grabs the whole submenu's text as its name.
      if (el.querySelector('a,button,input,select,textarea,[role],[data-test],[data-testid]')) return '';
      const txt = (el.textContent || '').trim().replace(/\\s+/g, ' ');
      return txt.length <= 80 ? txt : '';
    };

    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const st = getComputedStyle(el);
      return st.visibility !== 'hidden' && st.display !== 'none';
    };

    // test-id attribute conventions come from aiwright.config.ts (TESTID_ATTRS, injected above),
    // in priority order. Recognising hyphenated (data-test-id), camel-ish (data-testid) and other
    // framework variants — not just data-test — means a stable hook like data-test-id="selenium-..."
    // is used verbatim instead of falling back to a fragile structural selector.
    const ownTestId = (el) => {
      for (const a of TESTID_ATTRS) {
        const v = el.getAttribute(a);
        if (v) return { attr: a, val: v };
      }
      return null;
    };
    const nearestAncestorTestId = (el) => {
      let p = el.parentElement;
      while (p) {
        const t = ownTestId(p);
        if (t) return t;
        p = p.parentElement;
      }
      return null;
    };

    const shortPath = (el) => {
      const parts = [];
      let cur = el;
      for (let i = 0; i < 3 && cur && cur.nodeType === 1; i++) {
        let seg = cur.tagName.toLowerCase();
        const parent = cur.parentElement;
        if (parent) {
          const sibs = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
          if (sibs.length > 1) seg += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
        }
        parts.unshift(seg);
        cur = parent;
      }
      return parts.join(' > ');
    };

    const TESTID_SELECTORS = TESTID_ATTRS.map((a) => '[' + a + ']').join(',');
    const MATCH = 'a[href],button,input,select,textarea,summary,[role],' + TESTID_SELECTORS + ',h1,h2,h3,[aria-label]';

    const walk = (root) => {
      if (out.length >= MAX) return;
      let els;
      try { els = root.querySelectorAll(MATCH); } catch { return; }
      for (const el of els) {
        if (out.length >= MAX) break;
        if (!isVisible(el)) continue;
        const role = roleFromTag(el);
        const own = ownTestId(el);
        const anc = nearestAncestorTestId(el);
        out.push({
          tag: el.tagName.toLowerCase(),
          role,
          name: accName(el),
          dataTest: own ? own.val : null,
          dataTestAttr: own ? own.attr : null,
          id: el.id || null,
          classes: el.getAttribute('class') || '',
          type: el.getAttribute('type'),
          ancestorDataTest: anc ? anc.val : null,
          ancestorDataTestAttr: anc ? anc.attr : null,
          cssPath: shortPath(el)
        });
      }
      // descend into open shadow roots
      const all = root.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) walk(el.shadowRoot);
        else if (el.tagName && el.tagName.includes('-') && !el.shadowRoot && el.childElementCount === 0) {
          // Hyphenated custom element with an EMPTY light DOM -> its content is likely
          // behind a closed shadow root. Components that render light DOM (e.g. Angular
          // app-* with children) are reachable and must NOT be counted here.
          closedShadow++;
        }
      }
    };

    walk(document);
    iframeCount = document.querySelectorAll('iframe,frame').length;
    return { els: out, closedShadow, iframeCount };
  })()`;
}

// ---- Selector synthesis (Node) --------------------------------------------

async function countOf(page: Page, e: SelectorEntry): Promise<number> {
  try {
    if (e.strategy === 'role' && e.role) {
      return await page.getByRole(e.role as any, { name: e.name, exact: true }).count();
    }
    if (e.strategy === 'text' && e.name) {
      return await page.getByText(e.name, { exact: true }).count();
    }
    const css = e.scope ? `${e.scope} ${e.selector}` : e.selector;
    return await page.locator(css).count();
  } catch {
    return 0;
  }
}

function buildCandidate(raw: RawEl): SelectorEntry {
  const base: SelectorEntry = {
    selector: '',
    strategy: 'css',
    role: raw.role || undefined,
    name: raw.name || undefined,
    tag: raw.tag,
    inputType: raw.type || undefined,
    count: 0,
    ambiguous: false
  };

  // 1) test-id attribute (most trustworthy) — uses the actual attribute name it came from
  // (data-test / data-test-id / data-cy / ...), not a hardcoded data-test.
  if (raw.dataTest && raw.dataTestAttr) {
    return { ...base, selector: `[${raw.dataTestAttr}="${escAttr(raw.dataTest)}"]`, strategy: 'data-test' };
  }
  // 2) stable id
  if (raw.id && !looksGenerated(raw.id)) {
    return { ...base, selector: `[id="${escAttr(raw.id)}"]`, strategy: 'id' };
  }
  // 3) role + accessible name
  if (raw.role && raw.name) {
    return {
      ...base,
      selector: `getByRole('${raw.role}', { name: '${raw.name.replace(/'/g, "\\'")}', exact: true })`,
      strategy: 'role'
    };
  }
  // 4) stable static text
  if (isStableText(raw.name)) {
    return {
      ...base,
      selector: `getByText('${raw.name.replace(/'/g, "\\'")}', { exact: true })`,
      strategy: 'text'
    };
  }
  // 5) css path fallback
  return { ...base, selector: raw.cssPath || raw.tag, strategy: 'css', note: 'fallback path; verify' };
}

export interface InspectOptions {
  loginUserKey?: string;
  /** A saved logged-in session (Playwright storageState) to inspect the page authenticated. */
  storageState?: string | { cookies: any[]; origins: any[] };
}

export async function inspectPage(target: string, opts: InspectOptions = {}): Promise<SelectorMap> {
  // Feed the redaction denylist before any page text can reach the map.
  registerAllSensitive();

  const url = /^https?:\/\//.test(target) ? target : target.startsWith('/') ? target : `/${target}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: config.targetUrl, storageState: opts.storageState });
  const page = await context.newPage();
  const warnings: string[] = [];

  try {
    if (opts.loginUserKey) {
      // Authenticated inspection needs a project login page object to be wired here.
      // None is currently configured, so we inspect the page unauthenticated and warn.
      warnings.push(
        `authenticated inspection requested (loginUserKey="${opts.loginUserKey}") but no login page object is wired; inspecting unauthenticated`
      );
    }

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => warnings.push('networkidle not reached; page may be still loading'));

    const title = await page.title();
    const collected = (await page.evaluate(collectScript(MAX_ELEMENTS, config.testIdAttributes))) as {
      els: RawEl[];
      closedShadow: number;
      iframeCount: number;
    };

    if (collected.closedShadow > 0)
      warnings.push(`${collected.closedShadow} custom element(s) with unreachable (likely closed) shadow root were skipped.`);
    if (collected.iframeCount > 0)
      warnings.push(`${collected.iframeCount} iframe(s) detected; iframe contents are not inspected in this version.`);

    // Build + verify uniqueness, with ancestor scoping for collisions.
    const entries: SelectorEntry[] = [];
    for (const raw of collected.els) {
      const entry = buildCandidate(raw);
      entry.count = await countOf(page, entry);

      if (entry.count > 1 && raw.ancestorDataTest && raw.ancestorDataTestAttr && entry.strategy !== 'data-test') {
        // try scoping by a stable ancestor (any recognised test-id attribute)
        entry.scope = `[${raw.ancestorDataTestAttr}="${escAttr(raw.ancestorDataTest)}"]`;
        entry.count = await countOf(page, entry);
      }
      entry.ambiguous = entry.count > 1;
      entry.unresolved = entry.count === 0;
      entries.push(entry);
    }

    // Collapse entries whose final addressable selector is identical (same selector +
    // scope). Distinct selectors are always kept — including per-item buttons with
    // unique data-test slugs. Identical selectors repeated across a list (e.g. the same
    // data-test reused on every card) collapse to one representative to be parametrized.
    const seen = new Map<string, SelectorEntry>();
    const collapsed: SelectorEntry[] = [];
    for (const e of entries) {
      const key = `${e.scope ?? ''}||${e.selector}`;
      const prev = seen.get(key);
      if (prev) {
        // The real repeat count is how many elements the selector matches on the page.
        prev.repeats = prev.count > 1 ? prev.count : (prev.repeats ?? 1) + 1;
        prev.note = `repeats ${prev.repeats}x — one per item; scope to the row or parametrize (e.g. a toSlug-style template)`;
        continue;
      }
      seen.set(key, e);
      collapsed.push(e);
    }

    // PII safety: redact names before they leave the process.
    for (const e of collapsed) {
      if (e.name) e.name = redact(e.name);
    }

    return { url, title: redact(title), generatedAt: new Date().toISOString(), entries: collapsed, warnings };
  } finally {
    await browser.close();
  }
}

export function writeSelectorMap(map: SelectorMap, rootDir = process.cwd()): string {
  const slug =
    map.url
      .replace(/^https?:\/\//, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'page';
  const target = path.join(rootDir, 'reports', `selector-map-${slug}.json`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(map, null, 2));
  return target;
}
