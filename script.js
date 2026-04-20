const DB_NAME = 'thread-note-db';
const STORE_NAME = 'notes';
const DB_VERSION = 1;
const MAX_IMAGE_SIDE = 1600;
const IMAGE_QUALITY = 0.82;

const state = {
  notes: [],
  search: '',
  pinnedOnly: false,
  sort: 'newest',
  collapsed: new Set(),
  rootImages: [],
};

const els = {
  rootText: document.getElementById('rootText'),
  addRootBtn: document.getElementById('addRootBtn'),
  rootImageInput: document.getElementById('rootImageInput'),
  rootImagePreview: document.getElementById('rootImagePreview'),
  pinRoot: document.getElementById('pinRoot'),
  searchInput: document.getElementById('searchInput'),
  pinnedOnly: document.getElementById('pinnedOnly'),
  sortSelect: document.getElementById('sortSelect'),
  threads: document.getElementById('threads'),
  emptyState: document.getElementById('emptyState'),
  exportBtn: document.getElementById('exportBtn'),
  importInput: document.getElementById('importInput'),
  noteTemplate: document.getElementById('noteTemplate'),
};

let db;

async function init() {
  db = await openDb();
  await seedIfEmpty();
  await refresh();
  bindEvents();
  registerServiceWorker();
}

function bindEvents() {
  els.addRootBtn.addEventListener('click', addRootNote);
  els.rootImageInput.addEventListener('change', async (e) => {
    state.rootImages = await prepareFiles([...e.target.files]);
    renderRootPreviews();
    e.target.value = '';
  });
  els.searchInput.addEventListener('input', () => {
    state.search = els.searchInput.value.trim();
    render();
  });
  els.pinnedOnly.addEventListener('change', () => {
    state.pinnedOnly = els.pinnedOnly.checked;
    render();
  });
  els.sortSelect.addEventListener('change', () => {
    state.sort = els.sortSelect.value;
    render();
  });
  els.exportBtn.addEventListener('click', exportData);
  els.importInput.addEventListener('change', importData);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('parentId', 'parentId', { unique: false });
      store.createIndex('createdAt', 'createdAt', { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getStore(mode = 'readonly') {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function getAllNotes() {
  return new Promise((resolve, reject) => {
    const req = getStore().getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function putNote(note) {
  return new Promise((resolve, reject) => {
    const req = getStore('readwrite').put(note);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function deleteNoteById(id) {
  return new Promise((resolve, reject) => {
    const req = getStore('readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function seedIfEmpty() {
  const notes = await getAllNotes();
  if (notes.length > 0) return;
  const rootId = crypto.randomUUID();
  const replyId = crypto.randomUUID();
  await putNote({
    id: rootId,
    parentId: null,
    text: '예: 오늘 시장에서 중요한 건 "뉴스"가 아니라 "누가 그걸 살 돈이 있느냐"였음.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pinned: true,
    images: [],
  });
  await putNote({
    id: replyId,
    parentId: rootId,
    text: 'ㄴ 외국인 선물/현물 수급이 실제로 따라붙는지 내일 확인.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pinned: false,
    images: [],
  });
}

async function refresh() {
  state.notes = (await getAllNotes()).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  render();
}

async function addRootNote() {
  const text = els.rootText.value.trim();
  if (!text) return;
  const now = new Date().toISOString();
  await putNote({
    id: crypto.randomUUID(),
    parentId: null,
    text,
    createdAt: now,
    updatedAt: now,
    pinned: els.pinRoot.checked,
    images: state.rootImages,
  });
  els.rootText.value = '';
  els.pinRoot.checked = false;
  state.rootImages = [];
  renderRootPreviews();
  await refresh();
}

function renderRootPreviews() {
  renderImagePreviews(els.rootImagePreview, state.rootImages, (idx) => {
    state.rootImages.splice(idx, 1);
    renderRootPreviews();
  });
}

function renderImagePreviews(container, images, onRemove) {
  container.innerHTML = '';
  images.forEach((img, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'preview-chip';
    const image = document.createElement('img');
    image.src = img.dataUrl;
    image.alt = img.name || 'preview';
    const btn = document.createElement('button');
    btn.className = 'remove-preview-btn';
    btn.type = 'button';
    btn.textContent = '×';
    btn.addEventListener('click', () => onRemove(idx));
    wrap.append(image, btn);
    container.appendChild(wrap);
  });
}

function buildTree(notes) {
  const byId = new Map(notes.map((note) => [note.id, { ...note, children: [] }]));
  const roots = [];
  byId.forEach((note) => {
    if (note.parentId && byId.has(note.parentId)) byId.get(note.parentId).children.push(note);
    else roots.push(note);
  });
  return roots;
}

function render() {
  const tree = buildTree(state.notes);
  let roots = tree.filter((node) => threadMatches(node, state.search));
  if (state.pinnedOnly) roots = roots.filter((root) => root.pinned);

  roots.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return state.sort === 'newest'
      ? new Date(b.createdAt) - new Date(a.createdAt)
      : new Date(a.createdAt) - new Date(b.createdAt);
  });

  els.threads.innerHTML = '';
  els.emptyState.classList.toggle('hidden', roots.length > 0);

  roots.forEach((root) => {
    els.threads.appendChild(renderNoteNode(root, 0));
  });
}

function threadMatches(node, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  if ((node.text || '').toLowerCase().includes(q)) return true;
  return node.children.some((child) => threadMatches(child, query));
}

function renderNoteNode(note, depth) {
  const frag = els.noteTemplate.content.cloneNode(true);
  const card = frag.querySelector('.note-card');
  const meta = frag.querySelector('.note-meta');
  const textEl = frag.querySelector('.note-text');
  const imagesEl = frag.querySelector('.note-images');
  const childrenEl = frag.querySelector('.children');

  const collapseBtn = frag.querySelector('.collapse-btn');
  const pinBtn = frag.querySelector('.pin-btn');
  const replyBtn = frag.querySelector('.reply-btn');
  const editBtn = frag.querySelector('.edit-btn');
  const deleteBtn = frag.querySelector('.delete-btn');

  const editor = frag.querySelector('.inline-editor');
  const editTextarea = frag.querySelector('.edit-textarea');
  const cancelEditBtn = frag.querySelector('.cancel-edit-btn');
  const saveEditBtn = frag.querySelector('.save-edit-btn');

  const replyComposer = frag.querySelector('.reply-composer');
  const replyTextarea = frag.querySelector('.reply-textarea');
  const replyImageInput = frag.querySelector('.reply-image-input');
  const replyImagePreview = frag.querySelector('.reply-image-preview');
  const cancelReplyBtn = frag.querySelector('.cancel-reply-btn');
  const submitReplyBtn = frag.querySelector('.submit-reply-btn');

  const isCollapsed = state.collapsed.has(note.id);
  meta.innerHTML = `${formatDate(note.createdAt)}${note.updatedAt !== note.createdAt ? ` · 수정 ${formatDate(note.updatedAt)}` : ''}${note.pinned ? `<span class="badge">고정</span>` : ''}`;
  textEl.innerHTML = highlightText(escapeHtml(note.text), state.search);

  if (note.images?.length) {
    note.images.forEach((img) => {
      const wrap = document.createElement('div');
      wrap.className = 'note-image-wrap';
      const image = document.createElement('img');
      image.src = img.dataUrl;
      image.alt = img.name || '첨부 이미지';
      wrap.appendChild(image);
      imagesEl.appendChild(wrap);
    });
  }

  if (note.pinned) pinBtn.classList.add('pin-active');
  if (isCollapsed) {
    childrenEl.classList.add('hidden');
    collapseBtn.textContent = '펼치기';
    collapseBtn.classList.add('collapse-active');
  }

  collapseBtn.addEventListener('click', () => {
    if (state.collapsed.has(note.id)) state.collapsed.delete(note.id);
    else state.collapsed.add(note.id);
    render();
  });

  pinBtn.addEventListener('click', async () => {
    note.pinned = !note.pinned;
    note.updatedAt = new Date().toISOString();
    await putNote(stripChildren(note));
    await refresh();
  });

  replyBtn.addEventListener('click', () => {
    replyComposer.classList.toggle('hidden');
  });

  editBtn.addEventListener('click', () => {
    editor.classList.toggle('hidden');
    editTextarea.value = note.text;
  });

  cancelEditBtn.addEventListener('click', () => editor.classList.add('hidden'));
  saveEditBtn.addEventListener('click', async () => {
    const value = editTextarea.value.trim();
    if (!value) return;
    note.text = value;
    note.updatedAt = new Date().toISOString();
    await putNote(stripChildren(note));
    await refresh();
  });

  deleteBtn.addEventListener('click', async () => {
    const ids = collectIds(note);
    for (const id of ids) await deleteNoteById(id);
    await refresh();
  });

  let replyImages = [];
  const refreshReplyPreviews = () => {
    renderImagePreviews(replyImagePreview, replyImages, (idx) => {
      replyImages.splice(idx, 1);
      refreshReplyPreviews();
    });
  };

  replyImageInput.addEventListener('change', async (e) => {
    const incoming = await prepareFiles([...e.target.files]);
    replyImages = [...replyImages, ...incoming];
    refreshReplyPreviews();
    e.target.value = '';
  });

  cancelReplyBtn.addEventListener('click', () => {
    replyComposer.classList.add('hidden');
    replyTextarea.value = '';
    replyImages = [];
    replyImagePreview.innerHTML = '';
  });

  submitReplyBtn.addEventListener('click', async () => {
    const value = replyTextarea.value.trim();
    if (!value) return;
    const now = new Date().toISOString();
    await putNote({
      id: crypto.randomUUID(),
      parentId: note.id,
      text: value,
      createdAt: now,
      updatedAt: now,
      pinned: false,
      images: replyImages,
    });
    replyComposer.classList.add('hidden');
    replyTextarea.value = '';
    replyImages = [];
    replyImagePreview.innerHTML = '';
    await refresh();
  });

  note.children.forEach((child) => {
    if (!threadMatches(child, state.search)) return;
    childrenEl.appendChild(renderNoteNode(child, depth + 1));
  });

  return card;
}

function stripChildren(note) {
  const { children, ...rest } = note;
  return rest;
}

function collectIds(node) {
  return [node.id, ...node.children.flatMap(collectIds)];
}

function formatDate(iso) {
  const dt = new Date(iso);
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt);
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function highlightText(htmlSafeText, query) {
  if (!query) return htmlSafeText.replace(/\n/g, '<br>');
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${q})`, 'gi');
  return htmlSafeText.replace(regex, '<span class="search-hit">$1</span>').replace(/\n/g, '<br>');
}

async function prepareFiles(files) {
  const prepared = [];
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const dataUrl = await downscaleImage(file);
    prepared.push({
      id: crypto.randomUUID(),
      name: file.name,
      type: 'image/jpeg',
      dataUrl,
    });
  }
  return prepared;
}

function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        const ratio = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', IMAGE_QUALITY));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function exportData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    notes: state.notes,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `thread-note-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importData(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.notes)) throw new Error('invalid');
    const existing = await getAllNotes();
    for (const note of existing) await deleteNoteById(note.id);
    for (const note of parsed.notes) await putNote(note);
    await refresh();
  } catch {
    alert('불러오기에 실패했어요. JSON 파일 형식을 확인해주세요.');
  } finally {
    e.target.value = '';
  }
}

init().catch((err) => {
  console.error(err);
  document.body.innerHTML = '<div style="padding:24px;color:white;">앱을 불러오지 못했습니다.</div>';
});
