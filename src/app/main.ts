import { makeZip } from 'client-zip';
import type { VaultPayloadDocument } from '../format';
import { RecoverySession, type UnlockedVault } from '../session';
import logoUrl from './assets/logo.png?inline';
import './styles.css';

declare const __TOOL_VERSION__: string;

type Mode = 'contact' | 'owner';

interface State {
  session: RecoverySession | null;
  fileName: string;
  mode: Mode;
  busy: boolean;
  progress: number | null;
  message: { kind: 'good' | 'bad' | 'info'; text: string } | null;
  unlocked: UnlockedVault | null;
}

const state: State = {
  session: null,
  fileName: '',
  mode: 'contact',
  busy: false,
  progress: null,
  message: null,
  unlocked: null,
};

const TRUST_LABEL: Record<string, string> = {
  ULTIMATE_TRUST: 'can open alone',
  HIGH_TRUST: '2 of 3 keys',
  SHARED_TRUST: '1 of 3 keys',
};

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'className') {
      el.className = String(value);
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function saveBytes(bytes: Uint8Array | Blob, fileName: string, type: string) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const VIEWABLE =
  /^(application\/pdf|image\/(png|jpe?g|gif|webp|avif|bmp)|text\/plain|audio\/|video\/)/;

function setMessage(kind: 'good' | 'bad' | 'info', text: string) {
  state.message = { kind, text };
}

async function loadFile(file: File) {
  state.busy = true;
  state.message = null;
  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.href = logoUrl;
  document.head.append(favicon);

  render();
  try {
    state.session = await RecoverySession.open(file);
    state.fileName = file.name;
    state.unlocked = null;
  } catch (err) {
    state.session = null;
    setMessage('bad', err instanceof Error ? err.message : 'Could not read this file.');
  } finally {
    state.busy = false;
    const favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.href = logoUrl;
    document.head.append(favicon);

    render();
  }
}

async function submitCode(input: HTMLInputElement) {
  const session = state.session;
  const code = input.value;
  if (!session || !code.trim()) return;
  if (code.trim().split(/\s+/).length !== 6) {
    setMessage('bad', 'An access code is exactly 6 words, separated by spaces.');
    const favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.href = logoUrl;
    document.head.append(favicon);

    render();
    return;
  }
  state.busy = true;
  state.progress = 0;
  setMessage('info', 'Checking this code. This takes a few seconds on purpose.');
  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.href = logoUrl;
  document.head.append(favicon);

  render();
  try {
    const result = await session.addAccessCode(code, (p) => {
      state.progress = p;
      updateProgress();
    });
    const names = (idx: number[]) => idx.map((i) => session.manifest.contacts[i].label).join(', ');
    if (result.status === 'matched') {
      setMessage(
        'good',
        `Code accepted for ${names(result.contactIndexes)}. ${session.uniqueShareCount} of ${session.threshold} keys collected.`,
      );
      input.value = '';
    } else if (result.status === 'duplicate') {
      setMessage('info', `That code for ${names(result.contactIndexes)} was already entered.`);
      input.value = '';
    } else {
      setMessage(
        'bad',
        'This code does not match anyone in this vault. Check each word and try again.',
      );
    }
    if (session.canReconstruct) {
      state.unlocked = await session.unlockWithShares();
      state.message = null;
    }
  } catch (err) {
    setMessage('bad', err instanceof Error ? err.message : 'Something went wrong.');
  } finally {
    state.busy = false;
    state.progress = null;
    const favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.href = logoUrl;
    document.head.append(favicon);

    render();
  }
}

async function submitPassphrase(input: HTMLTextAreaElement) {
  const session = state.session;
  if (!session || !input.value.trim()) return;
  state.busy = true;
  state.progress = 0;
  setMessage('info', 'Checking the passphrase. This takes a few seconds on purpose.');
  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.href = logoUrl;
  document.head.append(favicon);

  render();
  try {
    state.unlocked = await session.unlockWithPassphrase(input.value, (p) => {
      state.progress = p;
      updateProgress();
    });
    state.message = null;
  } catch {
    setMessage('bad', 'That passphrase did not open this vault. Check each word and try again.');
  } finally {
    state.busy = false;
    state.progress = null;
    const favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.href = logoUrl;
    document.head.append(favicon);

    render();
  }
}

async function openDocument(doc: VaultPayloadDocument, download: boolean) {
  const { session, unlocked } = state;
  if (!session || !unlocked) return;
  try {
    const bytes = await session.decryptDocument(unlocked, doc);
    if (download || !VIEWABLE.test(doc.contentType)) {
      saveBytes(bytes, doc.fileName || doc.title, doc.contentType);
      return;
    }
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: doc.contentType }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  } catch (err) {
    setMessage(
      'bad',
      `Could not decrypt "${doc.title}": ${err instanceof Error ? err.message : err}`,
    );
    const favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.href = logoUrl;
    document.head.append(favicon);

    render();
  }
}

async function downloadAll() {
  const { session, unlocked } = state;
  if (!session || !unlocked) return;
  state.busy = true;
  state.progress = 0;
  setMessage('info', 'Decrypting every document into one ZIP file...');
  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.href = logoUrl;
  document.head.append(favicon);

  render();
  try {
    const docs = unlocked.payload.documents;
    const used = new Set<string>();
    const uniqueName = (name: string) => {
      let candidate = name;
      let n = 1;
      while (used.has(candidate)) {
        const dot = name.lastIndexOf('.');
        candidate = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
        n += 1;
      }
      used.add(candidate);
      return candidate;
    };
    const activeSession = session;
    const activeVault = unlocked;
    async function* files() {
      let i = 0;
      for (const doc of docs) {
        const bytes = await activeSession.decryptDocument(activeVault, doc);
        i += 1;
        state.progress = i / docs.length;
        updateProgress();
        yield { name: uniqueName(doc.fileName || doc.title), input: bytes };
      }
    }
    const blob = await new Response(makeZip(files())).blob();
    const vaultName = unlocked.payload.vault.name.replace(/[^\w\- ]+/g, '').trim() || 'vault';
    saveBytes(blob, `${vaultName} (decrypted).zip`, 'application/zip');
    setMessage(
      'good',
      'Saved. Keep the decrypted files somewhere safe; they are no longer protected.',
    );
  } catch (err) {
    setMessage('bad', err instanceof Error ? err.message : 'Could not build the ZIP.');
  } finally {
    state.busy = false;
    state.progress = null;
    const favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.href = logoUrl;
    document.head.append(favicon);

    render();
  }
}

function reset() {
  state.session = null;
  state.unlocked = null;
  state.message = null;
  state.fileName = '';
  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.href = logoUrl;
  document.head.append(favicon);

  render();
}

function progressBar() {
  if (state.progress === null) return null;
  return h(
    'div',
    { className: 'progress' },
    h('div', { id: 'progress-fill', style: `width:${Math.round(state.progress * 100)}%` }),
  );
}

function updateProgress() {
  const fill = document.getElementById('progress-fill');
  if (fill && state.progress !== null) fill.style.width = `${Math.round(state.progress * 100)}%`;
}

function messageView() {
  if (!state.message) return null;
  return h(
    'div',
    { className: `status ${state.message.kind}`, role: 'status' },
    state.message.text,
  );
}

function dropView() {
  const fileInput = h('input', {
    type: 'file',
    accept: '.zip,application/zip',
    style: 'display:none',
    onChange: (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) void loadFile(file);
    },
  });
  const zone = h(
    'div',
    {
      className: 'drop',
      tabindex: '0',
      role: 'button',
      onClick: () => fileInput.click(),
      onKeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') fileInput.click();
      },
      onDragover: (e: DragEvent) => {
        e.preventDefault();
        zone.classList.add('over');
      },
      onDragleave: () => zone.classList.remove('over'),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        zone.classList.remove('over');
        const file = e.dataTransfer?.files?.[0];
        if (file) void loadFile(file);
      },
    },
    h('p', {}, h('strong', {}, 'Drop the .zip file here, or click to choose it')),
    h(
      'p',
      { className: 'muted small' },
      'Use the original file named like eternal-vault-….zip. Do not unzip it first.',
    ),
    fileInput,
  );
  return h(
    'div',
    {},
    h(
      'section',
      { className: 'hero' },
      h('h2', { style: 'margin:0' }, 'Open a loved one’s vault'),
      h(
        'p',
        {},
        'Someone trusted you with access to their Eternal Vault. This page unlocks their recovery bundle right here, without any servers.',
      ),
      h(
        'ol',
        { className: 'steps' },
        h('li', {}, 'Choose the bundle .zip'),
        h('li', {}, 'Enter your access code'),
        h('li', {}, 'Open the documents'),
      ),
    ),
    h(
      'section',
      { className: 'card' },
      h('h2', {}, 'Choose the recovery bundle'),
      zone,
      state.busy ? h('p', { className: 'muted small' }, 'Reading...') : null,
      messageView(),
    ),
  );
}

function contactsView(session: RecoverySession) {
  const matched = new Set(session.matchedContactIndexes);
  return h(
    'div',
    { className: 'chips' },
    ...session.manifest.contacts.map((c, i) =>
      h(
        'span',
        { className: `chip${matched.has(i) ? ' matched' : ''}` },
        `${matched.has(i) ? '✓ ' : ''}${c.label} · ${TRUST_LABEL[c.trustLevel] ?? `${c.sharesHeld} key(s)`}`,
      ),
    ),
  );
}

function unlockView(session: RecoverySession) {
  const owner = session.manifest.owner.firstName;
  const tabs = h(
    'div',
    { className: 'tabs', role: 'tablist' },
    h(
      'button',
      {
        className: state.mode === 'contact' ? 'active' : '',
        onClick: () => {
          state.mode = 'contact';
          state.message = null;
          const favicon = document.createElement('link');
          favicon.rel = 'icon';
          favicon.href = logoUrl;
          document.head.append(favicon);

          render();
        },
      },
      "I'm a trusted contact",
    ),
    h(
      'button',
      {
        className: state.mode === 'owner' ? 'active' : '',
        onClick: () => {
          state.mode = 'owner';
          state.message = null;
          const favicon = document.createElement('link');
          favicon.rel = 'icon';
          favicon.href = logoUrl;
          document.head.append(favicon);

          render();
        },
      },
      `I'm ${owner}`,
    ),
  );

  let body: HTMLElement;
  if (state.mode === 'contact') {
    const input = h('input', {
      id: 'code',
      autocomplete: 'off',
      autocapitalize: 'none',
      spellcheck: 'false',
      placeholder: 'six words separated by spaces',
      disabled: state.busy,
      onKeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter') void submitCode(input);
      },
    });
    const meter = h(
      'div',
      {
        className: 'meter',
        'aria-label': `${session.uniqueShareCount} of ${session.threshold} keys`,
      },
      ...Array.from({ length: session.threshold }, (_, i) =>
        h('span', { className: i < session.uniqueShareCount ? 'on' : '' }),
      ),
    );
    body = h(
      'div',
      {},
      h(
        'p',
        { className: 'muted' },
        `Each contact enters the 6-word access code they received by email. Codes can be entered one after another on this computer. ${session.threshold} keys open the vault.`,
      ),
      contactsView(session),
      meter,
      h('label', { for: 'code' }, 'Access code'),
      h(
        'div',
        { className: 'row' },
        h('div', { style: 'flex:1;min-width:220px' }, input),
        h(
          'button',
          { className: 'primary', disabled: state.busy, onClick: () => submitCode(input) },
          'Add code',
        ),
      ),
    );
  } else {
    const input = h('textarea', {
      id: 'passphrase',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'your vault passphrase',
      disabled: state.busy,
    });
    body = h(
      'div',
      {},
      h(
        'p',
        { className: 'muted' },
        'Enter the passphrase you use to unlock documents in Eternal Vault. Use this to check that your bundle works.',
      ),
      h('label', { for: 'passphrase' }, 'Passphrase'),
      input,
      h(
        'div',
        { className: 'row', style: 'margin-top:10px' },
        h(
          'button',
          { className: 'primary', disabled: state.busy, onClick: () => submitPassphrase(input) },
          'Unlock',
        ),
      ),
    );
  }

  return h(
    'section',
    { className: 'card' },
    h(
      'div',
      { className: 'row', style: 'justify-content:space-between' },
      h('h2', { style: 'margin:0' }, `Unlock ${owner}'s vault`),
      h('button', { className: 'link small', onClick: reset }, 'Choose another file'),
    ),
    h('p', { className: 'muted small' }, state.fileName),
    tabs,
    body,
    progressBar(),
    messageView(),
  );
}

function vaultView(session: RecoverySession, unlocked: UnlockedVault) {
  const { payload } = unlocked;
  const rows = payload.documents.map((doc) =>
    h(
      'tr',
      {},
      h(
        'td',
        {},
        h('div', { className: 'doc-title' }, doc.title),
        doc.description ? h('div', { className: 'muted small' }, doc.description) : null,
        doc.tags.length || doc.category
          ? h(
              'div',
              { className: 'muted small' },
              [doc.category, ...doc.tags].filter(Boolean).join(' · '),
            )
          : null,
      ),
      h('td', { className: 'muted small hide-sm' }, formatBytes(doc.size)),
      h(
        'td',
        { className: 'actions' },
        h(
          'div',
          { className: 'row', style: 'justify-content:flex-end' },
          VIEWABLE.test(doc.contentType)
            ? h('button', { onClick: () => openDocument(doc, false) }, 'View')
            : null,
          h('button', { onClick: () => openDocument(doc, true) }, 'Download'),
        ),
      ),
    ),
  );

  return h(
    'div',
    {},
    h(
      'section',
      { className: 'card' },
      h(
        'div',
        { className: 'row', style: 'justify-content:space-between' },
        h(
          'div',
          {},
          h('h2', { style: 'margin:0' }, payload.vault.name),
          payload.vault.description
            ? h('p', { className: 'muted' }, payload.vault.description)
            : null,
        ),
        h('button', { className: 'link small', onClick: reset }, 'Lock and close'),
      ),
      h(
        'div',
        { className: 'status good' },
        `Vault unlocked on this computer. ${payload.documents.length} document(s).`,
      ),
      payload.documents.length
        ? h(
            'div',
            {},
            h(
              'table',
              {},
              h(
                'thead',
                {},
                h(
                  'tr',
                  {},
                  h('th', {}, 'Document'),
                  h('th', { className: 'hide-sm' }, 'Size'),
                  h('th', {}, ''),
                ),
              ),
              h('tbody', {}, ...rows),
            ),
            h(
              'div',
              { className: 'row', style: 'margin-top:14px' },
              h(
                'button',
                { className: 'primary', disabled: state.busy, onClick: downloadAll },
                'Download all (ZIP)',
              ),
            ),
          )
        : h('p', { className: 'muted' }, 'This vault has no documents.'),
      progressBar(),
      messageView(),
    ),
    payload.externalDocuments.length
      ? h(
          'section',
          { className: 'card' },
          h('h2', {}, 'Linked documents (not in this bundle)'),
          h(
            'p',
            { className: 'muted small' },
            'These were stored in another service and are only referenced here.',
          ),
          h(
            'ul',
            {},
            ...payload.externalDocuments.map((d) =>
              h(
                'li',
                {},
                `${d.title} (${d.provider})`,
                d.link ? h('div', { className: 'muted small' }, d.link) : null,
              ),
            ),
          ),
        )
      : null,
    payload.contacts.length
      ? h(
          'section',
          { className: 'card' },
          h('h2', {}, 'Trusted contacts'),
          h('ul', {}, ...payload.contacts.map((c) => h('li', {}, `${c.name} <${c.email}>`))),
        )
      : null,
    h(
      'p',
      { className: 'muted small', style: 'margin-top:12px' },
      `Bundle created ${session.manifest.createdAt.slice(0, 10)}.`,
    ),
  );
}

function render() {
  const app = document.getElementById('app');
  if (!app) return;
  const { session, unlocked } = state;
  const header = h(
    'header',
    {},
    h(
      'div',
      { className: 'brand' },
      h('img', { src: logoUrl, alt: '' }),
      h('div', {}, h('h1', {}, 'Eternal Vault'), h('small', {}, 'Offline recovery')),
    ),
    h(
      'div',
      { className: 'notice' },
      h('span', { className: 'dot' }),
      'Works offline. Nothing you enter leaves this computer.',
    ),
  );
  const content = !session
    ? dropView()
    : unlocked
      ? vaultView(session, unlocked)
      : unlockView(session);
  const footer = h(
    'footer',
    {},
    `Recovery tool v${__TOOL_VERSION__} · Open source (MIT) · `,
    'Format: eternal-vault-recovery v1',
  );
  app.replaceChildren(h('main', {}, header, content, footer));
  const focusTarget = document.getElementById(state.mode === 'contact' ? 'code' : 'passphrase');
  if (focusTarget && !state.busy && session && !unlocked) (focusTarget as HTMLInputElement).focus();
}

const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.href = logoUrl;
document.head.append(favicon);

render();
