import { GIFEncoder, quantize, applyPalette } from '/vendor/gifenc.js';

const $ = (id) => document.getElementById(id);
// Every deployment uses browser-local editing and export. The server only serves the app.
const showLocalFeatures = true;
document.querySelectorAll('.local-only').forEach(element => { element.hidden = !showLocalFeatures; });
const state = {
  image: null, imageName: '', imageUrl: '', imageData: null, bgColor: [75, 115, 110], backgroundProfile: null, backgroundView: 'transparent', backgroundPicking: false, sheets: [], activeSheetId: null, sheetZoom: 1,
  selection: null, detectedBoxes: [], frames: [], selectedFrame: -1, fps: 12, scale: 8, loop: true, pingPong: false, direction: 1, mode: 'action',
  playing: false, playIndex: 0, motionProgress: 0, motionDirection: 1, previewZoom: 1, previewSpeed: 0.5, motionEnabled: true, motionAmount: 1, panelRatio: 75, editorSplit: 38, cameraX: 0, cameraY: 0, draggingPreview: false, dragStart: null, motionDrag: null, layerDrag: null, previewOriginLock: null, previewScaleLock: null, activeLayerId: null, selectedLayerIds: new Set(), exportLayerScope: 'auto', frameSelectionDrag: null, selectedFrameIds: new Set(), selectedAnimationIds: new Set(), animationOrder: [], animationDrag: null, animationDropIndex: -1, animationDropTargetId: null, animationDropAfter: false, sequenceEnabled: true, sequenceClipIndex: 0, spacePressed: false, sheetPointerInside: false, sheetPanning: null, animations: [{ id: 'animation-1', name: '动画 1', frameIds: [], motion: null, layers: null, playMode: 'loop' }], activeAnimation: 0,
  raf: 0, lastTick: 0, dragFrame: null, dragFrames: [], lastExportError: '', lastExportInfo: '',
  exportSerial: 0
};

const sheetCanvas = $('sheetCanvas');
const sheetCtx = sheetCanvas.getContext('2d');
const previewCanvas = $('previewCanvas');
const previewCtx = previewCanvas.getContext('2d');
previewCtx.imageSmoothingEnabled = false;

function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2400); }
function progressBlocks(progress = 0) { const filled = Math.max(0, Math.min(4, Math.round(progress * 4))); return `[${'■'.repeat(filled)}${'□'.repeat(4 - filled)}]`; }
function setTaskStatus(status, detail = '', progress = 0) { const chip = $('appStatus'); if (chip) { chip.dataset.state = status; chip.querySelector('b').textContent = status; chip.querySelector('small').textContent = detail || '本地工作区'; } const scan = $('scanStatus'); if (scan) { scan.querySelector('b').textContent = status; scan.querySelector('span').textContent = progressBlocks(progress); } $('sheetStage')?.classList.toggle('scanning', status === 'SCANNING'); }
function setExportStatus(status, detail = '', progress = 0) { const label = $('exportStateLabel'); if (label) label.textContent = status; const info = $('exportStateDetail'); if (info) info.textContent = detail; const blocks = $('exportStateBlocks'); if (blocks) blocks.textContent = progressBlocks(progress); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function ext(name) { return name.split('.').pop().toLowerCase(); }
function downloadUrl(data, filename) { const a = document.createElement('a'); a.href = data; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); }
function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob); downloadUrl(url, filename); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
function frameById(id) { return state.frames.find(f => f.id === id); }
function ensureAnimationIdentity(anim, index = 0) { if (!anim.id) anim.id = `animation-${index + 1}-${crypto.randomUUID()}`; if (!anim.playMode) anim.playMode = anim.motion?.loop === 'once' ? 'once' : 'loop'; return anim; }
function ensureAnimationOrder() { state.animations.forEach((anim, index) => ensureAnimationIdentity(anim, index)); const ids = new Set(state.animations.map(anim => anim.id)); const existing = Array.isArray(state.animationOrder) ? state.animationOrder.filter(id => ids.has(id)) : []; state.animationOrder = [...existing, ...state.animations.map(anim => anim.id).filter(id => !existing.includes(id))]; return state.animationOrder; }
function orderedAnimations() { const byId = new Map(state.animations.map((anim, index) => [ensureAnimationIdentity(anim, index).id, anim])); return ensureAnimationOrder().map(id => byId.get(id)).filter(Boolean); }
function animationIndex(anim) { return state.animations.indexOf(anim); }
function activeFrames() { return state.animations[state.activeAnimation]?.frameIds.map(frameById).filter(Boolean) || state.frames; }
function previewFrames() { const layer = activeLayer(); const frames = layerFrames(layer); return frames.length ? frames : activeFrames(); }
function displayedFrames() {
  const frames = activeFrames();
  const layer = ensureLayers().find(item => item.id === state.activeLayerId);
  if (!layer || !Array.isArray(layer.frameIds) || !layer.frameIds.length) return frames;
  const ids = new Set(layer.frameIds);
  return frames.filter(frame => ids.has(frame.id));
}
function defaultLayers() { return []; }
function ensureLayers(anim = activeAnimation()) { if (anim && !Array.isArray(anim.layers)) anim.layers = defaultLayers(); return anim?.layers || []; }
function frameLayerState(frame, layer) { if (!frame.layerState) frame.layerState = {}; if (!frame.layerState[layer.id]) frame.layerState[layer.id] = { visible: true, opacity: 1 }; return frame.layerState[layer.id]; }
function cloneMotion(motion = defaultMotion()) { return { ...defaultMotion(), ...motion }; }
function ensureLayerSettings(layer) { if (!layer) return null; if (!layer.motion) layer.motion = cloneMotion(activeAnimation()?.motion || defaultMotion()); if (!Number.isFinite(Number(layer.scale))) layer.scale = state.scale; if (!Number.isFinite(Number(layer.fps))) layer.fps = state.fps; if (typeof layer.motionEnabled !== 'boolean') layer.motionEnabled = true; if (!Number.isFinite(Number(layer.motionAmount))) layer.motionAmount = 1; if (!Number.isFinite(Number(layer.x))) layer.x = 0; if (!Number.isFinite(Number(layer.y))) layer.y = 0; return layer; }
function activeLayer() { const layers = ensureLayers(); return ensureLayerSettings(layers.find(item => item.id === state.activeLayerId)); }
function layerFrames(layer) { const ids = Array.isArray(layer?.frameIds) ? layer.frameIds : []; return ids.map(frameById).filter(Boolean); }
function layerFrameAt(layer, index) { const frames = layerFrames(layer); if (!frames.length) return null; const safeIndex = Math.max(0, Number(index) || 0); return layer?.mode === 'persistent' ? frames[safeIndex % frames.length] : frames[Math.min(safeIndex, frames.length - 1)]; }
function selectedLayers() { const layers = ensureLayers().filter(layer => layer.visible); const selected = state.selectedLayerIds?.size ? layers.filter(layer => state.selectedLayerIds.has(layer.id)) : []; if (state.exportLayerScope === 'all') return layers; return selected.length ? selected : (activeLayer() ? [activeLayer()] : layers); }
function sheetLayer(sheetId, anim = activeAnimation()) { const sheet = state.sheets.find(item => item.id === sheetId); if (!sheet) return null; const layers = ensureLayers(anim); let layer = layers.find(item => item.sheetId === sheetId); if (!layer) { layer = { id: `sheet-layer-${sheetId}`, name: sheet.name.replace(/\.[^.]+$/, ''), mode: 'sequence', visible: true, opacity: 1, x: 0, y: 0, sheetId, frameIds: [] }; ensureLayerSettings(layer); layers.push(layer); } return ensureLayerSettings(layer); }
function frameVisible(frame, layer = null) { const source = layer || ensureLayers().find(item => item.sheetId === frame.sourceSheetId); return !source || (source.visible && frameLayerState(frame, source).visible); }
function compositionEntries() {
  const frames = activeFrames(); const layers = ensureLayers(); const entries = [];
  layers.filter(layer => layer.sheetId && layer.visible && Array.isArray(layer.frameIds) && layer.frameIds.length).forEach(layer => {
    const ids = layer.frameIds.map(frameById).filter(Boolean); if (!ids.length) return;
    const frame = layerFrameAt(layer, state.playIndex); if (frame && frameVisible(frame, layer)) entries.push({ frame, layer });
  });
  const hasLayerFrames = layers.some(layer => layer.sheetId && Array.isArray(layer.frameIds) && layer.frameIds.length);
  if (!entries.length && !hasLayerFrames && frames.length) { const frame = frames[clamp(state.playIndex, 0, frames.length - 1)]; if (frameVisible(frame)) entries.push({ frame, layer: null }); }
  return entries;
}
function defaultMotion() { return { mode: 'static', loop: 'static', startX: 0, startY: 0, endX: 0, endY: 0, height: 0, padding: 10, pixelSnap: true }; }
function activeAnimation() { const anim = state.animations[state.activeAnimation]; if (anim) { ensureAnimationIdentity(anim, state.activeAnimation); if (!anim.motion) anim.motion = defaultMotion(); ensureLayers(anim); ensureAnimationOrder(); } return anim; }
function motionConfig() { return activeLayer()?.motion || activeAnimation()?.motion || defaultMotion(); }
function motionFrames() { return layerFrames(activeLayer()).length ? layerFrames(activeLayer()) : activeFrames(); }
function averageCharacterWidth() { const frames = motionFrames(); return frames.length ? Math.max(1, Math.round(frames.reduce((sum, f) => sum + f.w, 0) / frames.length)) : 1; }
function averageCharacterHeight() { const frames = motionFrames(); return frames.length ? Math.max(1, Math.round(frames.reduce((sum, f) => sum + f.h, 0) / frames.length)) : 1; }
function motionPixelHeight(motion = motionConfig(), layer = activeLayer()) { const frames = layerFrames(layer); const height = frames.length ? Math.max(1, Math.round(frames.reduce((sum, frame) => sum + frame.h, 0) / frames.length)) : averageCharacterHeight(); return Math.max(0, Number(motion.height) || 0) * height; }
function motionPosition(t, motion = motionConfig(), layer = activeLayer()) { if (!motion || motion.mode === 'static') return { x: 0, y: 0 }; const p = Math.max(0, Math.min(1, t)); const x = motion.startX + (motion.endX - motion.startX) * p; let y = motion.startY + (motion.endY - motion.startY) * p; if (motion.mode === 'jump') y -= 4 * motionPixelHeight(motion, layer) * p * (1 - p); if (motion.mode === 'custom') { const cx = Number.isFinite(motion.controlX) ? motion.controlX : (motion.startX + motion.endX) / 2; const cy = Number.isFinite(motion.controlY) ? motion.controlY : (motion.startY + motion.endY) / 2; return { x: (1 - p) * (1 - p) * motion.startX + 2 * (1 - p) * p * cx + p * p * motion.endX, y: (1 - p) * (1 - p) * motion.startY + 2 * (1 - p) * p * cy + p * p * motion.endY }; } return { x, y }; }
function simpleMotionAmount(layer = activeLayer()) { return (layer ? layer.motionEnabled : state.motionEnabled) ? Math.max(0, Number(layer ? layer.motionAmount : state.motionAmount) || 0) : 0; }
function simpleMotionOffset(t, layer = activeLayer()) { const amount = simpleMotionAmount(layer); if (!amount) return { x: 0, y: 0 }; const phase = Math.max(0, Math.min(1, t)) * Math.PI * 2; return { x: Math.round(Math.sin(phase) * amount), y: Math.round(Math.sin(phase * 2) * Math.min(1, amount * 0.5)) }; }
function layerMotionPosition(t, layer = null) { const motion = layer?.motion || motionConfig(); const base = motionPosition(t, motion, layer); const nudge = simpleMotionOffset(t, layer); return { x: base.x + nudge.x, y: base.y + nudge.y }; }
function previewMotionPosition(t) { return layerMotionPosition(t, activeLayer()); }
function previewMotionT() { const frames = previewFrames(); if (!frames.length) return 0; return frames.length > 1 ? clamp(state.motionProgress, 0, 1) : 1; }

function renderSpriteLibrary() {
  const list = $('spriteSheetLibrary'); if (!list) return;
  list.innerHTML = '';
  list.classList.add('sheet-name-list');
  state.sheets.forEach((sheet, i) => {
    const slot = document.createElement('div'); slot.className = `sheet-slot sheet-name-item${sheet.id === state.activeSheetId ? ' active' : ''}`; slot.setAttribute('role', 'button'); slot.tabIndex = 0;
    slot.title = `切换到 ${sheet.name}`;
    const number = document.createElement('span'); number.className = 'sheet-slot-number'; number.textContent = String(i + 1).padStart(2, '0');
    const name = document.createElement('span'); name.className = 'sheet-slot-name'; name.textContent = sheet.name.replace(/\.[^.]+$/, '');
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'sheet-slot-remove'; remove.title = '移除这张精灵图'; remove.textContent = '×';
    remove.addEventListener('click', event => { event.stopPropagation(); removeSpriteSheet(sheet.id); });
    slot.append(number, name, remove); slot.addEventListener('click', () => activateSpriteSheet(sheet.id)); slot.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateSpriteSheet(sheet.id); } }); list.appendChild(slot);
  });
  const count = $('spriteLibraryMeta'); if (count) count.textContent = `${state.sheets.length} / 20`;
}
function activateSpriteSheet(id) {
  const sheet = state.sheets.find(item => item.id === id); if (!sheet) return;
  state.activeSheetId = id; setImage(sheet.image, sheet.name, id); renderSpriteLibrary();
}
function removeSpriteSheet(id) {
  const index = state.sheets.findIndex(item => item.id === id); if (index < 0) return;
  state.animations.forEach(anim => { if (Array.isArray(anim.layers)) anim.layers = anim.layers.filter(layer => layer.sheetId !== id); });
  state.sheets.splice(index, 1); const next = state.sheets[Math.min(index, state.sheets.length - 1)];
  if (next) activateSpriteSheet(next.id); else { state.activeSheetId = null; state.image = null; state.selection = null; state.detectedBoxes = []; sheetCanvas.hidden = true; $('sheetEmpty').hidden = false; $('sheetName').textContent = '未导入图片'; $('sheetMeta').textContent = '支持 PNG / GIF / WebP'; }
  renderSpriteLibrary(); toast('已从素材库移除精灵图');
}
function addSpriteSheet(img, name, notify = true) {
  const existing = state.sheets.find(item => item.url === img.src && item.name === name);
  if (existing) return activateSpriteSheet(existing.id);
  if (state.sheets.length >= 20) return toast('素材库最多同时保留 20 张精灵图');
  const sheet = { id: crypto.randomUUID(), image: img, name, url: img.src };
  state.sheets.push(sheet); activateSpriteSheet(sheet.id); renderLayers(); if (notify) toast(`已加入素材库 ${state.sheets.length} / 20`);
}
function setImage(img, name, sheetId = state.activeSheetId) {
  state.image = img; state.imageName = name; state.imageUrl = img.src; state.activeSheetId = sheetId;
  sheetCanvas.hidden = false; $('sheetEmpty').hidden = true;
  sheetCanvas.width = img.naturalWidth; sheetCanvas.height = img.naturalHeight; syncSheetZoom();
  state.imageData = null; state.selection = null; state.detectedBoxes = [];
  sheetCtx.imageSmoothingEnabled = false; sheetCtx.drawImage(img, 0, 0);
  const sheet = state.sheets.find(item => item.id === sheetId);
  state.backgroundProfile = sheet?.backgroundProfile || detectBackgroundProfile(img, name);
  if (sheet) sheet.backgroundProfile = state.backgroundProfile;
  state.bgColor = [...state.backgroundProfile.background];
  if ($('backgroundKeyMode')) $('backgroundKeyMode').textContent = state.backgroundProfile.mode === 'exact' ? 'EXACT' : 'CONNECTED';
  if ($('backgroundViewMode')) $('backgroundViewMode').value = state.backgroundView;
  $('sheetName').textContent = name; $('sheetMeta').textContent = `${img.naturalWidth} × ${img.naturalHeight} · ${state.backgroundProfile.mode === 'exact' ? 'EXACT 背景键' : '连通容差背景键'}`;
  $('addFrame').disabled = true; $('resetSelection').disabled = false; setTaskStatus('READY', '素材已载入', 1); drawSheet(); renderSpriteLibrary();
}

function syncSheetZoom() { const zoom = clamp(Number(state.sheetZoom) || 1, .25, 6); state.sheetZoom = zoom; if (sheetCanvas && state.image) { sheetCanvas.style.width = `${Math.round(state.image.naturalWidth * zoom)}px`; sheetCanvas.style.height = `${Math.round(state.image.naturalHeight * zoom)}px`; sheetCanvas.style.maxWidth = 'none'; } if ($('sheetZoomLabel')) $('sheetZoomLabel').textContent = `${Math.round(zoom * 100)}%`; }

function loadUrl(url, name, notify = true) { return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => { addSpriteSheet(img, name, notify); resolve(img); }; img.onerror = () => { toast(`素材加载失败：${name}`); reject(new Error(name)); }; img.src = url; }); }
function loadFiles(files) { [...files].slice(0, Math.max(0, 20 - state.sheets.length)).forEach(file => { const reader = new FileReader(); reader.onload = () => loadUrl(reader.result, file.name); reader.readAsDataURL(file); }); }
const builtinSprites = [
  ['隆_Ryu_完整精灵图.png', '隆_Ryu_完整精灵图.png'],
  ['肯_Ken_完整精灵图.png', '肯_Ken_完整精灵图.png'],
  ['春丽_ChunLi_完整精灵图.png', '春丽_ChunLi_完整精灵图.png'],
  ['古烈_Guile_完整精灵图.png', '古烈_Guile_完整精灵图.png'],
  ['布兰卡_Blanka_完整精灵图.png', '布兰卡_Blanka_完整精灵图.png'],
  ['达尔锡_Dhalsim_完整精灵图.png', '达尔锡_Dhalsim_完整精灵图.png'],
  ['本田_EHonda_完整精灵图.png', '本田_EHonda_完整精灵图.png'],
  ['桑吉尔夫_Zangief_完整精灵图.png', '桑吉尔夫_Zangief_完整精灵图.png'],
  ['拜森_Balrog_完整精灵图.png', '拜森_Balrog_完整精灵图.png'],
  ['巴洛克_Vega_带武器精灵图.png', '巴洛克_Vega_带武器精灵图.png'],
  ['巴洛克_Vega_无爪精灵图.png', '巴洛克_Vega_无爪精灵图.png'],
  ['沙加特_Sagat_完整精灵图.gif', '沙加特_Sagat_完整精灵图.gif'],
  ['维加_MBison_完整精灵图.png', '维加_MBison_完整精灵图.png']
];
async function loadBuiltinLibrary() { await Promise.allSettled(builtinSprites.map(([file, name]) => loadUrl(`/assets/${file}`, name, false))); const ryu = state.sheets.find(sheet => sheet.name === '隆_Ryu_完整精灵图.png'); if (ryu) activateSpriteSheet(ryu.id); toast(`内置精灵图库已载入 ${state.sheets.length} 张`); }

function drawSheet() {
  if (!state.image) return;
  sheetCtx.clearRect(0, 0, sheetCanvas.width, sheetCanvas.height);
  if (state.backgroundView === 'original') sheetCtx.drawImage(state.image, 0, 0);
  else {
    const source = document.createElement('canvas'); source.width = sheetCanvas.width; source.height = sheetCanvas.height; const sourceCtx = source.getContext('2d', { willReadFrequently: true }); sourceCtx.imageSmoothingEnabled = false; sourceCtx.drawImage(state.image, 0, 0); const result = removeSpriteBackground(sourceCtx.getImageData(0, 0, source.width, source.height), state.backgroundProfile); const cleaned = result.imageData;
    if (state.backgroundView === 'mask') { const mask = sheetCtx.createImageData(source.width, source.height); for (let i = 0; i < source.width * source.height; i++) { const value = cleaned.data[i * 4 + 3]; mask.data[i * 4] = value; mask.data[i * 4 + 1] = value; mask.data[i * 4 + 2] = value; mask.data[i * 4 + 3] = 255; } sheetCtx.putImageData(mask, 0, 0); }
    else sheetCtx.putImageData(cleaned, 0, 0);
  }
  const s = state.selection;
  if (state.detectedBoxes.length) {
    sheetCtx.save(); sheetCtx.lineWidth = Math.max(2, sheetCanvas.width / 720); sheetCtx.font = `${Math.max(13, sheetCanvas.width / 82)}px sans-serif`;
    state.detectedBoxes.forEach((box, i) => { sheetCtx.fillStyle = 'rgba(88,209,167,.08)'; sheetCtx.fillRect(box.x, box.y, box.w, box.h); sheetCtx.strokeStyle = '#58d1a7'; sheetCtx.strokeRect(box.x + .5, box.y + .5, box.w, box.h); sheetCtx.fillStyle = '#58d1a7'; sheetCtx.fillText(String(i + 1).padStart(2, '0'), box.x + 4, box.y + Math.max(15, sheetCanvas.width / 90)); });
    sheetCtx.restore();
  }
  if (s) {
    sheetCtx.save(); sheetCtx.fillStyle = 'rgba(240,189,79,.12)'; sheetCtx.fillRect(s.x, s.y, s.w, s.h);
    sheetCtx.strokeStyle = '#f0bd4f'; sheetCtx.lineWidth = Math.max(2, sheetCanvas.width / 600); sheetCtx.setLineDash([8, 5]); sheetCtx.strokeRect(s.x + .5, s.y + .5, s.w, s.h); sheetCtx.setLineDash([]);
    sheetCtx.fillStyle = '#f0bd4f'; sheetCtx.font = `${Math.max(13, sheetCanvas.width / 75)}px sans-serif`; sheetCtx.fillText(`${s.w} × ${s.h}`, s.x + 7, Math.max(17, s.y - 7)); sheetCtx.restore();
  }
  $('selectionReadout').textContent = s ? `${s.w} × ${s.h} px` : '未选择';
}

function canvasPoint(event) {
  const rect = sheetCanvas.getBoundingClientRect();
  return { x: clamp(Math.round((event.clientX - rect.left) * sheetCanvas.width / rect.width), 0, sheetCanvas.width), y: clamp(Math.round((event.clientY - rect.top) * sheetCanvas.height / rect.height), 0, sheetCanvas.height) };
}
let pointerStart = null;
const sheetStage = $('sheetStage');
sheetCanvas.addEventListener('pointerdown', (e) => {
  if (!state.image) return;
  if (state.backgroundPicking && e.button === 0) {
    const point = canvasPoint(e); const picker = document.createElement('canvas'); picker.width = picker.height = 1; const pickerCtx = picker.getContext('2d', { willReadFrequently: true }); pickerCtx.drawImage(state.image, point.x, point.y, 1, 1, 0, 0, 1, 1); const sample = pickerCtx.getImageData(0, 0, 1, 1).data; const profile = { ...(state.backgroundProfile || {}), mode: 'exact', background: [sample[0], sample[1], sample[2]], tolerance: 0, source: state.imageName.replace(/\.[^.]+$/, '') }; state.backgroundProfile = profile; state.bgColor = [...profile.background]; const sheet = state.sheets.find(item => item.id === state.activeSheetId); if (sheet) sheet.backgroundProfile = profile; state.backgroundPicking = false; sheetCanvas.style.cursor = 'crosshair'; if ($('backgroundKeyMode')) $('backgroundKeyMode').textContent = 'EXACT'; $('sheetMeta').textContent = `${state.image.naturalWidth} × ${state.image.naturalHeight} · EXACT 背景键`; if (activeFrames().length) reprocessFrames(true); drawSheet(); toast(`背景色已设为 RGB(${sample[0]}, ${sample[1]}, ${sample[2]})`); return;
  }
  const stage = $('sheetStage');
  if (e.button === 1 || state.spacePressed) {
    e.preventDefault(); sheetCanvas.setPointerCapture(e.pointerId); state.sheetPanning = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, scrollLeft: stage.scrollLeft, scrollTop: stage.scrollTop }; sheetCanvas.style.cursor = 'grabbing'; return;
  }
  if (e.button !== 0) return;
  sheetCanvas.setPointerCapture(e.pointerId); pointerStart = canvasPoint(e); state.detectedBoxes = []; state.selection = { x: pointerStart.x, y: pointerStart.y, w: 1, h: 1 }; drawSheet();
});
sheetCanvas.addEventListener('pointermove', (e) => {
  if (state.sheetPanning) { const stage = $('sheetStage'); stage.scrollLeft = state.sheetPanning.scrollLeft - (e.clientX - state.sheetPanning.startX); stage.scrollTop = state.sheetPanning.scrollTop - (e.clientY - state.sheetPanning.startY); return; }
  if (!pointerStart) return; const p = canvasPoint(e); let x = Math.min(pointerStart.x, p.x), y = Math.min(pointerStart.y, p.y), w = Math.abs(p.x - pointerStart.x), h = Math.abs(p.y - pointerStart.y); if (e.shiftKey) { const side = Math.max(w, h); w = side; h = side; x = pointerStart.x < p.x ? pointerStart.x : pointerStart.x - side; y = pointerStart.y < p.y ? pointerStart.y : pointerStart.y - side; } state.selection = { x, y, w: Math.max(1, w), h: Math.max(1, h) }; drawSheet();
});
const endSheetPointer = () => { if (state.sheetPanning) { state.sheetPanning = null; sheetCanvas.style.cursor = 'crosshair'; return; } pointerStart = null; state.detectedBoxes = []; const valid = !!state.selection && state.selection.w >= 2 && state.selection.h >= 2; $('addFrame').disabled = !valid; $('generateAction').disabled = !valid; $('newLayerAnimation').disabled = !valid; $('appendAction').disabled = !valid; drawSheet(); };
sheetCanvas.addEventListener('pointerup', endSheetPointer); sheetCanvas.addEventListener('pointercancel', endSheetPointer);
sheetStage.addEventListener('pointerenter', () => { state.sheetPointerInside = true; }); sheetStage.addEventListener('pointerleave', () => { state.sheetPointerInside = false; if (!state.sheetPanning && !state.spacePressed) sheetCanvas.style.cursor = 'crosshair'; });
// Space is a sheet-pan modifier only while the pointer is over the sheet. Capture
// it before focused buttons receive the browser's implicit Space click.
window.addEventListener('keydown', event => {
  if (event.code !== 'Space' || !state.sheetPointerInside || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
  if (event.repeat || state.spacePressed) return;
  state.spacePressed = true; sheetCanvas.style.cursor = 'grab';
}, true);
window.addEventListener('keyup', event => {
  if (event.code !== 'Space' || !state.spacePressed) return;
  event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
  state.spacePressed = false; if (!state.sheetPanning) sheetCanvas.style.cursor = 'crosshair';
}, true);
sheetStage.addEventListener('wheel', event => {
  if (!state.image) return; event.preventDefault(); const rect = sheetStage.getBoundingClientRect(); const oldZoom = state.sheetZoom; const nextZoom = clamp(oldZoom * Math.pow(1.0018, -event.deltaY), .25, 6); if (nextZoom === oldZoom) return; const localX = event.clientX - rect.left + sheetStage.scrollLeft; const localY = event.clientY - rect.top + sheetStage.scrollTop; state.sheetZoom = nextZoom; syncSheetZoom(); sheetStage.scrollLeft = Math.max(0, localX * nextZoom / oldZoom - (event.clientX - rect.left)); sheetStage.scrollTop = Math.max(0, localY * nextZoom / oldZoom - (event.clientY - rect.top)); }, { passive: false });

function legacyCropFrame(s) {
  const c = document.createElement('canvas'); c.width = Math.max(1, s.w); c.height = Math.max(1, s.h); const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingEnabled = false; ctx.drawImage(state.image, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
  const pixels = ctx.getImageData(0, 0, c.width, c.height); const d = pixels.data; const bg = state.bgColor;
  { const seed = [d[0], d[1], d[2]]; const visited = new Uint8Array(c.width * c.height); const queue = []; const similar = (x, y) => { const i = (y * c.width + x) * 4; if (d[i + 3] < 8) return false; const toSeed = Math.abs(d[i] - seed[0]) + Math.abs(d[i + 1] - seed[1]) + Math.abs(d[i + 2] - seed[2]); const toConfigured = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]); return toSeed < 42 || toConfigured < 42; }; const add = (x, y) => { const n = y * c.width + x; if (!visited[n] && similar(x, y)) { visited[n] = 1; queue.push([x, y]); } }; for (let x = 0; x < c.width; x++) { add(x, 0); add(x, c.height - 1); } for (let y = 0; y < c.height; y++) { add(0, y); add(c.width - 1, y); } while (queue.length) { const [x, y] = queue.pop(); d[(y * c.width + x) * 4 + 3] = 0; for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) if (nx >= 0 && ny >= 0 && nx < c.width && ny < c.height) add(nx, ny); } }
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { if (d[(y * c.width + x) * 4 + 3] > 8) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); } }
  if (maxX < 0) { const empty = document.createElement('canvas'); empty.width = empty.height = 1; return { canvas: empty, dataUrl: empty.toDataURL('image/png'), anchor: { x: 0, y: 0 } }; }
  ctx.putImageData(pixels, 0, 0); const trimmed = document.createElement('canvas'); trimmed.width = maxX - minX + 1; trimmed.height = maxY - minY + 1; const trimCtx = trimmed.getContext('2d'); trimCtx.imageSmoothingEnabled = false; trimCtx.putImageData(ctx.getImageData(minX, minY, trimmed.width, trimmed.height), 0, 0);
  return { canvas: trimmed, dataUrl: trimmed.toDataURL('image/png'), anchor: { x: Math.round((minX + maxX) / 2) - minX, y: maxY - minY } };
}

function legacyCropFrameImproved(s) {
  const c = document.createElement('canvas'); c.width = Math.max(1, s.w); c.height = Math.max(1, s.h);
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingEnabled = false; ctx.drawImage(state.image, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
  const pixels = ctx.getImageData(0, 0, c.width, c.height); const d = pixels.data; const configured = state.bgColor || [75, 115, 110];
  const cleanup = state.backgroundCleanup || {};
  const edgeColors = []; const edgeStep = Math.max(1, Math.floor(Math.max(c.width, c.height) / 32));
  const collectEdge = (x, y) => { const i = (y * c.width + x) * 4; if (d[i + 3] >= 8) edgeColors.push([d[i], d[i + 1], d[i + 2]]); };
  for (let x = 0; x < c.width; x += edgeStep) { collectEdge(x, 0); collectEdge(x, c.height - 1); }
  for (let y = 0; y < c.height; y += edgeStep) { collectEdge(0, y); collectEdge(c.width - 1, y); }
  const medianChannel = channel => { const values = edgeColors.map(color => color[channel]).sort((a, b) => a - b); return values.length ? values[Math.floor(values.length / 2)] : configured[channel]; };
  const distance = (r, g, b, color) => Math.hypot(r - color[0], g - color[1], b - color[2]);
  const edgeMedian = [medianChannel(0), medianChannel(1), medianChannel(2)];
  const borderSamples = [];
  [[0, 0], [c.width - 1, 0], [0, c.height - 1], [c.width - 1, c.height - 1], [Math.floor(c.width / 2), 0], [Math.floor(c.width / 2), c.height - 1]].forEach(([x, y]) => { const i = (y * c.width + x) * 4; if (d[i + 3] >= 8) borderSamples.push([d[i], d[i + 1], d[i + 2]]); });
  const firstPixel = [d[0], d[1], d[2]];
  const references = [configured, edgeMedian];
  if (distance(firstPixel[0], firstPixel[1], firstPixel[2], configured) <= 80) references.push(firstPixel);
  const nearestBackgroundDistance = (r, g, b) => Math.min(...references.map(color => distance(r, g, b, color)));
  const floodReferences = [...references, ...borderSamples];
  const nearestFloodDistance = (r, g, b) => Math.min(...floodReferences.map(color => distance(r, g, b, color)));
  const floodThreshold = clamp(Number(cleanup.edgeTolerance) || 36, 0, 120);
  const haloThreshold = clamp(Number(cleanup.haloTolerance) || 48, 1, 160);
  const hardThreshold = clamp(Number(cleanup.hardTolerance) || 16, 0, haloThreshold - 1);
  const bottomThreshold = clamp(Number(cleanup.bottomTolerance) || 28, 0, 120);
  const eraseConnected = (seeds, similar) => {
    const visited = new Uint8Array(c.width * c.height); const queue = [];
    const add = (x, y) => { if (x < 0 || y < 0 || x >= c.width || y >= c.height) return; const n = y * c.width + x; if (!visited[n] && similar(x, y)) { visited[n] = 1; queue.push([x, y]); } };
    seeds.forEach(([x, y]) => add(x, y));
    while (queue.length) { const [x, y] = queue.pop(); d[(y * c.width + x) * 4 + 3] = 0; for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) add(nx, ny); }
  };
  if (cleanup.enabled !== false) {
    const edgeSeeds = [];
    for (let x = 0; x < c.width; x++) { edgeSeeds.push([x, 0], [x, c.height - 1]); }
    for (let y = 0; y < c.height; y++) edgeSeeds.push([0, y], [c.width - 1, y]);
    eraseConnected(edgeSeeds, (x, y) => { const i = (y * c.width + x) * 4; return d[i + 3] >= 8 && nearestFloodDistance(d[i], d[i + 1], d[i + 2]) <= floodThreshold; });

    if (cleanup.bottomEnabled !== false && c.height > 1) {
      const bottomColors = [];
      for (let x = 0; x < c.width; x += edgeStep) {
        const isCornerBand = x < Math.max(2, Math.floor(c.width * .22)) || x >= Math.floor(c.width * .78);
        if (!isCornerBand) continue;
        for (let row = Math.max(0, c.height - Math.min(3, c.height)); row < c.height; row++) {
          const i = (row * c.width + x) * 4; if (d[i + 3] >= 8) bottomColors.push([d[i], d[i + 1], d[i + 2]]);
        }
      }
      const bottomMedian = [0, 1, 2].map(channel => { const values = bottomColors.map(color => color[channel]).sort((a, b) => a - b); return values.length ? values[Math.floor(values.length / 2)] : edgeMedian[channel]; });
      const bottomSeeds = []; for (let x = 0; x < c.width; x++) bottomSeeds.push([x, c.height - 1]);
      eraseConnected(bottomSeeds, (x, y) => { const i = (y * c.width + x) * 4; return d[i + 3] >= 8 && distance(d[i], d[i + 1], d[i + 2], bottomMedian) <= bottomThreshold; });
    }

    // Remove only low, wide accent strips such as the green floor/shadow in
    // arcade sheets. Character bodies are normally taller and therefore stay.
    const floorStart = Math.floor(c.height * .66); const accentContrast = clamp(76 - bottomThreshold, 18, 76); const accentVisited = new Uint8Array(c.width * c.height);
    const isAccent = (x, y) => { if (y < floorStart) return false; const i = (y * c.width + x) * 4; if (d[i + 3] < 8) return false; const r = d[i], g = d[i + 1], b = d[i + 2]; const gap = nearestBackgroundDistance(r, g, b); if (gap < accentContrast) return false; const greenish = g > r + 28 && g > b + 24 && g < 195 && r < 105 && b < 105; const darkChroma = Math.max(r, g, b) < 135 && Math.max(r, g, b) - Math.min(r, g, b) > 30; return greenish || darkChroma; };
    for (let y = floorStart; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const seed = y * c.width + x; if (accentVisited[seed] || !isAccent(x, y)) continue; const queue = [[x, y]]; accentVisited[seed] = 1; const pixelsInComponent = []; let minX = x, maxX = x, minY = y, maxY = y, touchesBottom = false, edgeNeighbors = 0;
      while (queue.length) { const [cx, cy] = queue.pop(); pixelsInComponent.push([cx, cy]); minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy); if (cy === c.height - 1) touchesBottom = true; for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1], [cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1], [cx + 1, cy + 1]]) { if (nx < 0 || ny < 0 || nx >= c.width || ny >= c.height) continue; if (d[(ny * c.width + nx) * 4 + 3] === 0) edgeNeighbors++; const n = ny * c.width + nx; if (!accentVisited[n] && isAccent(nx, ny)) { accentVisited[n] = 1; queue.push([nx, ny]); } } }
      const width = maxX - minX + 1, height = maxY - minY + 1; const wideEnough = width >= Math.max(5, Math.round(c.width * .06)) && width >= height * 1.5; const lowEnough = height <= Math.max(5, Math.round(c.height * .12)); const lowPosition = minY >= floorStart; const openOrLow = touchesBottom || edgeNeighbors >= pixelsInComponent.length * .18 || lowPosition; if (wideEnough && lowEnough && openOrLow) pixelsInComponent.forEach(([px, py]) => { d[(py * c.width + px) * 4 + 3] = 0; });
    }

    // A background-colored pocket can be fully enclosed by a pose (for example
    // blue between the legs). It never reaches the crop edge, so edge flood fill
    // cannot see it. Remove only small, uniform, enclosed background components;
    // large connected character regions remain untouched.
    const holeVisited = new Uint8Array(c.width * c.height);
    const holeThreshold = Math.min(haloThreshold, Math.max(floodThreshold, 34));
    const nearBackground = (x, y) => {
      const i = (y * c.width + x) * 4;
      return d[i + 3] >= 8 && nearestBackgroundDistance(d[i], d[i + 1], d[i + 2]) <= holeThreshold;
    };
    for (let y = 1; y < c.height - 1; y++) for (let x = 1; x < c.width - 1; x++) {
      const seed = y * c.width + x; if (holeVisited[seed] || !nearBackground(x, y)) continue;
      const queue = [[x, y]]; holeVisited[seed] = 1; const component = []; let touchesEdge = false;
      while (queue.length) {
        const [cx, cy] = queue.pop(); component.push([cx, cy]);
        if (cx === 0 || cy === 0 || cx === c.width - 1 || cy === c.height - 1) touchesEdge = true;
        for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
          if (nx < 0 || ny < 0 || nx >= c.width || ny >= c.height) continue;
          const n = ny * c.width + nx; if (!holeVisited[n] && nearBackground(nx, ny)) { holeVisited[n] = 1; queue.push([nx, ny]); }
        }
      }
      const enclosed = !touchesEdge; const areaLimit = Math.max(12, Math.floor(c.width * c.height * .08));
      if (enclosed && component.length <= areaLimit) component.forEach(([px, py]) => { d[(py * c.width + px) * 4 + 3] = 0; });
    }
  }
  if (cleanup.enabled !== false) for (let y = 1; y < c.height - 1; y++) for (let x = 1; x < c.width - 1; x++) {
    const i = (y * c.width + x) * 4; if (d[i + 3] === 0) continue;
    let nextToTransparent = false;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1], [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]]) if (d[(ny * c.width + nx) * 4 + 3] === 0) { nextToTransparent = true; break; }
    if (!nextToTransparent) continue;
    const colorDistance = nearestBackgroundDistance(d[i], d[i + 1], d[i + 2]);
    if (colorDistance <= hardThreshold) d[i + 3] = 0;
    else if (colorDistance < haloThreshold) d[i + 3] = Math.min(d[i + 3], Math.round((colorDistance - hardThreshold) / (haloThreshold - hardThreshold) * 255));
  }
  ctx.putImageData(pixels, 0, 0);
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { if (d[(y * c.width + x) * 4 + 3] > 8) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); } }
  if (maxX < 0) { const empty = document.createElement('canvas'); empty.width = empty.height = 1; return { canvas: empty, dataUrl: empty.toDataURL('image/png'), anchor: { x: 0, y: 0 } }; }
  const trimmed = document.createElement('canvas'); trimmed.width = maxX - minX + 1; trimmed.height = maxY - minY + 1; const trimCtx = trimmed.getContext('2d'); trimCtx.imageSmoothingEnabled = false; trimCtx.putImageData(ctx.getImageData(minX, minY, trimmed.width, trimmed.height), 0, 0);
  return { canvas: trimmed, dataUrl: trimmed.toDataURL('image/png'), anchor: { x: Math.round((minX + maxX) / 2) - minX, y: maxY - minY } };
}

function detectBackgroundProfile(image, name = '') {
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingEnabled = false; ctx.drawImage(image, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const histogram = new Map(); const samples = []; const add = (x, y) => { const i = (y * width + x) * 4; if (data[i + 3] < 8) return; const rgb = [data[i], data[i + 1], data[i + 2]]; const key = rgb.join(','); histogram.set(key, (histogram.get(key) || 0) + 1); samples.push(rgb); };
  const stride = Math.max(1, Math.floor(Math.max(width, height) / 320));
  for (let x = 0; x < width; x += stride) { add(x, 0); add(x, height - 1); }
  for (let y = stride; y < height - 1; y += stride) { add(0, y); add(width - 1, y); }
  const ranked = [...histogram.entries()].sort((a, b) => b[1] - a[1]);
  const background = ranked.length ? ranked[0][0].split(',').map(Number) : [0, 0, 0];
  const topCount = ranked.length ? ranked[0][1] : 0; const coverage = samples.length ? topCount / samples.length : 1;
  const unique = ranked.length; const ext = String(name).split('.').pop().toLowerCase();
  const lossless = ['png', 'gif', 'webp'].includes(ext);
  const mode = lossless && coverage >= .35 ? 'exact' : (coverage < .58 || unique > 48 ? 'connected-tolerant' : 'exact');
  return { mode, background, tolerance: mode === 'exact' ? 0 : 18, coverage, samples: samples.length, source: name.replace(/\.[^.]+$/, '') };
}

function removeSpriteBackground(imageData, profile = state.backgroundProfile) {
  const width = imageData.width, height = imageData.height, data = imageData.data;
  const background = profile?.background || state.bgColor || [0, 0, 0]; const mode = profile?.mode || 'exact'; const tolerance = mode === 'exact' ? 0 : Math.max(1, Number(profile?.tolerance) || 18);
  const mask = new Uint8Array(width * height); const distance = (i) => Math.hypot(data[i] - background[0], data[i + 1] - background[1], data[i + 2] - background[2]);
  const candidate = (x, y) => { const i = (y * width + x) * 4; return data[i + 3] >= 8 && (mode === 'exact' ? data[i] === background[0] && data[i + 1] === background[1] && data[i + 2] === background[2] : distance(i) <= tolerance); };
  if (mode === 'exact') {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; const keep = !candidate(x, y); mask[y * width + x] = keep ? 255 : 0; data[i + 3] = keep ? 255 : 0; }
  } else {
    const visited = new Uint8Array(width * height); const queue = []; const seed = (x, y) => { const n = y * width + x; if (!visited[n] && candidate(x, y)) { visited[n] = 1; queue.push([x, y]); } };
    for (let x = 0; x < width; x++) { seed(x, 0); seed(x, height - 1); }
    for (let y = 1; y < height - 1; y++) { seed(0, y); seed(width - 1, y); }
    while (queue.length) { const [x, y] = queue.pop(); const i = (y * width + x) * 4; data[i + 3] = 0; mask[y * width + x] = 0; for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) if (nx >= 0 && ny >= 0 && nx < width && ny < height) seed(nx, ny); }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; if (data[i + 3] !== 0) { data[i + 3] = 255; mask[y * width + x] = 255; } }
  }
  return { imageData, alphaMask: mask, backgroundColor: [...background], mode, diagnostics: { width, height, removed: mask.reduce((sum, value) => sum + (value === 0 ? 1 : 0), 0) } };
}

function cropFrameImproved(s) {
  const c = document.createElement('canvas'); c.width = Math.max(1, s.w); c.height = Math.max(1, s.h);
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingEnabled = false; ctx.drawImage(state.image, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
  // Background keying is the only destructive operation here. Do not run a
  // shape/text heuristic after keying: small poses, projectiles and 1px details
  // are valid sprite pixels and must survive the crop unchanged.
  const result = removeSpriteBackground(ctx.getImageData(0, 0, c.width, c.height), state.backgroundProfile); const pixels = result.imageData; const d = pixels.data;
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] === 255) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  if (maxX < 0) { const empty = document.createElement('canvas'); empty.width = empty.height = 1; return { canvas: empty, dataUrl: empty.toDataURL('image/png'), anchor: { x: 0, y: 0 } }; }
  ctx.putImageData(pixels, 0, 0); const trimmed = document.createElement('canvas'); trimmed.width = maxX - minX + 1; trimmed.height = maxY - minY + 1; const trimCtx = trimmed.getContext('2d'); trimCtx.imageSmoothingEnabled = false; trimCtx.putImageData(ctx.getImageData(minX, minY, trimmed.width, trimmed.height), 0, 0);
  return { canvas: trimmed, dataUrl: trimmed.toDataURL('image/png'), anchor: { x: Math.round((minX + maxX) / 2) - minX, y: maxY - minY } };
}

function createFrame(s) {
  const crop = cropFrameImproved(s); return { id: crypto.randomUUID(), sourceSheetId: state.activeSheetId, x: s.x, y: s.y, sourceW: s.w, sourceH: s.h, w: crop.canvas.width, h: crop.canvas.height, anchorX: crop.anchor.x, anchorY: crop.anchor.y, duration: 1, dataUrl: crop.dataUrl, canvas: crop.canvas };
}
function addFrame(s = state.selection, silent = false) {
  if (!state.image || !s || s.w < 2 || s.h < 2) return;
  const frame = createFrame(s); state.frames.push(frame); state.animations[state.activeAnimation].frameIds.push(frame.id); const layer = activeLayer() || sheetLayer(frame.sourceSheetId); if (layer) layer.frameIds = [...(layer.frameIds || []), frame.id]; state.selectedFrame = state.frames.length - 1; renderLayers(); renderFrames(); renderAnimations(); drawPreview(); if (!silent) toast(`已添加单帧，自动锚点：(${frame.anchorX}, ${frame.anchorY})`);
}

function frameThumb(frame, canvas) { const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, canvas.width, canvas.height); const pad = 4, scale = Math.min((canvas.width - pad * 2) / frame.w, (canvas.height - pad * 2) / frame.h); const w = frame.w * scale, h = frame.h * scale; ctx.drawImage(frame.canvas, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h); }
function frameGroupMembers(id) { const frame = frameById(id); if (!frame?.groupId) return [id]; return state.frames.filter(item => item.groupId === frame.groupId).map(item => item.id); }
function expandFrameIds(ids) { const expanded = new Set(ids); [...expanded].forEach(id => frameGroupMembers(id).forEach(member => expanded.add(member))); return expanded; }
function orderedFrameIds(ids, order = null) { const selected = new Set(ids); const fallback = state.frames.map(frame => frame.id); return (order || fallback).filter(id => selected.has(id)); }
function selectedFrameOrder() { const animation = state.animations[state.activeAnimation]; const layer = ensureLayers(animation).find(item => item.id === state.activeLayerId); const order = layer?.frameIds?.length ? layer.frameIds : animation?.frameIds; return orderedFrameIds(state.selectedFrameIds, order); }
function setSelectedFrameIds(ids, additive = false) { const next = additive ? new Set(state.selectedFrameIds) : new Set(); expandFrameIds(ids).forEach(id => next.add(id)); state.selectedFrameIds = next; }
function selectFrameForEdit(globalIndex, additive = false) { const frame = state.frames[globalIndex]; if (!frame) return; const isAdditive = additive === true; const groupIds = frameGroupMembers(frame.id); if (isAdditive && state.selectedFrameIds.has(frame.id)) { const next = new Set(state.selectedFrameIds); groupIds.forEach(id => next.delete(id)); state.selectedFrameIds = next; } else setSelectedFrameIds([frame.id], isAdditive); state.selectedFrame = globalIndex; renderTimelineGrid(); renderFrames(); drawPreview(); syncSelectionControls(); }
function syncSelectionControls() {
  const button = $('deleteSelectedFrames');
  if (!button) return;
  const count = state.selectedFrameIds.size;
  button.disabled = count === 0;
  button.textContent = count ? `删除所选帧（${count}）` : '删除所选帧';
  const selected = state.selectedFrameIds;
  const copy = $('copySelectedFrames'); if (copy) copy.disabled = selected.size === 0;
  const group = $('groupSelectedFrames'); if (group) group.disabled = selected.size < 2;
  const ungroup = $('ungroupSelectedFrames'); if (ungroup) ungroup.disabled = ![...selected].some(id => frameById(id)?.groupId);
}
function renderTimelineGrid() {
  const grid = $('timelineGrid'); if (!grid) return;
  const selectedLayerFrames = layerFrames(activeLayer()); const frames = selectedLayerFrames.length ? selectedLayerFrames : activeFrames(); const layers = ensureLayers(); grid.innerHTML = ''; grid.style.setProperty('--timeline-columns', frames.length || 1); if (!frames.length) return;
  const head = document.createElement('div'); head.className = 'timeline-row timeline-head'; head.appendChild(document.createElement('span'));
  frames.forEach((frame, index) => { const cell = document.createElement('button'); cell.type = 'button'; cell.className = `timeline-cell timeline-number${index === state.playIndex ? ' playhead' : ''}${state.frames.indexOf(frame) === state.selectedFrame ? ' editing' : ''}${state.selectedFrameIds.has(frame.id) ? ' multi-selected' : ''}`; cell.textContent = String(index + 1).padStart(2, '0'); cell.title = `编辑第 ${index + 1} 帧`; cell.addEventListener('click', event => selectFrameForEdit(state.frames.indexOf(frame), event.shiftKey || event.metaKey || event.ctrlKey)); head.appendChild(cell); }); grid.appendChild(head);
  layers.forEach(layer => { const row = document.createElement('div'); row.className = `timeline-row${layer.id === state.activeLayerId ? ' active' : ''}${state.selectedLayerIds.has(layer.id) ? ' selected' : ''}`; const label = document.createElement('button'); label.type = 'button'; label.className = 'timeline-row-label'; label.textContent = layer.name; label.title = `选择 ${layer.name}；Shift/Command 点击可多选`; label.addEventListener('click', event => { const additive = event.shiftKey || event.metaKey || event.ctrlKey; if (!additive) state.selectedLayerIds = new Set([layer.id]); else if (state.selectedLayerIds.has(layer.id)) state.selectedLayerIds.delete(layer.id); else state.selectedLayerIds.add(layer.id); state.activeLayerId = layer.id; state.playIndex = 0; state.motionProgress = 0; state.selectedFrameIds.clear(); syncMotionControls(); renderLayers(); renderFrames(); drawPreview(); }); row.appendChild(label); frames.forEach((frame, index) => { const cell = document.createElement('button'); cell.type = 'button'; const belongs = Array.isArray(layer.frameIds) && layer.frameIds.includes(frame.id); const frameState = frameLayerState(frame, layer); cell.className = `timeline-cell${belongs && frameState.visible && layer.visible ? ' filled' : ''}${index === state.playIndex ? ' playhead' : ''}${state.frames.indexOf(frame) === state.selectedFrame ? ' editing' : ''}${state.selectedFrameIds.has(frame.id) ? ' multi-selected' : ''}`; cell.textContent = belongs ? '●' : ''; cell.title = `${layer.name} · 第 ${index + 1} 帧`; cell.addEventListener('click', event => selectFrameForEdit(state.frames.indexOf(frame), event.shiftKey || event.metaKey || event.ctrlKey)); row.appendChild(cell); }); grid.appendChild(row); });
  const motion = document.createElement('div'); motion.className = 'timeline-row timeline-motion-row'; const motionLabel = document.createElement('span'); motionLabel.className = 'timeline-row-label'; motionLabel.textContent = 'Motion'; motion.appendChild(motionLabel); frames.forEach((frame, index) => { const cell = document.createElement('span'); cell.className = `timeline-cell motion-cell${index === state.playIndex ? ' playhead' : ''}`; cell.textContent = index === 0 || index === frames.length - 1 ? '●' : '·'; cell.title = `Motion · 第 ${index + 1} 帧`; motion.appendChild(cell); }); grid.appendChild(motion);
}
function renderLayers() {
  const list = $('layerList'); if (!list) return;
  const layers = ensureLayers(); list.innerHTML = '';
  layers.forEach((layer, index) => {
    ensureLayerSettings(layer); const row = document.createElement('div'); row.className = `layer-row layer-${layer.mode}${layer.id === state.activeLayerId ? ' active' : ''}${state.selectedLayerIds.has(layer.id) ? ' selected' : ''}`; row.dataset.id = layer.id;
    row.addEventListener('click', event => { if (event.target.closest('button,input,select')) return; const additive = event.shiftKey || event.metaKey || event.ctrlKey; if (!additive) state.selectedLayerIds = new Set([layer.id]); else if (state.selectedLayerIds.has(layer.id)) state.selectedLayerIds.delete(layer.id); else state.selectedLayerIds.add(layer.id); state.activeLayerId = layer.id; state.playIndex = 0; state.motionProgress = 0; state.selectedFrameIds.clear(); syncMotionControls(); renderLayers(); renderFrames(); drawPreview(); });
    const eye = document.createElement('button'); eye.type = 'button'; eye.className = 'layer-eye'; eye.textContent = layer.visible ? '◉' : '○'; eye.title = layer.visible ? '隐藏图层' : '显示图层'; eye.setAttribute('aria-label', eye.title);
    eye.addEventListener('click', () => { layer.visible = !layer.visible; renderLayers(); renderFrames(); drawPreview(); });
    const swatch = document.createElement('span'); swatch.className = 'layer-swatch'; swatch.textContent = String(index + 1).padStart(2, '0');
    const name = document.createElement('input'); name.className = 'layer-name'; name.value = layer.name; name.setAttribute('aria-label', '图层名称'); name.addEventListener('change', () => { layer.name = name.value.trim() || `图层 ${index + 1}`; renderLayers(); renderFrames(); });
    const mode = document.createElement('select'); mode.className = 'layer-mode'; mode.innerHTML = '<option value="persistent">始终循环</option><option value="sequence">跟随关键帧</option>'; mode.value = layer.mode; mode.addEventListener('change', () => { layer.mode = mode.value; renderLayers(); renderTimelineGrid(); renderFrames(); drawPreview(); });
    const x = document.createElement('input'); x.type = 'number'; x.className = 'layer-offset'; x.value = Number(layer.x) || 0; x.title = '图层 X 位移'; x.setAttribute('aria-label', `${layer.name} X 位移`); x.addEventListener('change', () => { layer.x = Number(x.value) || 0; drawPreview(); });
    const y = document.createElement('input'); y.type = 'number'; y.className = 'layer-offset'; y.value = Number(layer.y) || 0; y.title = '图层 Y 位移'; y.setAttribute('aria-label', `${layer.name} Y 位移`); y.addEventListener('change', () => { layer.y = Number(y.value) || 0; drawPreview(); });
    row.append(eye, swatch, name, mode, x, y); list.appendChild(row);
  });
  renderTimelineGrid();
}
function renderFrames() {
  const list = $('frameList'); list.innerHTML = ''; const frames = displayedFrames(); renderTimelineGrid(); if (!frames.length) { list.innerHTML = '<div class="frame-empty">当前时间轴还没有帧</div>'; updatePreviewMeta(); return; }
  const layers = ensureLayers();
  frames.forEach((frame, index) => { const globalIndex = state.frames.indexOf(frame); const card = document.createElement('article'); card.className = `frame-card${globalIndex === state.selectedFrame ? ' selected' : ''}${state.selectedFrameIds.has(frame.id) ? ' multi-selected' : ''}`; card.draggable = true; card.dataset.id = frame.id; card.title = '点击编辑；按住 Shift 多选'; const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 82; frameThumb(frame, canvas); const footer = document.createElement('footer'); footer.innerHTML = `<b>${String(index + 1).padStart(2, '0')}</b>`; const strip = document.createElement('div'); strip.className = 'frame-layer-strip'; layers.forEach(layer => { const stateForFrame = frameLayerState(frame, layer); const chip = document.createElement('button'); chip.type = 'button'; chip.className = `frame-layer-chip${stateForFrame.visible && layer.visible ? ' active' : ''}`; chip.textContent = String(layers.indexOf(layer) + 1); chip.title = `${layer.name} · ${layer.mode === 'persistent' ? '始终循环' : '跟随关键帧'}`; chip.addEventListener('click', event => { event.stopPropagation(); stateForFrame.visible = !stateForFrame.visible; chip.classList.toggle('active', stateForFrame.visible && layer.visible); renderTimelineGrid(); drawPreview(); }); strip.appendChild(chip); }); const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'frame-delete'; remove.textContent = '×'; remove.title = `删除第 ${index + 1} 帧`; remove.setAttribute('aria-label', remove.title); remove.addEventListener('click', event => { event.stopPropagation(); state.selectedFrameIds = new Set([frame.id]); deleteSelectedFrames(); }); card.append(canvas, footer, strip, remove); card.addEventListener('click', event => selectFrameForEdit(globalIndex, event.shiftKey)); card.addEventListener('dragstart', event => { const selected = state.selectedFrameIds.has(frame.id) ? frames.filter(item => state.selectedFrameIds.has(item.id)) : [frame]; state.dragFrames = selected.map(item => item.id); state.dragFrame = index; list.classList.add('frame-dragging'); card.classList.add('frame-drag-source'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', frame.id); }); card.addEventListener('dragend', () => { state.dragFrame = null; state.dragFrames = []; list.classList.remove('frame-dragging'); list.querySelectorAll('.frame-drop-target,.frame-drag-source').forEach(item => item.classList.remove('frame-drop-target', 'frame-drag-source')); }); card.addEventListener('dragenter', event => { event.preventDefault(); if (!card.classList.contains('frame-drag-source')) { list.querySelectorAll('.frame-drop-target').forEach(item => item.classList.remove('frame-drop-target')); card.classList.add('frame-drop-target'); } }); card.addEventListener('dragleave', event => { if (!card.contains(event.relatedTarget)) card.classList.remove('frame-drop-target'); }); card.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; if (!card.classList.contains('frame-drag-source')) { list.querySelectorAll('.frame-drop-target').forEach(item => item.classList.remove('frame-drop-target')); card.classList.add('frame-drop-target'); } }); card.addEventListener('drop', e => { e.preventDefault(); const to = index; const animation = state.animations[state.activeAnimation]; const layer = ensureLayers(animation).find(item => item.id === state.activeLayerId); const order = layer?.frameIds || animation.frameIds; const movingIds = (state.dragFrames?.length ? state.dragFrames : [frames[state.dragFrame]?.id]).filter(Boolean); const targetId = frames[to]?.id; if (!movingIds.length || !targetId || movingIds.includes(targetId)) return; const moving = new Set(movingIds); const remaining = order.filter(id => !moving.has(id)); const targetIndex = remaining.indexOf(targetId); if (targetIndex < 0) return; remaining.splice(targetIndex, 0, ...movingIds.filter(id => order.includes(id))); order.splice(0, order.length, ...remaining); state.dragFrame = null; state.dragFrames = []; list.classList.remove('frame-dragging'); renderTimelineGrid(); renderFrames(); drawPreview(); }); list.appendChild(card); }); $('timelineMeta').textContent = `${state.animations[state.activeAnimation]?.name || '当前动作'} · ${frames.length} 帧`; updatePreviewMeta(); syncSelectionControls();
}

function frameListPoint(event) { const list = $('frameList'); const rect = list.getBoundingClientRect(); return { x: event.clientX - rect.left + list.scrollLeft, y: event.clientY - rect.top + list.scrollTop }; }
function updateFrameSelectionBox(point) { const drag = state.frameSelectionDrag; if (!drag) return; const left = Math.min(drag.start.x, point.x), top = Math.min(drag.start.y, point.y), width = Math.abs(point.x - drag.start.x), height = Math.abs(point.y - drag.start.y); drag.box.style.left = `${left}px`; drag.box.style.top = `${top}px`; drag.box.style.width = `${width}px`; drag.box.style.height = `${height}px`; }
function finishFrameSelection(event) { const drag = state.frameSelectionDrag; if (!drag) return; const point = frameListPoint(event); updateFrameSelectionBox(point); const left = Math.min(drag.start.x, point.x), right = Math.max(drag.start.x, point.x), top = Math.min(drag.start.y, point.y), bottom = Math.max(drag.start.y, point.y); const next = event.shiftKey || event.metaKey || event.ctrlKey ? new Set(state.selectedFrameIds) : new Set(); $('frameList').querySelectorAll('.frame-card').forEach(card => { const x = card.offsetLeft, y = card.offsetTop, r = x + card.offsetWidth, b = y + card.offsetHeight; if (r >= left && x <= right && b >= top && y <= bottom) next.add(card.dataset.id); }); state.selectedFrameIds = expandFrameIds(next); drag.box.remove(); state.frameSelectionDrag = null; renderFrames(); }
const frameList = $('frameList');
frameList.addEventListener('dragstart', event => { const card = event.target.closest('.frame-card'); if (!card) return; const frame = frameById(card.dataset.id); if (frame?.groupId) state.selectedFrameIds = expandFrameIds(state.selectedFrameIds.has(frame.id) ? state.selectedFrameIds : [frame.id]); }, true);
frameList.addEventListener('click', event => { if (!(event.shiftKey || event.metaKey || event.ctrlKey) || event.target.closest('button')) return; const card = event.target.closest('.frame-card'); if (!card) return; const index = state.frames.findIndex(frame => frame.id === card.dataset.id); if (index < 0) return; event.stopPropagation(); selectFrameForEdit(index, true); }, true);
frameList.addEventListener('click', event => { const card = event.target.closest('.frame-card'); if (!card || event.target.closest('button')) return; const frame = frameById(card.dataset.id); if (frame?.groupId) { state.selectedFrameIds = expandFrameIds(state.selectedFrameIds); syncSelectionControls(); renderFrames(); } });
frameList.addEventListener('pointerdown', event => { if (!event.shiftKey && event.target.closest('.frame-card')) return; event.preventDefault(); const point = frameListPoint(event); const box = document.createElement('div'); box.className = 'frame-selection-box'; frameList.appendChild(box); frameList.setPointerCapture?.(event.pointerId); state.frameSelectionDrag = { start: point, box }; });
frameList.addEventListener('pointermove', event => { if (state.frameSelectionDrag) updateFrameSelectionBox(frameListPoint(event)); });
frameList.addEventListener('pointerup', finishFrameSelection); frameList.addEventListener('pointercancel', event => { if (state.frameSelectionDrag) { state.frameSelectionDrag.box.remove(); state.frameSelectionDrag = null; } });

function selectAnimation(index) { state.activeAnimation = clamp(index, 0, state.animations.length - 1); state.activeLayerId = null; state.selectedLayerIds.clear(); state.playIndex = 0; state.motionProgress = 0; state.motionDirection = 1; state.direction = 1; state.selectedFrameIds.clear(); syncSelectionControls(); syncMotionControls(); renderAnimations(); renderLayers(); renderFrames(); drawPreview(); }
function clearAnimationDropIndicator() { document.querySelectorAll('#animationList .animation-item').forEach(item => item.classList.remove('drop-before', 'drop-after')); }
function updateAnimationDropIndicator(index, after = false) { clearAnimationDropIndicator(); const item = document.querySelector(`#animationList .animation-item[data-index="${index}"]`); if (item) item.classList.add(after ? 'drop-after' : 'drop-before'); const ordered = orderedAnimations(); state.animationDropIndex = index + (after ? 1 : 0); state.animationDropTargetId = ordered[index]?.id || null; state.animationDropAfter = after; }
function reorderAnimations() { const order = ensureAnimationOrder(); const moving = new Set(state.animationDrag?.ids || []); if (!moving.size) return; if (state.animationDropTargetId && moving.has(state.animationDropTargetId)) return; const remaining = order.filter(id => !moving.has(id)); let insertAt = state.animationDropTargetId ? remaining.indexOf(state.animationDropTargetId) : remaining.length; if (insertAt < 0) insertAt = remaining.length; if (state.animationDropAfter && state.animationDropTargetId) insertAt += 1; remaining.splice(insertAt, 0, ...order.filter(id => moving.has(id))); state.animationOrder = remaining; clearAnimationDropIndicator(); state.animationDrag = null; state.animationDropIndex = -1; state.animationDropTargetId = null; state.animationDropAfter = false; renderAnimations(); }
function deleteAnimation(index) { if (state.animations.length <= 1) return toast('至少保留一个动作片段'); const removed = state.animations.splice(index, 1)[0]; state.animationOrder = ensureAnimationOrder().filter(id => id !== removed.id); state.activeAnimation = clamp(state.activeAnimation > index ? state.activeAnimation - 1 : state.activeAnimation, 0, state.animations.length - 1); state.activeLayerId = null; state.selectedLayerIds.clear(); state.selectedAnimationIds.clear(); state.playIndex = 0; state.motionProgress = 0; state.selectedFrame = -1; state.selectedFrameIds.clear(); renderAnimations(); renderLayers(); renderFrames(); drawPreview(); toast(`已删除${removed.name}`); }
function renderAnimations() { const list = $('animationList'); if (!list) return; ensureAnimationOrder(); list.innerHTML = ''; list.ondragover = event => { if (event.target.closest('.animation-item')) return; event.preventDefault(); updateAnimationDropIndicator(orderedAnimations().length - 1, true); }; list.ondrop = event => { if (event.target.closest('.animation-item')) return; event.preventDefault(); reorderAnimations(); }; orderedAnimations().forEach((anim, orderIndex) => { const index = animationIndex(anim); const row = document.createElement('div'); row.className = `animation-item${index === state.activeAnimation ? ' active' : ''}${state.selectedAnimationIds.has(anim.id) ? ' selected' : ''}`; row.dataset.index = String(orderIndex); row.dataset.id = anim.id; row.draggable = true; const title = document.createElement('span'); title.className = 'animation-item-title'; title.textContent = anim.name; const count = document.createElement('small'); count.textContent = `${anim.frameIds.length} 帧`; const mode = document.createElement('select'); mode.className = 'animation-play-mode'; mode.title = '片段播放方式'; mode.innerHTML = '<option value="loop">循环</option><option value="once">单次</option>'; mode.value = anim.playMode || 'loop'; mode.addEventListener('change', event => { event.stopPropagation(); anim.playMode = mode.value; }); const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'animation-delete'; remove.hidden = !showLocalFeatures; remove.title = `删除${anim.name}`; remove.textContent = '×'; remove.addEventListener('click', event => { event.stopPropagation(); deleteAnimation(index); }); row.append(title, count, mode, remove); row.addEventListener('click', event => { if (event.target.closest('button,select')) return; const additive = event.shiftKey || event.metaKey || event.ctrlKey; if (additive) { if (state.selectedAnimationIds.has(anim.id)) state.selectedAnimationIds.delete(anim.id); else state.selectedAnimationIds.add(anim.id); } else state.selectedAnimationIds = new Set([anim.id]); selectAnimation(index); }); row.addEventListener('dragstart', event => { const ids = state.selectedAnimationIds.has(anim.id) ? [...state.selectedAnimationIds] : [anim.id]; state.selectedAnimationIds = new Set(ids); state.animationDrag = { ids }; row.classList.add('drag-source'); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', anim.id); }); row.addEventListener('dragover', event => { event.preventDefault(); const rect = row.getBoundingClientRect(); updateAnimationDropIndicator(orderIndex, event.clientX > rect.left + rect.width / 2); }); row.addEventListener('drop', event => { event.preventDefault(); reorderAnimations(); }); row.addEventListener('dragend', () => { clearAnimationDropIndicator(); state.animationDrag = null; state.animationDropIndex = -1; state.animationDropTargetId = null; state.animationDropAfter = false; }); list.appendChild(row); }); }
function syncMotionControls() {
  const layer = activeLayer(); const motionEnabled = layer ? layer.motionEnabled : state.motionEnabled; const motionAmount = layer ? layer.motionAmount : state.motionAmount; const pixelScale = layer ? layer.scale : state.scale;
  const fps = layer ? layer.fps : state.fps;
  if ($('motionAmount')) $('motionAmount').value = motionAmount;
  if ($('motionAmountValue')) $('motionAmountValue').textContent = `${motionAmount} px`;
  if ($('motionEnabled')) $('motionEnabled').checked = motionEnabled;
  if ($('scale')) $('scale').value = String(pixelScale);
  if ($('motionScopeValue')) $('motionScopeValue').textContent = layer ? `当前图层：${layer.name}` : '全画面预览';
  if ($('previewSpeed')) $('previewSpeed').value = state.previewSpeed;
  if ($('fps')) $('fps').value = String(fps);
  if ($('fpsReadout')) $('fpsReadout').textContent = fps;
  const m = motionConfig();
  const mode = m.mode === 'jump' ? 'jump' : m.mode === 'linear' ? 'linear' : 'static';
  const modeNames = { static: '原地循环', linear: '向右移动', jump: '跳跃' };
  if ($('motionModeSimple')) $('motionModeSimple').value = mode;
  if ($('motionModeValue')) $('motionModeValue').textContent = modeNames[mode];
  if ($('motionDistance')) $('motionDistance').value = clamp(Math.abs(Number(m.endX) || 0), 0, 320);
  if ($('motionDistanceValue')) $('motionDistanceValue').textContent = `${Math.abs(Number(m.endX) || 0)} px`;
  const heightPx = Math.round(motionPixelHeight(m));
  if ($('motionHeight')) $('motionHeight').value = clamp(heightPx, 0, 240);
  if ($('motionHeightValue')) $('motionHeightValue').textContent = `${heightPx} px`;
  const heightField = document.querySelector('.motion-height-field');
  if (heightField) heightField.hidden = mode !== 'jump';
}
function reprocessFrames(silent = false) {
  const frames = activeFrames();
  if (!frames.length) return toast('当前动作没有可处理的帧');
  const originalImage = state.image; const originalBg = state.bgColor; const originalProfile = state.backgroundProfile;
  try {
    frames.forEach(frame => {
      const source = state.sheets.find(sheet => sheet.id === frame.sourceSheetId);
      if (source?.image) {
        state.image = source.image;
        state.backgroundProfile = source.backgroundProfile || detectBackgroundProfile(source.image, source.name);
        source.backgroundProfile = state.backgroundProfile; state.bgColor = [...state.backgroundProfile.background];
      }
      const crop = cropFrameImproved({ x: frame.x, y: frame.y, w: frame.sourceW || frame.w, h: frame.sourceH || frame.h });
      frame.canvas = crop.canvas; frame.dataUrl = crop.dataUrl; frame.w = crop.canvas.width; frame.h = crop.canvas.height; frame.anchorX = crop.anchor.x; frame.anchorY = crop.anchor.y;
    });
  } finally { state.image = originalImage; state.bgColor = originalBg; state.backgroundProfile = originalProfile; }
  renderLayers(); renderFrames(); syncMotionControls(); drawPreview(); if (!silent) toast('已按背景键控重新处理当前动作');
}
function updatePreviewMeta() { const frames = previewFrames(); const m = motionConfig(); const motionLabel = m.mode === 'jump' ? `跳跃 ${Math.abs(Number(m.endX) || 0)}px` : m.mode === 'linear' ? `向右 ${Math.abs(Number(m.endX) || 0)}px` : '原地'; $('previewMeta').textContent = frames.length ? `${frames.length} 帧 · ${motionLabel} · ${state.scale}×` : '等待动作'; $('frameCounter').textContent = `第 ${frames.length ? Math.min(state.playIndex + 1, frames.length) : 0} / ${frames.length} 帧`; $('previewEmpty').hidden = !!frames.length; $('fpsReadout').textContent = state.fps; }
function resizeWorkspacePanels() { const ratio = clamp(Number(state.panelRatio) || 75, 40, 80); const previewHeight = 360 + ((ratio - 40) / 40) * 250; const stage = document.querySelector('.preview-stage'); const list = $('frameList'); const framePanel = document.querySelector('.frames-panel'); if (stage) { stage.style.height = `${Math.round(previewHeight)}px`; stage.style.minHeight = `${Math.round(previewHeight)}px`; } if (list) { list.style.maxHeight = 'none'; list.style.minHeight = '220px'; } if (framePanel) { framePanel.style.height = 'auto'; framePanel.style.minHeight = '260px'; framePanel.style.maxHeight = 'none'; } if ($('panelRatio')) $('panelRatio').value = ratio; if ($('panelRatioValue')) $('panelRatioValue').textContent = `${ratio}% / ${100 - ratio}%`; }
const workspaceLayoutKey = 'pixel-sprite-animator.workspace-layout-v2';
function readWorkspaceLayout() { try { const saved = JSON.parse(localStorage.getItem(workspaceLayoutKey) || '{}'); if (Number.isFinite(saved.panelRatio)) state.panelRatio = clamp(saved.panelRatio, 40, 80); if (Number.isFinite(saved.editorSplit)) state.editorSplit = clamp(saved.editorSplit, 28, 55); document.documentElement.style.setProperty('--editor-split', `${state.editorSplit}%`); } catch { /* Ignore unavailable local storage. */ } }
function saveWorkspaceLayout() { try { localStorage.setItem(workspaceLayoutKey, JSON.stringify({ panelRatio: state.panelRatio, editorSplit: state.editorSplit })); } catch { /* Ignore unavailable local storage. */ } }
function initWorkspaceResizers() {
  readWorkspaceLayout();
  const editorDivider = $('editorDivider'); const vertical = $('workspaceVerticalDivider'); const workspace = document.querySelector('.workspace'); const editorGrid = document.querySelector('.editor-grid');
  const startDrag = (divider, kind, event) => {
    event.preventDefault(); divider.setPointerCapture?.(event.pointerId); divider.classList.add('dragging'); document.body.classList.add('workspace-resize-active', `${kind}-resize`);
    const startX = event.clientX, startY = event.clientY; const startWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gallery-width')) || 252; const startRatio = state.panelRatio; const startEditorSplit = state.editorSplit;
    const move = moveEvent => {
      if (kind === 'horizontal') {
        const maxWidth = Math.min(640, window.innerWidth * .4); const width = clamp(startWidth + moveEvent.clientX - startX, 180, maxWidth); document.documentElement.style.setProperty('--gallery-width', `${Math.round(width)}px`);
      } else if (kind === 'editor') {
        const available = editorGrid?.getBoundingClientRect().width || 1200; state.editorSplit = clamp(startEditorSplit + ((moveEvent.clientX - startX) / Math.max(1, available)) * 100, 28, 55); document.documentElement.style.setProperty('--editor-split', `${state.editorSplit}%`);
      } else {
        const available = workspace?.getBoundingClientRect().height || 900; state.panelRatio = clamp(startRatio + ((moveEvent.clientY - startY) / Math.max(1, available)) * 100, 40, 80); resizeWorkspacePanels();
      }
    };
    const end = () => { divider.releasePointerCapture?.(event.pointerId); divider.classList.remove('dragging'); document.body.classList.remove('workspace-resize-active', `${kind}-resize`); saveWorkspaceLayout(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end, { once: true }); window.addEventListener('pointercancel', end, { once: true });
  };
  editorDivider?.addEventListener('pointerdown', event => startDrag(editorDivider, 'editor', event));
  vertical?.addEventListener('pointerdown', event => startDrag(vertical, 'vertical', event));
  editorDivider?.addEventListener('dblclick', () => { state.editorSplit = 38; document.documentElement.style.setProperty('--editor-split', '38%'); saveWorkspaceLayout(); });
  vertical?.addEventListener('dblclick', () => { state.panelRatio = 75; resizeWorkspacePanels(); saveWorkspaceLayout(); });
  $('panelRatio')?.addEventListener('input', () => { saveWorkspaceLayout(); });
  resizeWorkspacePanels();
}

function layerDisplayScale(layer) { const base = Math.max(1, Number(state.scale) || 1); return Math.max(.25, (Number(layer?.scale) || base) / base); }
function motionBounds() { const entries = compositionEntries(); if (!entries.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0 }; let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; const steps = Math.max(24, previewFrames().length * 2); for (let i = 0; i <= steps; i++) { const t = i / steps; entries.forEach(({ frame, layer }) => { const frames = layerFrames(layer); const current = frames.length ? frames[Math.min(frames.length - 1, Math.round(t * (frames.length - 1)))] : frame; const p = layerMotionPosition(t, layer); const scale = layerDisplayScale(layer); const offsetX = Number(layer?.x) || 0, offsetY = Number(layer?.y) || 0; minX = Math.min(minX, p.x + offsetX - current.anchorX * scale); maxX = Math.max(maxX, p.x + offsetX + current.w * scale - current.anchorX * scale); minY = Math.min(minY, p.y + offsetY - current.anchorY * scale); maxY = Math.max(maxY, p.y + offsetY + current.h * scale - current.anchorY * scale); }); } return { minX, maxX, minY, maxY }; }
function previewFitScale() { const bounds = motionBounds(); const totalW = Math.max(1, bounds.maxX - bounds.minX); const totalH = Math.max(1, bounds.maxY - bounds.minY); return Math.max(1, Math.floor(Math.min((previewCanvas.width - 48) / totalW, (previewCanvas.height - 48) / totalH)) || 1); }
function previewRenderScale(zoom = state.previewZoom) { if (state.previewScaleLock !== null && zoom === state.previewZoom) return state.previewScaleLock; return Math.max(1, Math.round(previewFitScale() * zoom)); }
function previewOrigin(z) { if (state.previewOriginLock && Math.abs(state.previewOriginLock.z - z) < .001) return { x: state.previewOriginLock.x, y: state.previewOriginLock.y }; const bounds = motionBounds(); return { x: (previewCanvas.width - (bounds.maxX - bounds.minX) * z) / 2 - bounds.minX * z + state.cameraX, y: (previewCanvas.height - (bounds.maxY - bounds.minY) * z) / 2 - bounds.minY * z + state.cameraY }; }
function motionWorldPoint(t, layer) { const p = layerMotionPosition(t, layer); return { x: p.x + (Number(layer?.x) || 0), y: p.y + (Number(layer?.y) || 0) }; }
function drawMotionOverlay(z) { const m = motionConfig(); const layer = activeLayer(); if (!layer || m.mode === 'static') return; const origin = previewOrigin(z); const point = (t) => { const p = motionWorldPoint(t, layer); return { x: Math.round(origin.x + p.x * z), y: Math.round(origin.y + p.y * z) }; }; const start = point(0), end = point(1); previewCtx.save(); previewCtx.strokeStyle = '#8ed8c4'; previewCtx.lineWidth = 2; previewCtx.setLineDash([6, 5]); previewCtx.beginPath(); for (let i = 0; i <= 24; i++) { const p = point(i / 24); if (i === 0) previewCtx.moveTo(p.x, p.y); else previewCtx.lineTo(p.x, p.y); } previewCtx.stroke(); previewCtx.setLineDash([]); previewCtx.fillStyle = '#f4b765'; [start, end].forEach(p => previewCtx.fillRect(p.x - 6, p.y - 6, 12, 12)); if (m.mode === 'jump') { const control = point(.5); previewCtx.fillStyle = '#f08f83'; previewCtx.fillRect(control.x - 5, control.y - 5, 10, 10); } if (m.mode === 'custom') { const controlX = m.controlX ?? (m.startX + m.endX) / 2, controlY = m.controlY ?? (m.startY + m.endY) / 2; const screen = { x: Math.round(origin.x + (controlX + (Number(layer.x) || 0)) * z), y: Math.round(origin.y + (controlY + (Number(layer.y) || 0)) * z) }; previewCtx.fillStyle = '#f08f83'; previewCtx.fillRect(screen.x - 5, screen.y - 5, 10, 10); } previewCtx.fillStyle = '#fff1d0'; previewCtx.font = '12px ui-monospace,monospace'; previewCtx.fillText('START', start.x + 9, start.y - 9); previewCtx.fillText('END', end.x + 9, end.y - 9); previewCtx.restore(); }
function layerHandleAt(point, z) { const entries = compositionEntries().slice().reverse(); const origin = previewOrigin(z); const t = previewMotionT(); for (const entry of entries) { if (!entry.layer) continue; const frame = entry.frame; const layer = entry.layer; const travel = layerMotionPosition(t, layer); const scale = layerDisplayScale(layer); const baseX = origin.x + (travel.x + (Number(layer.x) || 0)) * z - frame.anchorX * z * scale; const baseY = origin.y + (travel.y + (Number(layer.y) || 0)) * z - frame.anchorY * z * scale; const width = frame.w * z * scale, height = frame.h * z * scale; if (point.x >= baseX && point.x <= baseX + width && point.y >= baseY && point.y <= baseY + height) return { layer, frame, baseX, baseY }; } return null; }
function drawLayerOverlay(z) { const entries = compositionEntries().filter(entry => entry.layer); if (!entries.length) return; const origin = previewOrigin(z); const travelT = previewMotionT(); previewCtx.save(); previewCtx.font = '11px ui-monospace,monospace'; entries.forEach(({ frame, layer }) => { const travel = layerMotionPosition(travelT, layer); const scale = layerDisplayScale(layer); const baseX = Math.round(origin.x + (travel.x + (Number(layer.x) || 0)) * z - frame.anchorX * z * scale); const baseY = Math.round(origin.y + (travel.y + (Number(layer.y) || 0)) * z - frame.anchorY * z * scale); const width = Math.max(1, Math.round(frame.w * z * scale)); const height = Math.max(1, Math.round(frame.h * z * scale)); const x = Math.round(baseX + width / 2), y = Math.round(baseY + height / 2); const selected = state.selectedLayerIds.has(layer.id); if (selected) { previewCtx.strokeStyle = '#f4b765'; previewCtx.lineWidth = 2; previewCtx.setLineDash([5, 4]); previewCtx.strokeRect(baseX - 3, baseY - 3, width + 6, height + 6); previewCtx.setLineDash([]); } previewCtx.fillStyle = selected ? '#f4b765' : '#8ed8c4'; previewCtx.fillRect(x - 5, y - 5, 10, 10); previewCtx.fillStyle = '#fff1d0'; previewCtx.fillText(layer.name, x + 9, y - 8); }); previewCtx.restore(); }
function drawPreviewGrid() { previewCtx.save(); previewCtx.lineWidth = 1; previewCtx.strokeStyle = 'rgba(245,195,110,.16)'; for (let y = 20; y < previewCanvas.height; y += 32) { previewCtx.beginPath(); previewCtx.moveTo(0, y + .5); previewCtx.lineTo(previewCanvas.width, y + .5); previewCtx.stroke(); } previewCtx.strokeStyle = 'rgba(142,216,196,.26)'; previewCtx.beginPath(); previewCtx.moveTo(0, Math.round(previewCanvas.height * .72) + .5); previewCtx.lineTo(previewCanvas.width, Math.round(previewCanvas.height * .72) + .5); previewCtx.stroke(); previewCtx.restore(); }
function drawPreview() { updatePreviewMeta(); previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height); drawPreviewGrid(); const frames = previewFrames(); if (!frames.length) return; const z = previewRenderScale(); const origin = previewOrigin(z); const travelT = previewMotionT(); compositionEntries().forEach(({ frame, layer }) => { const travel = layerMotionPosition(travelT, layer); const scale = layerDisplayScale(layer); const offsetX = Number(layer?.x) || 0, offsetY = Number(layer?.y) || 0; const renderScale = z * scale; const x = Math.round(origin.x + (travel.x + offsetX) * z - frame.anchorX * renderScale); const y = Math.round(origin.y + (travel.y + offsetY) * z - frame.anchorY * renderScale); previewCtx.save(); previewCtx.globalAlpha = layer?.opacity ?? 1; previewCtx.imageSmoothingEnabled = false; previewCtx.drawImage(frame.canvas, x, y, frame.w * renderScale, frame.h * renderScale); previewCtx.restore(); }); drawLayerOverlay(z); drawMotionOverlay(z); }
function activateSequenceClip(clip) { const index = animationIndex(clip); if (index < 0) return; state.activeAnimation = index; state.activeLayerId = null; state.playIndex = 0; state.motionProgress = 0; renderAnimations(); renderLayers(); renderFrames(); }
function sequenceTick(now) { const clips = orderedAnimations(); if (!clips.length) return false; if (!Number.isFinite(state.sequenceClipIndex) || state.sequenceClipIndex >= clips.length) state.sequenceClipIndex = 0; const clip = clips[state.sequenceClipIndex]; if (state.animations[state.activeAnimation] !== clip) activateSequenceClip(clip); const frames = previewFrames(); if (!frames.length) { state.sequenceClipIndex += 1; return true; } const current = frames[state.playIndex]; const fps = activeLayer()?.fps || clip.fps || state.fps; const interval = 1000 / fps * (current?.duration || 1) / Math.max(.1, state.previewSpeed); if (now - state.lastTick < interval) return true; state.playIndex += 1; if (state.playIndex >= frames.length) { state.sequenceClipIndex += 1; if (state.sequenceClipIndex >= clips.length) { if (state.loop) { state.sequenceClipIndex = 0; } else { state.sequenceClipIndex = clips.length - 1; state.playIndex = frames.length - 1; state.motionProgress = 1; state.playing = false; if ($('playPause')) $('playPause').textContent = '▶'; drawPreview(); return false; } } if (state.playing) activateSequenceClip(clips[state.sequenceClipIndex]); } state.motionProgress = frames.length > 1 ? clamp(state.playIndex / (frames.length - 1), 0, 1) : 1; state.lastTick = now; drawPreview(); return true; }
function tick(now) { if (state.playing) { if (state.sequenceEnabled && orderedAnimations().length > 1) sequenceTick(now); else { const frames = previewFrames(); if (!frames.length) { state.playing = false; return requestAnimationFrame(tick); } const current = frames[state.playIndex]; const fps = activeLayer()?.fps || state.fps; const interval = 1000 / fps * (current?.duration || 1) / Math.max(.1, state.previewSpeed); if (now - state.lastTick >= interval) { const len = frames.length; state.playIndex += 1; const shouldLoop = state.loop && motionConfig().loop !== 'once'; if (state.playIndex >= len) state.playIndex = shouldLoop ? 0 : len - 1; state.motionProgress = len > 1 ? state.playIndex / (len - 1) : 1; state.lastTick = now; drawPreview(); if (!shouldLoop && state.playIndex === len - 1) { state.playing = false; if ($('playPause')) $('playPause').textContent = '▶'; } } } } state.raf = requestAnimationFrame(tick); }
function restartPreviewPlayback() { const clips = orderedAnimations(); if (state.sequenceEnabled && clips.length > 1) { state.sequenceClipIndex = 0; state.playIndex = 0; activateSequenceClip(clips[0]); } else { const frames = previewFrames(); if (!frames.length) return false; state.playIndex = 0; state.motionProgress = 0; } state.lastTick = performance.now(); state.playing = true; if ($('playPause')) $('playPause').textContent = 'Ⅱ'; drawPreview(); return true; }

function detectBoxesInRegion(region) {
  const c = document.createElement('canvas'); c.width = state.image.naturalWidth; c.height = state.image.naturalHeight; const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingEnabled = false; ctx.drawImage(state.image, 0, 0);
  // Use the active sheet's verified background profile. The previous detector
  // compared against the mutable global bgColor, which could belong to a
  // different sheet and make valid sprites look like background.
  const keyed = removeSpriteBackground(ctx.getImageData(region.x, region.y, region.w, region.h), state.backgroundProfile).imageData;
  const d = keyed.data; const visited = new Uint8Array(region.w * region.h); const boxes = []; const scanStep = region.w * region.h > 3000000 ? 2 : 1;
  const isSolid = (x, y) => d[(y * region.w + x) * 4 + 3] > 0;
  for (let y = 0; y < region.h; y += scanStep) for (let x = 0; x < region.w; x += scanStep) { const idx = y * region.w + x; if (visited[idx] || !isSolid(x, y)) continue; const q = [[x, y]]; visited[idx] = 1; let minX = x, maxX = x, minY = y, maxY = y, count = 0; while (q.length) { const [cx, cy] = q.pop(); count++; minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy); for (const [nx, ny] of [[cx + scanStep, cy], [cx - scanStep, cy], [cx, cy + scanStep], [cx, cy - scanStep], [cx - scanStep, cy - scanStep], [cx + scanStep, cy - scanStep], [cx - scanStep, cy + scanStep], [cx + scanStep, cy + scanStep]]) { if (nx < 0 || ny < 0 || nx >= region.w || ny >= region.h) continue; const ni = ny * region.w + nx; if (!visited[ni] && isSolid(nx, ny)) { visited[ni] = 1; q.push([nx, ny]); } } } const w = maxX - minX + scanStep + 1, h = maxY - minY + scanStep + 1; if (count > 10 && w > 2 && h > 2 && w < region.w * .8 && h < region.h * .9) boxes.push({ x: region.x + Math.max(0, minX - 1), y: region.y + Math.max(0, minY - 1), w, h }); }
  // Merge nearby connected components so hands, hair, feet and projectiles remain one frame.
  let changed = true; while (changed) { changed = false; outer: for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)); const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h)); const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x); const yOverlapRatio = overlapY / Math.max(1, Math.min(a.h, b.h)); const xOverlapRatio = overlapX / Math.max(1, Math.min(a.w, b.w)); const areaRatio = Math.min(a.w * a.h, b.w * b.h) / Math.max(1, Math.max(a.w * a.h, b.w * b.h)); const samePose = (gapX <= 0 && yOverlapRatio >= .7 && areaRatio >= .18) || (gapY <= 0 && xOverlapRatio >= .7 && areaRatio >= .18); if (samePose) { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), r = Math.max(a.x + a.w, b.x + b.w), bot = Math.max(a.y + a.h, b.y + b.h); boxes.splice(j, 1); boxes[i] = { x, y, w: r - x, h: bot - y }; changed = true; break outer; } } }
  // A long merged box is usually several adjacent poses. Split it at clear empty columns.
  const refined = []; const splitQueue = [...boxes]; while (splitQueue.length) { const box = splitQueue.shift(); if (box.w < box.h * 1.12) { refined.push(box); continue; } const lx = box.x - region.x, ly = box.y - region.y; const occupied = []; for (let x = 0; x < box.w; x++) { let count = 0; for (let y = 0; y < box.h; y += 2) if (isSolid(lx + x, ly + y)) count++; occupied.push(count); } const spans = []; let start = -1, empty = 0; for (let x = 0; x < occupied.length; x++) { const valley = occupied[x] <= 1; if (!valley) { if (start < 0) start = x; empty = 0; } else if (start >= 0) { empty++; if (empty >= 2) { const end = x - empty; if (end - start >= 10) spans.push([start, end]); start = -1; empty = 0; } } } if (start >= 0 && occupied.length - start >= 10) spans.push([start, occupied.length - 1]); if (spans.length >= 2) spans.forEach(([startX, endX]) => splitQueue.push({ x: box.x + startX, y: box.y, w: endX - startX + 1, h: box.h })); else refined.push(box); } boxes.splice(0, boxes.length, ...refined);
  // Sprite labels and words such as 01 / REPEAT are usually short, shallow
  // connected components near the top or bottom edge of the selected strip.
  // Filter those after merging/splitting so real limbs and projectiles remain.
  const medianHeight = boxes.length ? [...boxes].map(box => box.h).sort((a, b) => a - b)[Math.floor(boxes.length / 2)] : 0;
  const minSpriteHeight = Math.max(10, medianHeight * .28, region.h * .08);
  // Text labels are short, flat rows of several tiny components. Filter the
  // recognition boxes only; the source pixels remain untouched for cropping.
  const smallComponents = boxes.filter(box => box.h <= 18 && box.w <= 42);
  const textBands = [];
  smallComponents.slice().sort((a, b) => a.y - b.y || a.x - b.x).forEach(box => {
    const center = box.y + box.h / 2;
    let band = textBands.find(item => Math.abs(center - item.center) <= 4 && box.x - item.maxX <= 18);
    if (!band) { band = { items: [], x: box.x, maxX: box.x + box.w, y: box.y, maxY: box.y + box.h, center }; textBands.push(band); }
    band.items.push(box); band.x = Math.min(band.x, box.x); band.maxX = Math.max(band.maxX, box.x + box.w); band.y = Math.min(band.y, box.y); band.maxY = Math.max(band.maxY, box.y + box.h); band.center = band.items.reduce((sum, item) => sum + item.y + item.h / 2, 0) / band.items.length;
  });
  const textBoxIds = new Set();
  textBands.forEach(band => { const width = band.maxX - band.x, height = band.maxY - band.y; const isLabelBand = band.items.length >= 2 && width >= 20 && height <= 18 && width / Math.max(1, height) >= 1.8; if (isLabelBand) band.items.forEach(item => textBoxIds.add(item)); });
  const filtered = boxes.filter(box => {
    const nearBottom = box.y + box.h > region.y + region.h * .72;
    const nearTop = box.y < region.y + region.h * .16;
    const shallow = box.h < minSpriteHeight;
    const narrow = box.w < region.w * .22;
    const isolatedTinyLabel = textBoxIds.has(box) || (medianHeight >= 30 && box.h <= 14 && box.w <= 42 && box.w / Math.max(1, box.h) >= 1.8);
    const tinyNoise = medianHeight >= 30 && boxes.length > 12 && box.w <= 8 && box.h <= 8;
    return !(isolatedTinyLabel || tinyNoise || (shallow && narrow && (nearBottom || nearTop)));
  });
  boxes.splice(0, boxes.length, ...filtered);
  const rows = []; boxes.sort((a, b) => a.y - b.y || a.x - b.x).forEach(box => { const cy = box.y + box.h / 2; let row = rows.find(r => Math.abs(cy - r.cy) < Math.max(18, Math.min(box.h, r.h) * .38)); if (!row) { row = { cy, h: box.h, boxes: [] }; rows.push(row); } row.boxes.push(box); row.cy = row.boxes.reduce((sum, x) => sum + x.y + x.h / 2, 0) / row.boxes.length; row.h = Math.max(row.h, box.h); }); return rows.sort((a, b) => a.cy - b.cy).flatMap(row => row.boxes.sort((a, b) => a.x - b.x));
}

function generateAction(mode = 'new') {
  if (!state.image || !state.selection || state.selection.w < 2 || state.selection.h < 2) return toast('先框选一整个动作区域');
  setTaskStatus('PROCESSING', '生成动作剪辑', .55);
  try {
    const boxes = state.detectedBoxes.length ? [...state.detectedBoxes] : detectBoxesInRegion(state.selection);
    if (!boxes.length) { setTaskStatus('ERROR', '未检测到像素', 0); return toast('这个区域没有检测到角色像素'); }
    state.detectedBoxes = boxes; drawSheet();
    const created = boxes.map(createFrame); state.frames.push(...created); const ids = created.map(f => f.id);
    const animation = state.animations[state.activeAnimation]; let sourceLayer = state.activeLayerId ? ensureLayers(animation).find(layer => layer.id === state.activeLayerId) : null;
    if (!sourceLayer) sourceLayer = sheetLayer(state.activeSheetId, animation);
    if (mode === 'append' || mode === 'layer') animation.frameIds.push(...ids);
    else if (animation?.frameIds.length === 0) animation.frameIds = ids;
    else { const createdAnimation = { id: `animation-${Date.now()}-${crypto.randomUUID()}`, name: `动作 ${state.animations.length + 1}`, frameIds: ids, motion: defaultMotion(), layers: defaultLayers(), playMode: 'once' }; state.animations.push(createdAnimation); state.animationOrder = ensureAnimationOrder(); state.activeAnimation = state.animations.length - 1; state.activeLayerId = null; sourceLayer = sheetLayer(state.activeSheetId); }
    if (sourceLayer && !state.activeLayerId) { state.activeLayerId = sourceLayer.id; state.selectedLayerIds = new Set([sourceLayer.id]); }
    if (sourceLayer) sourceLayer.frameIds = [...(sourceLayer.frameIds || []), ...ids];
    if (motionConfig().mode === 'jump' && !Number(motionConfig().height)) motionConfig().height = Math.max(1, 120 / averageCharacterHeight()); state.selectedFrame = state.frames.length - 1; state.playIndex = 0; state.motionProgress = 0; state.motionDirection = 1; state.direction = 1; state.cameraX = 0; state.cameraY = 0; state.previewZoom = 1; $('previewZoomLabel').textContent = '100%'; state.playing = true; $('playPause').textContent = 'Ⅱ'; syncMotionControls(); renderAnimations(); renderLayers(); renderFrames(); drawPreview(); setTaskStatus('DONE', `${boxes.length} 帧已进入剪辑区`, 1); const actionLabel = mode === 'append' ? '追加到当前动作' : mode === 'layer' ? '生成独立图层' : '生成新动作'; toast(`检测到 ${boxes.length} 帧，已${actionLabel}并开始播放`);
  } catch (error) {
    console.error('生成动画失败', error); setTaskStatus('ERROR', '生成动画失败', 0); toast(`生成动画失败：${error.message || '未知错误'}`);
  }
}

function exportMotionPosition(t, anim = activeAnimation(), layer = null) { const m = layer?.motion || anim?.motion || defaultMotion(); let p = clamp(t, 0, 1); if (m.mode !== 'static' && m.loop === 'pingpong') { const phase = p * 2; p = phase <= 1 ? phase : 2 - phase; } const base = motionPosition(p, m, layer); const nudge = simpleMotionOffset(t, layer); return { x: base.x + nudge.x, y: base.y + nudge.y }; }
function exportSampleEntries(sample) { return Array.isArray(sample.entries) && sample.entries.length ? sample.entries : [{ frame: sample.frame || sample, layer: sample.layer || null }]; }
function exportUnit(samples, scale, bakeMotion = true) { let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; const paddings = []; samples.forEach(sample => { exportSampleEntries(sample).forEach(({ frame, layer, animation }) => { const layerScale = layerDisplayScale(layer); const owner = animation || sample.animation || activeAnimation(); const travel = bakeMotion ? exportMotionPosition(sample.motionT ?? 0, owner, layer) : { x: 0, y: 0 }; const offsetX = Number(layer?.x) || 0, offsetY = Number(layer?.y) || 0; minX = Math.min(minX, travel.x + offsetX - frame.anchorX * layerScale); maxX = Math.max(maxX, travel.x + offsetX + frame.w * layerScale - frame.anchorX * layerScale); minY = Math.min(minY, travel.y + offsetY - frame.anchorY * layerScale); maxY = Math.max(maxY, travel.y + offsetY + frame.h * layerScale - frame.anchorY * layerScale); if (layer?.motion) paddings.push(Number(layer.motion.padding) || 0); }); }); if (!Number.isFinite(minX)) return { minX: 0, minY: 0, width: 2, height: 2, bakeMotion }; const paddingPercent = bakeMotion ? (paddings.length ? Math.max(...paddings) : (motionConfig().padding ?? 10)) : 0; const baseW = Math.max(1, maxX - minX), baseH = Math.max(1, maxY - minY); const padW = Math.ceil(baseW * paddingPercent / 100), padH = Math.ceil(baseH * paddingPercent / 100); minX -= padW; maxX += padW; minY -= padH; maxY += padH; const width = Math.max(2, Math.ceil((maxX - minX) * scale)); const height = Math.max(2, Math.ceil((maxY - minY) * scale)); return { minX, minY, width: width + (width % 2), height: height + (height % 2), bakeMotion }; }
function drawAligned(ctx, sample, unit, x, y, scale) { ctx.imageSmoothingEnabled = false; exportSampleEntries(sample).forEach(({ frame, layer, animation }) => { if (!frameVisible(frame, layer)) return; const layerScale = layerDisplayScale(layer); const owner = animation || sample.animation || activeAnimation(); const travel = unit.bakeMotion ? exportMotionPosition(sample.motionT ?? 0, owner, layer) : { x: 0, y: 0 }; const offsetX = Number(layer?.x) || 0, offsetY = Number(layer?.y) || 0; const m = layer?.motion || owner?.motion || motionConfig(); const rawX = x + (travel.x + offsetX - frame.anchorX * layerScale - unit.minX) * scale; const rawY = y + (travel.y + offsetY - frame.anchorY * layerScale - unit.minY) * scale; const dx = m.pixelSnap === false ? rawX : Math.round(rawX); const dy = m.pixelSnap === false ? rawY : Math.round(rawY); ctx.drawImage(frame.canvas, dx, dy, frame.w * scale * layerScale, frame.h * scale * layerScale); }); }
function buildExportCanvas(samples, scale) { const staticSamples = samples.map(sample => ({ entries: exportSampleEntries(sample), frame: sample.frame || sample, motionT: 0 })); const unit = exportUnit(staticSamples, scale, false); const cols = Math.min(staticSamples.length, Math.max(1, Math.floor(32000 / unit.width))); const rows = Math.ceil(staticSamples.length / cols); const sheet = document.createElement('canvas'); sheet.width = cols * unit.width; sheet.height = rows * unit.height; const ctx = sheet.getContext('2d'); ctx.imageSmoothingEnabled = false; staticSamples.forEach((sample, i) => drawAligned(ctx, sample, unit, (i % cols) * unit.width, Math.floor(i / cols) * unit.height, scale)); return sheet; }
function buildSequenceCanvases(samples, scale) { const unit = exportUnit(samples, scale, true); return samples.map(sample => { const c = document.createElement('canvas'); c.width = unit.width; c.height = unit.height; drawAligned(c.getContext('2d'), sample, unit, 0, 0, scale); return c; }); }
async function buildSequenceDataUrls(samples, scale) { const unit = exportUnit(samples, scale, true); const canvas = document.createElement('canvas'); canvas.width = unit.width; canvas.height = unit.height; const ctx = canvas.getContext('2d'); const urls = []; for (let i = 0; i < samples.length; i++) { ctx.clearRect(0, 0, canvas.width, canvas.height); drawAligned(ctx, samples[i], unit, 0, 0, scale); urls.push(canvas.toDataURL('image/png')); if (i % 10 === 9) { setExportStatus('PREPARING', `${i + 1} / ${samples.length} 帧`, .05 + .25 * (i + 1) / samples.length); await new Promise(resolve => setTimeout(resolve, 0)); } } return urls; }
function currentAnimationName() { return state.animations[state.activeAnimation]?.name || '当前动作'; }
function currentSpriteTag() { return (state.sheets.find(sheet => sheet.id === state.activeSheetId)?.name || state.imageName || '未命名精灵图').replace(/\.[^.]+$/, ''); }
function currentRoleName() { const input = $('exportCharacterName'); const typed = input?.value.trim(); if (typed) return typed.replace(/[\\/:*?"<>|]/g, '_'); return currentSpriteTag().split('_')[0] || '角色'; }
const exportSerialsKey = 'pixel-sprite-animator.export-serial-by-role-v1';
function exportRoleKey(role = currentRoleName()) { return String(role || '角色').trim().toLocaleLowerCase() || '角色'; }
function readExportSerials() { try { const value = JSON.parse(localStorage.getItem(exportSerialsKey) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } }
function nextExportSerial(role = currentRoleName()) { const key = exportRoleKey(role); const serials = readExportSerials(); const next = Math.max(0, Number(serials[key]) || 0) + 1; serials[key] = next; state.exportSerial = next; try { localStorage.setItem(exportSerialsKey, JSON.stringify(serials)); } catch { /* Ignore unavailable local storage. */ } return next; }
function exportSerialForAnimation(anim = activeAnimation()) { const roleKey = exportRoleKey(); if (!anim.exportSerialByRole || typeof anim.exportSerialByRole !== 'object') anim.exportSerialByRole = {}; if (!Number.isFinite(anim.exportSerialByRole[roleKey])) anim.exportSerialByRole[roleKey] = nextExportSerial(); return anim.exportSerialByRole[roleKey]; }
function exportFilePrefix() { return `${currentRoleName()}_P${exportSerialForAnimation()}`; }
function ensureExportIdentityControl() { const settings = document.querySelector('.export-settings'); if (!settings || $('exportCharacterName')) return; const label = document.createElement('label'); label.htmlFor = 'exportCharacterName'; label.textContent = '角色名'; const input = document.createElement('input'); input.id = 'exportCharacterName'; input.type = 'text'; input.maxLength = 24; input.placeholder = '自动使用当前角色'; try { input.value = localStorage.getItem('pixel-sprite-animator.export-role') || ''; } catch { input.value = ''; } input.addEventListener('change', () => { try { localStorage.setItem('pixel-sprite-animator.export-role', input.value.trim()); } catch { /* Ignore unavailable local storage. */ } }); settings.prepend(input); settings.prepend(label); }
function exportSettings() { const duration = Math.max(1, Number($('exportDuration').value) || 1); const rawLoops = Number($('exportLoops').value); return { duration, loops: Number.isFinite(rawLoops) ? Math.max(0, rawLoops) : 1 }; }
function exportPlaybackFps() { const layers = selectedLayers(); const baseFps = layers.length ? Math.max(...layers.map(layer => Number(layer.fps) || state.fps)) : state.fps; return clamp(Number(baseFps) * Math.max(.1, Number(state.previewSpeed) || 1), .25, 60); }
function selectedLayersForAnimation(anim) { const layers = ensureLayers(anim).filter(layer => layer.visible); if (state.exportLayerScope === 'auto' && anim === activeAnimation() && state.selectedLayerIds?.size) return layers.filter(layer => state.selectedLayerIds.has(layer.id)); return layers; }
function exportEntriesAt(frameIndex, layers = selectedLayers(), anim = activeAnimation()) { const entries = []; layers.forEach(layer => { const frame = layerFrameAt(layer, frameIndex); if (frame) entries.push({ frame, layer, animation: anim }); }); if (!entries.length && !layers.length) { const frames = Array.isArray(anim?.frameIds) ? anim.frameIds.map(frameById).filter(Boolean) : activeFrames(); const frame = frames[frameIndex % Math.max(1, frames.length)]; if (frame) entries.push({ frame, layer: null, animation: anim }); } return entries; }
function exportLayerFrameCount(layers, anim = activeAnimation()) { return layers.length ? layers.reduce((max, layer) => Math.max(max, layerFrames(layer).length), 0) : (anim?.frameIds?.length || (anim === activeAnimation() ? activeFrames().length : 0)); }
function expandedExportFrames() { const settings = exportSettings(); const clips = state.sequenceEnabled ? orderedAnimations() : [activeAnimation()]; const samples = []; const loopCount = settings.loops === 0 ? 1 : settings.loops; for (let loop = 0; loop < loopCount; loop++) clips.forEach(anim => { const layers = selectedLayersForAnimation(anim); const source = Math.max(1, exportLayerFrameCount(layers, anim)); for (let index = 0; index < source; index++) { const entries = exportEntriesAt(index, layers, anim); if (!entries.length) continue; const frame = entries[0]?.frame; for (let i = 0; i < settings.duration * (frame?.duration || 1); i++) samples.push({ entries, frame, animation: anim, motionT: source > 1 ? index / (source - 1) : 1 }); } }); return samples; }
function layerFrameSamples() { const layers = selectedLayers(); const count = exportLayerFrameCount(layers); const samples = []; for (let index = 0; index < count; index++) { const entries = exportEntriesAt(index, layers); if (entries.length) samples.push({ entries, frame: entries[0]?.frame, motionT: count > 1 ? index / (count - 1) : 1 }); } return samples; }
function canvasBlob(canvas, type = 'image/png') { return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('浏览器无法生成图像文件')), type)); }
function currentExportSample() { const layers = selectedLayers(); const frames = layers.length === 1 && layerFrames(layers[0]).length ? layerFrames(layers[0]) : activeFrames(); if (!frames.length) return null; const selected = state.selectedFrame >= 0 ? state.frames[state.selectedFrame] : null; const selectedIndex = selected ? frames.indexOf(selected) : -1; const index = selectedIndex >= 0 ? selectedIndex : clamp(state.playIndex, 0, frames.length - 1); const entries = exportEntriesAt(index, layers); return entries.length ? { entries, frame: frames[index], index, motionT: frames.length > 1 ? index / (frames.length - 1) : 1 } : null; }
function build4KFrameCanvas(sample) { const width = 3840, height = 2160; const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; const unit = exportUnit([sample], 1, true); const integerScale = Math.max(1, Math.floor(Math.min((width - 32) / unit.width, (height - 32) / unit.height))); const drawWidth = unit.width * integerScale, drawHeight = unit.height * integerScale; drawAligned(ctx, sample, unit, Math.floor((width - drawWidth) / 2), Math.floor((height - drawHeight) / 2), integerScale); return canvas; }
async function exportPng4K() { const sample = currentExportSample(); if (!sample) return toast('当前动作还没有帧'); setTaskStatus('PACKING', '生成 4K 透明 PNG', .35); setExportStatus('PACKING', '生成 3840×2160 透明 PNG', .35); const canvas = build4KFrameCanvas(sample); const blob = await canvasBlob(canvas); downloadBlob(blob, `${exportFilePrefix()}_Frame${sample.index + 1}_4K_透明.png`); setTaskStatus('DONE', '4K PNG 导出完成', 1); setExportStatus('DONE', '4K 透明 PNG 已下载', 1); toast('当前选择帧的 4K 透明 PNG 已导出'); }
function exportSheet() { const frames = expandedExportFrames(); if (!frames.length) return toast('当前动作还没有帧'); setTaskStatus('PACKING', '整理透明 Sprite Sheet', .35); setExportStatus('PACKING', '整理透明 Sprite Sheet', .35); const c = buildExportCanvas(frames, state.scale); setTaskStatus('WRITING FILE', '写入 PNG 文件', .85); setExportStatus('WRITING FILE', '写入 PNG 文件', .85); canvasBlob(c).then(blob => { downloadBlob(blob, `${exportFilePrefix()}_${state.scale}x_透明精灵图.png`); setTaskStatus('DONE', '导出完成', 1); setExportStatus('DONE', 'PNG Sprite Sheet 已写入下载目录', 1); toast('当前动作透明 Sprite Sheet 已导出'); }).catch(error => { setTaskStatus('ERROR', 'PNG 导出失败', 0); setExportStatus('ERROR', error.message, 0); toast(error.message); }); }
async function exportSingleFrame() { return exportPng4K(); }
async function exportSequence() { const frames = expandedExportFrames(); if (!frames.length) return toast('当前动作还没有帧'); setTaskStatus('WRITING FILE', '准备 PNG Sequence', .15); const sequenceScale = minimumExportScale(frames, 800, 900); setExportStatus('WRITING FILE', `透明 Sequence · ${sequenceScale}× · 最小 800×900`, .15); const sequence = buildSequenceCanvases(frames, sequenceScale); const basename = exportFilePrefix(); for (let i = 0; i < sequence.length; i++) { downloadBlob(await canvasBlob(sequence[i]), `${basename}_动作帧_${String(i + 1).padStart(3, '0')}_${sequence[i].width}x${sequence[i].height}.png`); const progress = (i + 1) / sequence.length; setExportStatus('WRITING FILE', `${i + 1} / ${sequence.length} 帧`, progress); await new Promise(r => setTimeout(r, 80)); } setTaskStatus('DONE', 'Sequence 导出完成', 1); setExportStatus('DONE', '透明 PNG Sequence 已写入下载目录', 1); toast('当前动作透明 PNG Sequence 已导出'); }
let browserFfmpeg = null;
let browserFfmpegLoad = null;
async function loadBrowserFfmpeg() {
  if (browserFfmpeg?.loaded) return browserFfmpeg;
  if (!browserFfmpegLoad) browserFfmpegLoad = import('/vendor/ffmpeg/index.js').then(async ({ FFmpeg }) => {
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({ coreURL: '/vendor/ffmpeg/ffmpeg-core.js', wasmURL: '/vendor/ffmpeg/ffmpeg-core.wasm' });
    browserFfmpeg = ffmpeg;
    return ffmpeg;
  }).catch(error => { browserFfmpegLoad = null; throw error; });
  return browserFfmpegLoad;
}
async function exportLocalMov() {
  const samples = expandedExportFrames(); if (!samples.length) return toast('当前动作还没有帧');
  const outputFps = exportPlaybackFps();
  let ffmpeg; const inputFiles = [];
  try {
    setTaskStatus('PREPARING', '加载本地透明 MOV 编码器', .05);
    setExportStatus('PREPARING', '首次使用会加载浏览器编码器 · 约 31 MB', .05);
    ffmpeg = await loadBrowserFfmpeg();
    const sequenceScale = minimumExportScale(samples, 800, 900);
    const sequence = buildSequenceCanvases(samples, sequenceScale);
    const width = sequence[0].width;
    const height = sequence[0].height;
    for (let i = 0; i < sequence.length; i++) {
      const png = await canvasBlob(sequence[i], 'image/png');
      const bytes = new Uint8Array(await png.arrayBuffer());
      const inputFile = `/input-${String(i).padStart(6, '0')}.png`;
      await ffmpeg.writeFile(inputFile, bytes); inputFiles.push(inputFile);
      setExportStatus('PREPARING', `${i + 1} / ${sequence.length} 帧已准备 · 本地`, .08 + .25 * ((i + 1) / sequence.length));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    setTaskStatus('ENCODING', '浏览器本地 ProRes 4444 编码中', .35);
    setExportStatus('ENCODING', `ProRes 4444 · ${width}×${height} · ${outputFps} FPS`, .35);
    await ffmpeg.exec([
      '-framerate', String(outputFps),
      '-start_number', '0',
      '-i', '/input-%06d.png',
      '-an',
      '-c:v', 'prores_aw',
      '-profile:v', '4',
      '-pix_fmt', 'yuva444p10le',
      '-r', String(outputFps),
      '-vendor', 'apl0',
      '-bits_per_mb', '8000',
      '/output-transparent.mov'
    ]);
    const output = await ffmpeg.readFile('/output-transparent.mov');
    const blob = new Blob([output], { type: 'video/quicktime' });
    downloadBlob(blob, `${exportFilePrefix()}_${state.scale}x_${outputFps}fps_ProRes4444_透明.mov`);
    state.lastExportError = '';
    state.lastExportInfo = `浏览器本地 FFmpeg WebAssembly 编码成功\n编码器：ProRes 4444\n像素格式：yuva444p10le\n输出 FPS：${outputFps}\n尺寸：${width}×${height}\n帧数：${sequence.length}\n服务端：未使用`;
    setTaskStatus('DONE', '本地 ProRes 4444 MOV 导出完成', 1);
    setExportStatus('DONE', `透明 MOV 已下载 · ProRes 4444 · ${outputFps} FPS`, 1);
    toast('透明 ProRes 4444 MOV 已在当前电脑完成导出');
  } catch (error) {
    state.lastExportError = error.message;
    state.lastExportInfo = `浏览器本地 ProRes 4444 编码失败\n浏览器：${navigator.userAgent}\n服务端：未使用\n错误：${error.message}`;
    setTaskStatus('ERROR', '本地 MOV 编码失败', 0);
    setExportStatus('ERROR', '已记录修理日志', 0);
    toast('透明 MOV 导出失败，请导出修理日志');
  } finally {
    if (ffmpeg?.loaded) {
      for (const inputFile of inputFiles) ffmpeg.deleteFile(inputFile).catch(() => {});
      ffmpeg.deleteFile('/output-transparent.mov').catch(() => {});
    }
  }
}
async function exportLocalGif() { const frames = expandedExportFrames(); if (!frames.length) return toast('当前动作还没有帧'); setTaskStatus('ENCODING', '浏览器本地 GIF 编码中', .2); setExportStatus('ENCODING', 'GIF 帧只在当前浏览器处理', .2); try { const gifScale = minimumExportScale(frames, 800, 900); const sequence = buildSequenceCanvases(frames, gifScale); const encoder = GIFEncoder(); const fps = exportPlaybackFps(); const settings = exportSettings(); for (let i = 0; i < sequence.length; i++) { const canvas = sequence[i]; const ctx = canvas.getContext('2d', { willReadFrequently: true }); const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data; const palette = quantize(rgba, 128, { format: 'rgba4444', oneBitAlpha: 128, clearAlpha: true }); const index = applyPalette(rgba, palette, 'rgba4444'); const transparentIndex = Math.max(0, palette.findIndex(color => color[3] === 0)); encoder.writeFrame(index, canvas.width, canvas.height, { palette, transparent: true, transparentIndex, delay: Math.max(10, Math.round(1000 / fps)), repeat: settings.loops === 0 ? 0 : -1, dispose: 2 }); setExportStatus('ENCODING', `${i + 1} / ${sequence.length} 帧 · GIF · ${canvas.width}×${canvas.height}`, (i + 1) / sequence.length); await new Promise(resolve => setTimeout(resolve, 0)); } encoder.finish(); downloadBlob(new Blob([encoder.bytes()], { type: 'image/gif' }), `${exportFilePrefix()}_${fps}fps_${sequence[0].width}x${sequence[0].height}_透明.gif`); setTaskStatus('DONE', 'GIF 导出完成', 1); setExportStatus('DONE', `透明 GIF 已下载 · ${sequence[0].width}×${sequence[0].height}`, 1); toast('浏览器本地高清透明 GIF 已导出'); } catch (error) { state.lastExportError = error.message; state.lastExportInfo = `GIF 本地编码失败\n浏览器：${navigator.userAgent}`; setTaskStatus('ERROR', 'GIF 导出失败', 0); setExportStatus('ERROR', '已记录修理日志', 0); toast('GIF 导出失败，请导出修理日志'); } }
function exportDiagnostics() { const text = ['Pixel Sprite Animator 修理日志', `时间：${new Date().toISOString()}`, `页面：${location.href}`, `浏览器：${navigator.userAgent}`, `平台：${navigator.platform}`, `当前动作：${currentAnimationName()}`, `帧数：${activeFrames().length}`, `FPS：${state.fps}`, `导出 FPS：${exportPlaybackFps()}`, `倍率：${state.scale}`, `预览速度：${state.previewSpeed}`, `错误：${state.lastExportError || '暂无错误'}`, state.lastExportInfo || '暂无编码信息'].join('\n'); downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'Pixel-Sprite-Animator_修理日志.txt'); toast('修理日志已下载'); }
function minimumExportScale(frameOrSamples, minWidth = 800, minHeight = 900) { if (!Array.isArray(frameOrSamples)) return Math.max(state.scale, Math.ceil(minWidth / Math.max(1, frameOrSamples.w)), Math.ceil(minHeight / Math.max(1, frameOrSamples.h))); const unit = exportUnit(frameOrSamples, 1, true); return Math.max(state.scale, Math.ceil(minWidth / Math.max(1, unit.width)), Math.ceil(minHeight / Math.max(1, unit.height))); }
function frameExportCanvas(frameOrSample) { const sample = frameOrSample?.entries ? frameOrSample : { frame: frameOrSample, entries: [{ frame: frameOrSample, layer: activeLayer() }], motionT: 1 }; const unit = exportUnit([sample], 1, true); const scale = Math.max(state.scale, Math.ceil(3840 / Math.max(1, unit.width)), Math.ceil(2160 / Math.max(1, unit.height))); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, unit.width * scale); canvas.height = Math.max(1, unit.height * scale); drawAligned(canvas.getContext('2d'), sample, unit, 0, 0, scale); return canvas; }
function selectedFrameForExport() { return currentExportSample(); }
async function exportCurrentFramePng() { const frame = selectedFrameForExport(); if (!frame) return toast('请先生成或选择一帧'); setTaskStatus('WRITING FILE', '导出当前帧 PNG', .5); try { const canvas = frameExportCanvas(frame); downloadBlob(await canvasBlob(canvas), `${exportFilePrefix()}_当前帧_${canvas.width}x${canvas.height}.png`); setTaskStatus('DONE', '当前帧 PNG 已导出', 1); setExportStatus('DONE', `${canvas.width}×${canvas.height} 透明 PNG 已下载`, 1); toast('当前帧已按像素边缘导出'); } catch (error) { setTaskStatus('ERROR', 'PNG 导出失败', 0); setExportStatus('ERROR', error.message, 0); toast(error.message); } }
async function exportAllFramesPng() { const samples = layerFrameSamples(); if (!samples.length) return toast('当前动作还没有帧'); setTaskStatus('WRITING FILE', '导出全部动作帧', .1); setExportStatus('WRITING FILE', `共 ${samples.length} 帧 · 最小 800×900`, .1); try { for (let i = 0; i < samples.length; i++) { const canvas = frameExportCanvas(samples[i]); downloadBlob(await canvasBlob(canvas), `${exportFilePrefix()}_动作帧_${String(i + 1).padStart(3, '0')}_${canvas.width}x${canvas.height}.png`); setExportStatus('WRITING FILE', `${i + 1} / ${samples.length} 帧`, (i + 1) / samples.length); await new Promise(resolve => setTimeout(resolve, 60)); } setTaskStatus('DONE', '全部动作帧已导出', 1); setExportStatus('DONE', `${samples.length} 张透明 PNG 已下载`, 1); toast('全部动作帧已按图层范围导出'); } catch (error) { setTaskStatus('ERROR', 'PNG 导出失败', 0); setExportStatus('ERROR', error.message, 0); toast(error.message); } }
function exportMenu() { $('exportPopover').classList.toggle('open'); }
function previewDetection() { if (!state.image || !state.selection) return toast('先框选一整个动作区域'); setTaskStatus('SCANNING', '扫描 Sprite 区域', .25); setTimeout(() => { state.detectedBoxes = detectBoxesInRegion(state.selection); drawSheet(); setTaskStatus('DONE', `检测到 ${state.detectedBoxes.length} 帧`, 1); toast(`检测到 ${state.detectedBoxes.length} 帧，点击“生成动作”确认`); }, 120); }
function syncMode() { const action = state.mode === 'action'; document.querySelectorAll('#modeSwitch button').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === state.mode)); $('sheetInstruction').textContent = action ? '框选一整个动作区域，自动拆成连续帧' : '单帧修正：框选一个角色后添加单帧'; $('actionButtons').style.display = action ? 'flex' : 'none'; $('addFrame').style.display = action ? 'none' : 'inline-block'; $('autoDetect').textContent = action ? '识别选区' : '检测单帧'; }
function newAnimation() { const n = state.animations.length + 1; const animation = { id: `animation-${Date.now()}-${crypto.randomUUID()}`, name: `动作 ${n}`, frameIds: [], motion: defaultMotion(), layers: defaultLayers(), playMode: 'once' }; state.animations.push(animation); state.animationOrder = ensureAnimationOrder(); state.activeAnimation = state.animations.length - 1; state.activeLayerId = null; state.selectedAnimationIds = new Set([animation.id]); state.selectedLayerIds.clear(); state.playIndex = 0; state.motionProgress = 0; state.motionDirection = 1; state.selectedFrameIds.clear(); syncMotionControls(); renderAnimations(); renderLayers(); renderFrames(); drawPreview(); toast(`已创建空动作 ${n}，框选区域后点击生成动作`); }
function newAnimationFromLayer() { const animation = activeAnimation(); const layers = ensureLayers(animation); const sheet = state.sheets.find(item => item.id === state.activeSheetId); const layer = { id: `sheet-layer-${Date.now()}`, name: `${sheet?.name?.replace(/\.[^.]+$/, '') || '新图层'} · 动作 ${layers.length + 1}`, mode: 'sequence', visible: true, opacity: 1, x: 0, y: 0, sheetId: state.activeSheetId, frameIds: [] }; ensureLayerSettings(layer); layers.push(layer); state.activeLayerId = layer.id; state.selectedLayerIds = new Set([layer.id]); state.selectedFrameIds.clear(); renderLayers(); renderFrames(); drawPreview(); generateAction('layer'); toast(`已创建独立图层 ${layer.name}，新帧不会继承之前动画`); }
function deleteFrame() { if (state.selectedFrame < 0) return; state.selectedFrameIds = new Set([state.frames[state.selectedFrame]?.id].filter(Boolean)); deleteSelectedFrames(); }
function deleteSelectedFrames() { const ids = expandFrameIds(state.selectedFrameIds); if (!ids.size) return toast('请先框选或 Shift 多选帧'); state.frames = state.frames.filter(frame => !ids.has(frame.id)); state.animations.forEach(animation => { animation.frameIds = animation.frameIds.filter(id => !ids.has(id)); animation.layers?.forEach(layer => { if (Array.isArray(layer.frameIds)) layer.frameIds = layer.frameIds.filter(id => !ids.has(id)); }); }); state.selectedFrameIds.clear(); state.selectedFrame = -1; state.playIndex = 0; renderAnimations(); renderLayers(); renderFrames(); drawPreview(); toast(`已删除 ${ids.size} 帧`); }
function copySelectedFrames() { const ids = expandFrameIds(state.selectedFrameIds); if (!ids.size) return toast('请先框选或 Shift 多选帧'); const animation = state.animations[state.activeAnimation]; const layer = ensureLayers(animation).find(item => item.id === state.activeLayerId); const order = layer?.frameIds?.length ? layer.frameIds : animation.frameIds; const selected = order.filter(id => ids.has(id)); if (!selected.length) return toast('当前图层没有选中的帧'); const copiedGroups = new Map(); const copies = selected.map(id => { const source = frameById(id); let groupId; if (source.groupId) { if (!copiedGroups.has(source.groupId)) copiedGroups.set(source.groupId, `frame-group-${crypto.randomUUID()}`); groupId = copiedGroups.get(source.groupId); } return { ...source, id: crypto.randomUUID(), groupId, layerState: source.layerState ? structuredClone(source.layerState) : undefined, canvas: source.canvas, dataUrl: source.dataUrl }; }); const copyIds = copies.map(frame => frame.id); state.frames.push(...copies); const insertAt = Math.max(0, order.indexOf(selected[selected.length - 1]) + 1); order.splice(insertAt, 0, ...copyIds); if (layer) { const animationAt = Math.max(0, animation.frameIds.indexOf(selected[selected.length - 1]) + 1); animation.frameIds.splice(animationAt, 0, ...copyIds); } state.selectedFrameIds = new Set(copyIds); state.selectedFrame = state.frames.length - copies.length; renderAnimations(); renderLayers(); renderFrames(); drawPreview(); toast(`已复制 ${copies.length} 帧`); }
function groupSelectedFrames() { const ids = [...expandFrameIds(state.selectedFrameIds)]; if (ids.length < 2) return toast('至少选择两帧才能打组'); const groupId = `frame-group-${crypto.randomUUID()}`; ids.forEach(id => { const frame = frameById(id); if (frame) frame.groupId = groupId; }); renderFrames(); renderTimelineGrid(); syncSelectionControls(); toast(`已将 ${ids.length} 帧打组`); }
function ungroupSelectedFrames() { const ids = expandFrameIds(state.selectedFrameIds); let count = 0; ids.forEach(id => { const frame = frameById(id); if (frame?.groupId) { delete frame.groupId; count++; } }); if (!count) return toast('所选帧没有分组'); renderFrames(); renderTimelineGrid(); syncSelectionControls(); toast(`已取消 ${count} 帧的分组`); }
function duplicateFrame() { state.selectedFrameIds = new Set([state.frames[state.selectedFrame]?.id].filter(Boolean)); copySelectedFrames(); }

 $('fileInput').addEventListener('change', e => { if (e.target.files?.length) loadFiles(e.target.files); e.target.value = ''; }); $('sheetLibraryInput')?.addEventListener('change', e => { if (e.target.files?.length) loadFiles(e.target.files); e.target.value = ''; });
$('loadSample').addEventListener('click', () => { const ryu = state.sheets.find(sheet => sheet.name === '隆_Ryu_完整精灵图.png'); if (ryu) activateSpriteSheet(ryu.id); else loadUrl('/assets/隆_Ryu_完整精灵图.png', '隆_Ryu_完整精灵图.png'); });
 $('autoDetect').addEventListener('click', previewDetection); $('generateAction').addEventListener('click', () => generateAction('new')); $('newLayerAnimation').addEventListener('click', newAnimationFromLayer); $('appendAction').addEventListener('click', () => generateAction('append')); $('addFrame').addEventListener('click', () => addFrame()); $('resetSelection').addEventListener('click', () => { state.selection = null; state.detectedBoxes = []; drawSheet(); $('addFrame').disabled = true; $('generateAction').disabled = true; $('newLayerAnimation').disabled = true; $('appendAction').disabled = true; }); $('clearSheet').addEventListener('click', () => { if (state.activeSheetId) removeSpriteSheet(state.activeSheetId); else { state.image = null; state.selection = null; state.detectedBoxes = []; sheetCanvas.hidden = true; $('sheetEmpty').hidden = false; $('sheetName').textContent = '未导入图片'; $('sheetMeta').textContent = '支持 PNG / GIF / WebP'; } });
$('modeSwitch').addEventListener('click', e => { const button = e.target.closest('button[data-mode]'); if (!button) return; state.mode = button.dataset.mode; syncMode(); });
 $('fps').addEventListener('input', e => { state.fps = clamp(Number(e.target.value) || 12, 1, 60); $('fpsReadout').textContent = state.fps; }); $('previewSpeed').addEventListener('change', e => { state.previewSpeed = Number(e.target.value) || .5; drawPreview(); }); $('scale').addEventListener('change', e => { const layer = activeLayer(); if (layer) layer.scale = Number(e.target.value) || state.scale; else state.scale = Number(e.target.value) || state.scale; syncMotionControls(); drawPreview(); }); $('motionEnabled').addEventListener('change', e => { const layer = activeLayer(); if (layer) layer.motionEnabled = e.target.checked; else state.motionEnabled = e.target.checked; syncMotionControls(); drawPreview(); }); $('motionAmount').addEventListener('input', e => { const layer = activeLayer(); if (layer) layer.motionAmount = clamp(Number(e.target.value) || 0, 0, 6); else state.motionAmount = clamp(Number(e.target.value) || 0, 0, 6); syncMotionControls(); drawPreview(); }); $('motionModeSimple').addEventListener('change', e => { const m = motionConfig(); m.mode = e.target.value; m.loop = m.mode === 'static' ? 'static' : 'once'; m.startX = 0; m.startY = 0; m.endY = 0; if (m.mode === 'static') { m.endX = 0; m.height = 0; } else { if (!Number(m.endX)) m.endX = 96; if (m.mode === 'jump' && !Number(m.height) && previewFrames().length) m.height = Math.max(1, 120 / averageCharacterHeight()); } syncMotionControls(); drawPreview(); }); $('motionDistance').addEventListener('input', e => { const m = motionConfig(); m.endX = clamp(Number(e.target.value) || 0, 0, 320); if (m.mode === 'static' && m.endX > 0) m.mode = 'linear'; syncMotionControls(); drawPreview(); }); $('motionHeight').addEventListener('input', e => { const m = motionConfig(); m.height = clamp(Number(e.target.value) || 0, 0, 240) / Math.max(1, averageCharacterHeight()); syncMotionControls(); drawPreview(); }); $('exportLayerScope')?.addEventListener('change', e => { state.exportLayerScope = e.target.value; }); $('pickBackground')?.addEventListener('click', () => { state.backgroundPicking = true; sheetCanvas.style.cursor = 'crosshair'; toast('请在 Sprite Sheet 上点击一个背景像素'); return; }); $('backgroundViewMode')?.addEventListener('change', e => { state.backgroundView = e.target.value; drawSheet(); }); $('panelRatio').addEventListener('input', e => { state.panelRatio = clamp(Number(e.target.value) || 75, 40, 80); resizeWorkspacePanels(); }); $('frameDuration')?.addEventListener('change', e => { const f = state.frames[state.selectedFrame]; if (f) { f.duration = Number(e.target.value); drawPreview(); } }); $('playPause').addEventListener('click', () => { if (!previewFrames().length) return toast('请先生成或选择一个动作'); state.playing = !state.playing; state.lastTick = performance.now(); $('playPause').textContent = state.playing ? 'Ⅱ' : '▶'; }); $('prevFrame').addEventListener('click', () => { const len = previewFrames().length; if (len) { state.playing = false; state.playIndex = (state.playIndex - 1 + len) % len; $('playPause').textContent = '▶'; drawPreview(); } }); $('nextFrame').addEventListener('click', () => { const len = previewFrames().length; if (len) { state.playing = false; state.playIndex = (state.playIndex + 1) % len; $('playPause').textContent = '▶'; drawPreview(); } });
 $('sheetZoomIn').addEventListener('click', () => { state.sheetZoom = clamp(state.sheetZoom * 1.5, .25, 6); syncSheetZoom(); }); $('sheetZoomOut').addEventListener('click', () => { state.sheetZoom = clamp(state.sheetZoom / 1.5, .25, 6); syncSheetZoom(); }); $('sheetZoomReset').addEventListener('click', () => { state.sheetZoom = 1; syncSheetZoom(); }); $('previewResetView').addEventListener('click', () => { state.previewZoom = 1; state.cameraX = 0; state.cameraY = 0; $('previewZoomLabel').textContent = '100%'; drawPreview(); }); $('previewZoomIn').addEventListener('click', () => { state.previewZoom = clamp(state.previewZoom * 1.5, .25, 12); $('previewZoomLabel').textContent = `${Math.round(state.previewZoom * 100)}%`; drawPreview(); }); $('previewZoomOut').addEventListener('click', () => { state.previewZoom = clamp(state.previewZoom / 1.5, .25, 12); $('previewZoomLabel').textContent = `${Math.round(state.previewZoom * 100)}%`; drawPreview(); }); $('newAnimation').addEventListener('click', newAnimation); $('deleteSelectedFrames')?.addEventListener('click', deleteSelectedFrames); $('addLayer').addEventListener('click', () => { const layers = ensureLayers(); const layer = { id: `layer-${Date.now()}`, name: `新图层 ${layers.length + 1}`, mode: 'sequence', visible: true, opacity: 1, x: 0, y: 0, frameIds: [] }; ensureLayerSettings(layer); layers.push(layer); state.activeLayerId = layer.id; state.selectedLayerIds = new Set([layer.id]); renderLayers(); renderFrames(); syncMotionControls(); toast('已添加图层'); }); $('exportMenu').addEventListener('click', exportMenu); $('exportCurrentFrame').addEventListener('click', () => { $('exportPopover').classList.remove('open'); exportCurrentFramePng(); }); $('exportAllFrames').addEventListener('click', () => { $('exportPopover').classList.remove('open'); exportAllFramesPng(); }); $('exportSequence').addEventListener('click', () => { $('exportPopover').classList.remove('open'); exportSequence(); }); $('exportLocalGif').addEventListener('click', () => { $('exportPopover').classList.remove('open'); exportLocalGif(); }); $('exportLocalMov').addEventListener('click', () => { $('exportPopover').classList.remove('open'); exportLocalMov(); }); $('exportDiagnostics').addEventListener('click', () => { $('exportPopover').classList.remove('open'); exportDiagnostics(); });

function previewPoint(event) {
  const rect = previewCanvas.getBoundingClientRect();
  const fit = Math.min(rect.width / previewCanvas.width, rect.height / previewCanvas.height);
  const contentWidth = previewCanvas.width * fit, contentHeight = previewCanvas.height * fit;
  const offsetX = (rect.width - contentWidth) / 2, offsetY = (rect.height - contentHeight) / 2;
  return {
    x: clamp((event.clientX - rect.left - offsetX) / Math.max(.0001, fit), 0, previewCanvas.width),
    y: clamp((event.clientY - rect.top - offsetY) / Math.max(.0001, fit), 0, previewCanvas.height)
  };
}
function motionHandleAt(point, z) { const m = motionConfig(); const layer = activeLayer(); if (!layer || m.mode === 'static') return null; const origin = previewOrigin(z); const offsetX = Number(layer.x) || 0, offsetY = Number(layer.y) || 0; const toScreen = p => ({ x: origin.x + (p.x + offsetX) * z, y: origin.y + (p.y + offsetY) * z }); const start = toScreen({ x: m.startX, y: m.startY }); const end = toScreen({ x: m.endX, y: m.endY }); if (Math.hypot(point.x - start.x, point.y - start.y) < 18) return 'start'; if (Math.hypot(point.x - end.x, point.y - end.y) < 18) return 'end'; if (m.mode === 'jump') { const h = toScreen({ x: (m.startX + m.endX) / 2, y: (m.startY + m.endY) / 2 - motionPixelHeight(m, layer) }); if (Math.hypot(point.x - h.x, point.y - h.y) < 18) return 'height'; } if (m.mode === 'custom') { const c = toScreen({ x: m.controlX ?? (m.startX + m.endX) / 2, y: m.controlY ?? (m.startY + m.endY) / 2 }); if (Math.hypot(point.x - c.x, point.y - c.y) < 18) return 'control'; } return null; }
function lockPreviewForDrag(z) { state.previewScaleLock = z; const origin = previewOrigin(z); state.previewOriginLock = { z, x: origin.x, y: origin.y }; }
previewCanvas.addEventListener('pointerdown', event => { if (!previewFrames().length) return; previewCanvas.setPointerCapture(event.pointerId); const p = previewPoint(event); const z = previewRenderScale(); const layerHandle = layerHandleAt(p, z); if (layerHandle) { const layer = layerHandle.layer; const additive = event.shiftKey || event.metaKey || event.ctrlKey; if (!additive) state.selectedLayerIds = new Set([layer.id]); else if (state.selectedLayerIds.has(layer.id)) state.selectedLayerIds.delete(layer.id); else state.selectedLayerIds.add(layer.id); state.activeLayerId = layer.id; state.playIndex = 0; state.motionProgress = 0; state.selectedFrameIds.clear(); syncMotionControls(); renderLayers(); renderFrames(); lockPreviewForDrag(z); state.layerDrag = layerHandle; previewCanvas.style.cursor = 'move'; return; } const handle = motionHandleAt(p, z); if (handle) { lockPreviewForDrag(z); state.motionDrag = handle; previewCanvas.style.cursor = 'crosshair'; return; } state.draggingPreview = true; state.dragStart = { x: p.x, y: p.y, cameraX: state.cameraX, cameraY: state.cameraY }; previewCanvas.style.cursor = 'grabbing'; });
previewCanvas.addEventListener('pointermove', event => { const p = previewPoint(event); if (state.layerDrag) { const z = state.previewScaleLock || previewRenderScale(); const origin = previewOrigin(z); const travel = layerMotionPosition(previewMotionT(), state.layerDrag.layer); const scale = layerDisplayScale(state.layerDrag.layer); const frame = state.layerDrag.frame; // Position the layer by its visible center so the first drag never snaps its top-left corner to the pointer.
    state.layerDrag.layer.x = Math.round((p.x - origin.x) / z - travel.x + frame.anchorX * scale - frame.w * scale / 2);
    state.layerDrag.layer.y = Math.round((p.y - origin.y) / z - travel.y + frame.anchorY * scale - frame.h * scale / 2);
    renderLayers(); drawPreview(); return; } if (state.motionDrag) { const m = motionConfig(); const layer = activeLayer(); const z = state.previewScaleLock || previewRenderScale(); const origin = previewOrigin(z); const sx = Math.round((p.x - origin.x) / z - (Number(layer?.x) || 0)), sy = Math.round((p.y - origin.y) / z - (Number(layer?.y) || 0)); if (state.motionDrag === 'start') { m.startX = sx; m.startY = sy; } else if (state.motionDrag === 'end') { m.endX = sx; m.endY = sy; } else if (state.motionDrag === 'height') { m.height = Math.max(0, Math.round(((m.startY + m.endY) / 2 - sy) / averageCharacterHeight() * 2) / 2); } else if (state.motionDrag === 'control') { m.controlX = sx; m.controlY = sy; } syncMotionControls(); drawPreview(); return; } if (!state.draggingPreview || !state.dragStart) return; state.cameraX = state.dragStart.cameraX + p.x - state.dragStart.x; state.cameraY = state.dragStart.cameraY + p.y - state.dragStart.y; drawPreview(); });
const endPreviewDrag = () => { const lock = state.previewOriginLock; state.draggingPreview = false; state.motionDrag = null; state.layerDrag = null; state.dragStart = null; state.previewOriginLock = null; if (lock) { const current = previewOrigin(lock.z); state.cameraX += lock.x - current.x; state.cameraY += lock.y - current.y; } state.previewScaleLock = null; previewCanvas.style.cursor = 'grab'; drawPreview(); };
previewCanvas.addEventListener('pointerup', endPreviewDrag); previewCanvas.addEventListener('pointercancel', endPreviewDrag);
previewCanvas.addEventListener('wheel', event => { if (!activeFrames().length) return; event.preventDefault(); const p = previewPoint(event); const centerX = previewCanvas.width / 2, centerY = previewCanvas.height * .82; const oldZoom = state.previewZoom; const nextZoom = clamp(oldZoom * Math.pow(1.0018, -event.deltaY), .25, 12); if (nextZoom === oldZoom) return; const oldScale = previewRenderScale(oldZoom), newScale = previewRenderScale(nextZoom); if (newScale !== oldScale) { state.cameraX = (p.x - centerX) * (1 - newScale / oldScale) + state.cameraX * newScale / oldScale; state.cameraY = (p.y - centerY) * (1 - newScale / oldScale) + state.cameraY * newScale / oldScale; } state.previewZoom = nextZoom; $('previewZoomLabel').textContent = `${Math.round(nextZoom * 100)}%`; drawPreview(); }, { passive: false });

// Mirror the FPS control into the active layer after the legacy animation-wide
// handler runs, while retaining the global value as the no-layer fallback.
$('fps')?.addEventListener('input', event => { const layer = activeLayer(); if (layer) layer.fps = clamp(Number(event.target.value) || 12, 1, 60); });
 $('copySelectedFrames')?.addEventListener('click', copySelectedFrames); $('groupSelectedFrames')?.addEventListener('click', groupSelectedFrames); $('ungroupSelectedFrames')?.addEventListener('click', ungroupSelectedFrames);
 $('sequencePlayback')?.addEventListener('change', event => { state.sequenceEnabled = event.target.checked; state.sequenceClipIndex = 0; restartPreviewPlayback(); });
 $('motionModeSimple')?.addEventListener('change', () => { restartPreviewPlayback(); });
 $('motionDistance')?.addEventListener('change', () => { if (motionConfig().loop === 'once') restartPreviewPlayback(); }); $('motionHeight')?.addEventListener('change', () => { if (motionConfig().loop === 'once') restartPreviewPlayback(); });
 $('playPause')?.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); if (!previewFrames().length) return toast('请先生成或选择一个动作'); if (state.playing) { state.playing = false; $('playPause').textContent = '▶'; } else if ((state.sequenceEnabled && orderedAnimations().length > 1 && state.sequenceClipIndex >= orderedAnimations().length - 1 && state.playIndex >= previewFrames().length - 1) || (motionConfig().loop === 'once' && state.playIndex >= previewFrames().length - 1)) restartPreviewPlayback(); else { state.playing = true; state.lastTick = performance.now(); $('playPause').textContent = 'Ⅱ'; } }, true);
ensureExportIdentityControl(); renderAnimations(); renderLayers(); renderFrames(); syncSelectionControls(); syncMotionControls(); initWorkspaceResizers(); drawPreview(); syncMode(); requestAnimationFrame(tick); loadBuiltinLibrary();
