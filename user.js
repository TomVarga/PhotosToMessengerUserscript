// ==UserScript==
// @name         Google Photos → Facebook Messenger (Direct Upload) + Album
// @namespace    https://github.com/TomVarga/PhotosToMessengerUserscript
// @version      1.4.4
// @description  Select photos/videos in Google Photos and send them directly to a Messenger chat as file uploads, AND add to a Google Photos album.
// @updateURL    https://github.com/TomVarga/PhotosToMessengerUserscript/raw/refs/heads/main/user.js
// @downloadURL  https://github.com/TomVarga/PhotosToMessengerUserscript/raw/refs/heads/main/user.js
// @author       Tom Varga
// @match        https://photos.google.com/*
// @match        https://www.facebook.com/messages/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      *
// @connect      lh3.googleusercontent.com
// @connect      *.googleusercontent.com
// @connect      *.usercontent.google.com
// @connect      photos.fife.usercontent.google.com
// @connect      *.fife.usercontent.google.com
// @connect      video-downloads.googleusercontent.com
// @connect      *.googlevideo.com
// @connect      www.facebook.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'gp2messenger_queue';
  const ALBUM_NAME_KEY = 'gp2messenger_album_name';
  const BUTTON_ID   = 'gp2m-send-btn';
  const PANEL_ID    = 'gp2m-panel';
  const INPUT_WRAPPER_ID = 'gp2m-input-wrapper';
  const ALBUM_INPUT_ID = 'gp2m-album-input';
  const MAX_FILES   = 10;
  const POLL_MS     = 800;
  const DATA_CHUNK_SIZE = 256 * 1024;
  const LARGE_VIDEO_THRESHOLD_BYTES = 30 * 1024 * 1024;

  const DEBUG = false;
  const log  = (...a) => console.log('[GP→Messenger]', ...a);
  const dlog = (...a) => { if (DEBUG) console.log('[GP→Messenger]', ...a); };
  const warn = (...a) => console.warn('[GP→Messenger]', ...a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── Route to the right side ───────────────────────────────────────────────
  log(`Script loaded on ${location.hostname}${location.pathname}`);

  if (location.hostname === 'www.facebook.com' && location.pathname.startsWith('/messages')) {
    log('Running on Facebook Messenger side');
    messengerSide();
    return;
  }

  if (location.hostname === 'photos.google.com') {
    log('Running on Google Photos side - using floating Messenger FAB + Album input');
    googlePhotosSide();
    return;
  }

  warn(`Script running on unexpected domain: ${location.hostname}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // GOOGLE PHOTOS SIDE
  // ═══════════════════════════════════════════════════════════════════════════
  function googlePhotosSide() {
    injectStyles();
    createAlbumInputWrapper();
    createFloatingButton();
    observeButtonRoot();
    let lastSelectedCount = 0;

    setInterval(createFloatingButton, 3000);
    setInterval(createAlbumInputWrapper, 3000);

    setInterval(() => {
      const selected = getSelectedItems();
      const btn = document.getElementById(BUTTON_ID);
      if (!btn) return;

      const text = selected.length > 1 ? `📤 Send ${selected.length} to Messenger` : '📤 Send to Messenger';
      btn.textContent = text;
      btn.disabled = selected.length === 0;
      btn.style.opacity = selected.length === 0 ? '0.65' : '1';

      if (selected.length !== lastSelectedCount) {
        lastSelectedCount = selected.length;
        log(`Selection changed: ${selected.length} items`);
      }
    }, POLL_MS);

    document.addEventListener('click', (e) => {
      const photoElement = e.target.closest('[data-photo-id], [data-video-id], [role="img"], img, [role="checkbox"], a.p137Zd, div.rtIMgb');
      if (photoElement) {
        setTimeout(() => {
          const selected = getSelectedItems();
          const btn = document.getElementById(BUTTON_ID);
          if (btn) {
            btn.textContent = selected.length > 1 ? `📤 Send ${selected.length} to Messenger` : '📤 Send to Messenger';
            log(`Selection detected after click: ${selected.length} items`);
          }
        }, 100);
      }
    });
  }

  // ── Album Input Field Functions ───────────────────────────────────────
  function createAlbumInputWrapper() {
    if (document.getElementById(INPUT_WRAPPER_ID)) return;

    const wrapper = document.createElement('div');
    wrapper.id = INPUT_WRAPPER_ID;

    const input = document.createElement('input');
    input.id = ALBUM_INPUT_ID;
    input.type = 'text';
    input.placeholder = 'Album name (optional)';
    input.autocomplete = 'off';

    // FIXED: GM_getValue is synchronous
    const savedValue = GM_getValue(ALBUM_NAME_KEY, '');
    if (savedValue) input.value = savedValue;

    input.addEventListener('change', (e) => {
      GM_setValue(ALBUM_NAME_KEY, e.target.value.trim());
    });

    input.addEventListener('blur', (e) => {
      GM_setValue(ALBUM_NAME_KEY, e.target.value.trim());
    });

    wrapper.appendChild(input);

    const root = document.body || document.documentElement;
    root.appendChild(wrapper);
    log('Album input wrapper injected');
  }

  function getAlbumName() {
    const input = document.getElementById(ALBUM_INPUT_ID);
    return input ? input.value.trim() : '';
  }

  // ── FAB creation positioned below input ──────────────────────────
  function createFloatingButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.textContent = '📤 Send to Messenger';
    btn.disabled = true;
    btn.style.display = 'inline-flex';
    btn.style.position = 'fixed';
    btn.style.right = '24px';
    btn.style.bottom = '84px';
    btn.style.zIndex = '2147483647';
    btn.style.opacity = '0.65';
    btn.style.cursor = 'pointer';
    btn.style.background = '#1877f2';
    btn.style.color = '#fff';
    btn.style.border = 'none';
    btn.style.borderRadius = '28px';
    btn.style.padding = '12px 18px';
    btn.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    btn.style.fontSize = '13px';
    btn.style.fontWeight = '600';
    btn.style.gap = '6px';
    btn.style.boxShadow = '0 20px 40px rgba(0, 0, 0, 0.24)';
    btn.style.whiteSpace = 'nowrap';
    btn.onclick = onSendClick;
    btn.title = 'Click to queue selected media and open Messenger. Shift-click to clear any pending queue.';

    const root = document.body || document.documentElement;
    root.appendChild(btn);
    log('Floating action button injected');
  }

  function observeButtonRoot() {
    const root = document.body || document.documentElement;
    if (!root) return;
    const observer = new MutationObserver(() => {
      if (!document.getElementById(BUTTON_ID)) {
        log('Floating action button removed, recreating');
        createFloatingButton();
      }
      if (!document.getElementById(INPUT_WRAPPER_ID)) {
        log('Album input wrapper removed, recreating');
        createAlbumInputWrapper();
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  // ── Item selection logic ────────────────────────────────────────
  function getSelectedItems() {
    const items = [];
    const seen = new Set();

    const normalizeUrl = url => url && url.replace(/\?authuser=\d+/, '');
    const extractBackgroundImage = el => {
      if (!el) return null;
      const style = el.getAttribute('style') || el.style.backgroundImage || '';
      const match = /background-image:\s*url\(["']?(.*?)["']?\)/.exec(style);
      return match ? match[1] : null;
    };

    const findDetailLink = el => {
      if (!el) return null;
      const anchor =
        el.closest('a.p137Zd') ||
        el.querySelector('a.p137Zd') ||
        el.querySelector('a[href*="/photo/"]') ||
        el.querySelector('a[href*="/video/"]') ||
        el.querySelector('a[href^="./photo"]') ||
        el.querySelector('a[href^="./video"]');
      if (!anchor) return null;
      const href = anchor.href || anchor.getAttribute('href');
      if (!href) return null;
      try { return new URL(href, location.origin).href; } catch { return null; }
    };

    const isVideoItem = item => {
      if (!item) return false;
      const ariaLabel = (item.getAttribute('aria-label') || '').toLowerCase();
      if (ariaLabel.includes('video')) return true;
      const detailAnchor = item.querySelector('a.p137Zd[aria-label*="video" i], a[href*="/video/"]');
      if (detailAnchor) return true;
      const text = (item.textContent || '').toLowerCase();
      return text.includes('duration') && text.includes(':');
    };

    const extractFromItem = item => {
      if (!item) return null;
      const detailHref = findDetailLink(item);
      const img = item.querySelector('img[src]');
      if (img && img.src && !img.src.includes('avatar') && !img.src.includes('icon')) {
        return { type: isVideoItem(item) ? 'video' : 'image', thumbSrc: normalizeUrl(img.src), detailHref };
      }
      const vid = item.querySelector('video[src], [role="img"] video[src]');
      if (vid && vid.src) {
        return { type: 'video', thumbSrc: normalizeUrl(vid.src), detailHref };
      }
      const bg = extractBackgroundImage(item.querySelector('[style*="background-image"]') || item);
      if (bg) {
        return { type: isVideoItem(item) ? 'video' : 'image', thumbSrc: normalizeUrl(bg), detailHref };
      }
      return null;
    };

    const addItem = item => {
      const parsed = extractFromItem(item);
      if (parsed && parsed.thumbSrc && !seen.has(parsed.thumbSrc)) {
        seen.add(parsed.thumbSrc);
        items.push(parsed);
      }
    };

    const findItemRoot = el => el.closest('a.p137Zd, div.rtIMgb, div[data-photo-id], div[data-video-id], div[role="checkbox"]');

    const selectedBoxes = Array.from(document.querySelectorAll('[role="checkbox"][aria-checked="true"]'));
    dlog(`Method 1: Found ${selectedBoxes.length} selected checkboxes`);
    selectedBoxes.forEach(box => {
      const itemRoot = box.closest('div.rtIMgb') || box.closest('a.p137Zd') || findItemRoot(box.parentElement);
      addItem(itemRoot || box);
    });

    if (!items.length) {
      const selectedEls = Array.from(document.querySelectorAll('[aria-selected="true"]'));
      dlog(`Method 2: Found ${selectedEls.length} aria-selected=true elements`);
      selectedEls.forEach(el => {
        const itemRoot = findItemRoot(el);
        addItem(itemRoot || el);
      });
    }

    if (!items.length) {
      const dataSelectedEls = Array.from(document.querySelectorAll('[data-selected="true"]'));
      dlog(`Method 3: Found ${dataSelectedEls.length} data-selected=true elements`);
      dataSelectedEls.forEach(el => addItem(findItemRoot(el) || el));
    }

    if (!items.length) {
      const checkedInputs = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'));
      dlog(`Method 4: Found ${checkedInputs.length} checked input elements`);
      checkedInputs.forEach(input => addItem(findItemRoot(input) || input));
    }

    dlog(`Total selected items found: ${items.length}`);
    return items;
  }

  function getFullResUrl(src) {
    if (!src) return src;
    try {
      const normalized = src.replace(/(=w\d+(-h\d+)?(-no)?)(\?.*)?$/, '=d');
      return normalized;
    } catch {
      return src;
    }
  }

  async function fetchDetailPageHtml(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`Detail page failed: ${res.status}`);
    return await res.text();
  }

  function extractMediaUrlsFromHtml(html) {
    const urls = new Set();
    const patterns = [
      /https:\/\/photos\.fife\.usercontent\.google\.com\/[\w\-\/=%]+/g,
      /https:\/\/lh3\.googleusercontent\.com\/[\w\-\/=%]+/g,
      /https:\/\/[^"'\s]+googlevideo\.com\/[\w\-\/=%?&;,.:]+/g,
    ];
    patterns.forEach(re => {
      const matches = html.match(re);
      if (matches) matches.forEach(url => urls.add(url));
    });
    return Array.from(urls);
  }

  async function fetchVideoBlob(item) {
    log(`Fetching video for item: ${item.detailHref}`);
    if (item.detailHref) {
      try {
        const html = await fetchDetailPageHtml(item.detailHref);
        const videoUrls = findAllVideoUrlsInPage(html);
        log(`Found ${videoUrls.length} potential video URLs in detail page`);
        for (const url of videoUrls) {
          try {
            const blob = await fetchBlob(url);
            if (blob && blob.size > 0 && (blob.type.startsWith('video/') || blob.type.includes('stream'))) {
              log(`✓ Video blob fetched: ${blob.type}, ${blob.size} bytes`);
              return { blob, sourceUrl: url };
            }
          } catch (err) {
            warn(`Video URL candidate failed: ${url.slice(0, 60)}`, err.message);
          }
        }
      } catch (err) {
        warn('Could not process detail page:', err);
      }
    }
    throw new Error('Could not obtain video file. Try downloading manually with Shift+D and saving to a known location.');
  }

  function findAllVideoUrlsInPage(html) {
    const urls = new Set();
    const googleVideoPattern = /https:\/\/[^"'\s]+googlevideo\.com[^"'\s]*/g;
    const googleVideoMatches = html.match(googleVideoPattern);
    if (googleVideoMatches) {
      googleVideoMatches.forEach(url => {
        const clean = url.replace(/['">\s].*$/, '');
        if (clean.length > 20) urls.add(clean);
      });
    }
    const jsonUrlPattern = /"url":"(https:\/\/[^"]+)"/g;
    let match;
    while ((match = jsonUrlPattern.exec(html)) !== null) {
      const url = match[1];
      if (url.includes('video') || url.includes('media') || url.includes('stream')) {
        urls.add(url);
      }
    }
    const mediaCachePattern = /https:\/\/[^"'\s]*(?:lh3\.googleusercontent|photos\.fife)[^"'\s]*=/g;
    const mediaCacheMatches = html.match(mediaCachePattern);
    if (mediaCacheMatches) {
      mediaCacheMatches.forEach(baseUrl => {
        ['=dv', '=dv-rw', '=dv-no', '=d', '=d-rw'].forEach(param => {
          urls.add(baseUrl.replace(/=[^&"'\s]*$/, param));
        });
      });
    }
    const srcPattern = /src="([^"]*(?:blob:|video)[^"]*)"/g;
    while ((match = srcPattern.exec(html)) !== null) {
      urls.add(match[1]);
    }
    log(`Pattern matching found ${urls.size} candidate URLs`);
    return Array.from(urls).filter(url => url && url.length > 15);
  }

  async function fetchBlob(url) {
    const normalizedUrl = url.trim();
    const isGoogleMedia = /(?:googleusercontent\.com|fife\.usercontent\.google\.com|googlevideo\.com)/i.test(normalizedUrl);
    const fetchers = isGoogleMedia
      ? [fetchBlobViaTampermonkey, fetchBlobViaBrowser, fetchBlobViaBrowserNoCors]
      : [fetchBlobViaBrowser, fetchBlobViaBrowserNoCors, fetchBlobViaTampermonkey];
    let lastError = null;

    for (const fn of fetchers) {
      try {
        const blob = await fn(normalizedUrl);
        if (blob && blob.size > 0) {
          log(`Fetched blob via ${fn.name}:`, blob.type, blob.size, 'bytes');
          return blob;
        }
      } catch (err) {
        lastError = err;
        warn(`fetchBlob ${fn.name} failed:`, err && err.message ? err.message : err);
      }
    }
    throw lastError || new Error('Failed to fetch blob');
  }

  async function fetchBlobViaBrowser(url) {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'include',
      redirect: 'follow',
      cache: 'no-store',
    });
    if (response.ok || response.type === 'opaque') {
      return await response.blob();
    }
    throw new Error(`Browser fetch failed: ${response.status} ${response.statusText}`);
  }

  async function fetchBlobViaBrowserNoCors(url) {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      credentials: 'include',
      redirect: 'follow',
      cache: 'no-store',
    });
    if (response) {
      return await response.blob();
    }
    throw new Error('Browser no-cors fetch failed');
  }

  function fetchBlobViaTampermonkey(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'blob',
        headers: { Referer: 'https://photos.google.com/' },
        onload: r => resolve(r.response),
        onerror: reject,
      });
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function chunkString(str, size) {
    const chunks = [];
    for (let i = 0; i < str.length; i += size) {
      chunks.push(str.slice(i, i + size));
    }
    return chunks;
  }

  function generateChunkKey(itemId, index) {
    return `${STORAGE_KEY}_chunk_${itemId}_${index}`;
  }

  function deleteInlineChunksFromMetadata(metadata) {
    if (!Array.isArray(metadata) || !metadata.length) return;
    for (const item of metadata) {
      if (!item.id || !item.chunkCount) continue;
      for (let index = 0; index < item.chunkCount; index++) {
        GM_deleteValue(generateChunkKey(item.id, index));
      }
    }
  }

  function hasExpectedMimeType(blob, mediaKind) {
    const type = (blob && blob.type ? blob.type : '').toLowerCase();
    if (!type) return false;
    if (mediaKind === 'image') return type.startsWith('image/');
    if (mediaKind === 'video') return type.startsWith('video/') || type.includes('stream');
    return false;
  }

  // FIXED: Removed async/await from GM storage functions (they are synchronous)
  async function saveQueue(queue) {
    deleteInlineChunksFromMetadata(getQueueMetadata());
    const metadata = [];
    for (const item of queue) {
      if (item.transferMode === 'remoteFetch') {
        metadata.push({
          transferMode: 'remoteFetch',
          filename: item.filename,
          mimeType: item.mimeType,
          sourceUrl: item.sourceUrl,
          sizeBytes: item.sizeBytes || null,
        });
      } else {
        const itemId = `item_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const chunks = chunkString(item.dataUrl, DATA_CHUNK_SIZE);
        for (let index = 0; index < chunks.length; index++) {
          GM_setValue(generateChunkKey(itemId, index), chunks[index]);
        }
        metadata.push({
          transferMode: 'inlineDataUrl',
          id: itemId,
          filename: item.filename,
          mimeType: item.mimeType,
          chunkCount: chunks.length
        });
      }
    }
    GM_setValue(STORAGE_KEY, JSON.stringify(metadata));
    return metadata;
  }

  // FIXED: Made synchronous
  function getQueueMetadata() {
    const raw = GM_getValue(STORAGE_KEY, null);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function loadQueue() {
    const metadata = getQueueMetadata();
    if (!metadata?.length) return null;
    const queue = [];
    for (const item of metadata) {
      if (item.transferMode === 'remoteFetch') {
        queue.push({
          transferMode: 'remoteFetch',
          filename: item.filename,
          mimeType: item.mimeType,
          sourceUrl: item.sourceUrl,
          sizeBytes: item.sizeBytes || null,
        });
        continue;
      }
      let dataUrl = '';
      for (let index = 0; index < item.chunkCount; index++) {
        const chunk = GM_getValue(generateChunkKey(item.id, index), null);
        if (chunk === null) throw new Error(`Missing queue chunk ${index} for ${item.id}`);
        dataUrl += chunk;
      }
      queue.push({ transferMode: 'inlineDataUrl', filename: item.filename, mimeType: item.mimeType, dataUrl });
    }
    return queue;
  }

  async function clearQueue() {
    deleteInlineChunksFromMetadata(getQueueMetadata());
    GM_setValue(STORAGE_KEY, null);
  }

  // ── Add selected items to a Google Photos album (DOM automation) ───────────
  function gpNorm(s) {
    return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function gpIsVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return false;
    return true;
  }

  function gpFindDialogRoot() {
    return (
      document.querySelector('[role="dialog"][aria-modal="true"]') ||
      document.querySelector('[role="dialog"]') ||
      document.querySelector('[aria-modal="true"]')
    );
  }

  function gpGetAlbumPickerScope() {
    return gpFindDialogRoot() || document;
  }

  function gpSetReactInputValue(input, value) {
    if (!input) return;
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertReplacementText' }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function gpActivateElement(el) {
    if (!el) return false;
    const target =
      el.closest('[role="option"], [role="menuitem"], li, button, [role="button"]') ||
      el;
    try {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch {}
    try {
      target.focus({ preventScroll: true });
    } catch {}
    if (typeof PointerEvent !== 'undefined') {
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0 }));
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse', button: 0 }));
    }
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
    target.click();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    return true;
  }

  async function gpConfirmAlbumSelection(timeoutMs = 1800) {
    const confirmBtn = await waitFor(
      () => {
        const scope = gpGetAlbumPickerScope();
        return (
          gpFindClickableByPhrases(scope, ['done', 'add', 'save'], { exclude: ['create'] }) ||
          gpFindClickableByPhrases(scope, ['done', 'add to album', 'save'])
        );
      },
      timeoutMs
    );
    if (confirmBtn) {
      gpActivateElement(confirmBtn);
      await sleep(450);
    }
  }

  function gpCollectClickables(root) {
    if (!root) return [];
    return Array.from(
      root.querySelectorAll(
        'button, [role="button"], [role="menuitem"], [role="option"], [role="listitem"], a[href="#"], a[role="button"]'
      )
    ).filter(gpIsVisible);
  }

  function gpFindClickableByPhrases(root, phrases, { exclude = [] } = {}) {
    const need = phrases.map(gpNorm);
    const skip = exclude.map(gpNorm);
    for (const el of gpCollectClickables(root)) {
      const t = gpNorm(el.textContent);
      if (skip.some(s => s && t.includes(s))) continue;
      if (need.some(p => p && t.includes(p))) return el;
    }
    return null;
  }

  /** Prefer "Album" over "Shared album" etc. */
  function gpFindAlbumMenuEntry(root = document) {
    const items = Array.from(
      root.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"], [role="listitem"]')
    ).filter(gpIsVisible);
    const scored = items
      .map(el => {
        const t = gpNorm(el.textContent);
        const a = gpNorm(el.getAttribute('aria-label') || '');
        const label = t || a;
        let score = 0;
        if (label === 'album') score = 100;
        else if (label.includes('add to album') && !label.includes('shared')) score = 85;
        else if (label.includes('album') && !label.includes('shared')) score = 60;
        else if (label.includes('album')) score = 25;
        return { el, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored[0]?.el || null;
  }

  function gpFindAddToControl() {
    const candidates = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"]'));
    const scored = candidates
      .map(el => {
        const t = gpNorm(el.textContent);
        const a = gpNorm(el.getAttribute('aria-label') || '');
        const title = gpNorm(el.getAttribute('title') || '');
        let score = 0;
        if (a.includes('add to') || title.includes('add to')) score += 12;
        if (t === 'add to') score += 22;
        if (t.includes('add to album')) score += 18;
        if (t.includes('add to') && t.length < 24) score += 6;
        return { el, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored[0]?.el || null;
  }

  function gpFindRowMatchingAlbum(root, name) {
    const want = gpNorm(name);
    if (!want) return null;
    const rows = Array.from(
      root.querySelectorAll('[role="option"], [role="menuitem"], [role="listitem"], li, button, [role="button"]')
    ).filter(gpIsVisible);
    const isCreateLike = text =>
      text.includes('create album') ||
      text.includes('new album') ||
      text.includes('create new album') ||
      text.startsWith('create "') ||
      text.startsWith('create ');
    const startsWithAlbumName = label => {
      if (!label) return false;
      if (label === want) return true;
      if (label.startsWith(want + ' ')) return true;
      if (label.startsWith(want + '·') || label.startsWith(want + ' ·')) return true;
      if (label.startsWith(want + ',')) return true;
      return false;
    };
    const isMatch = el => {
      const textLabel = gpNorm(el.textContent);
      const ariaLabel = gpNorm(el.getAttribute('aria-label') || '');
      const combined = `${textLabel} ${ariaLabel}`.trim();
      if (!combined || isCreateLike(combined)) return false;
      if (startsWithAlbumName(ariaLabel)) return true;
      if (startsWithAlbumName(textLabel)) return true;
      // Some variants render name in a nested span only.
      const nameNode = el.querySelector('[jsname="K4r5Ff"], .aqdrmf-rymPhb-fpDzbe-fmcmS');
      const nestedName = gpNorm(nameNode?.textContent || '');
      if (nestedName === want) return true;
      return false;
    };
    return rows.find(isMatch) || null;
  }

  async function addToGooglePhotosAlbum(albumName, selectedItems) {
    if (!albumName) return { success: true, message: 'No album name provided, skipping album creation' };

    showPanel(`Adding ${selectedItems.length} item(s) to album "${albumName}"...`);

    try {
      const addToButton = gpFindAddToControl();
      if (!addToButton) {
        warn('Could not automatically add to album - UI may have changed');
        hidePanel();
        return {
          success: false,
          message: `Album feature: Please manually add selected items to "${albumName}". The automated flow may need updating due to Google Photos UI changes.`,
        };
      }

      addToButton.click();
      await sleep(250);

      let dialog = await waitFor(gpFindDialogRoot, 1200);

      if (!dialog) {
        const albumEntry = await waitFor(() => gpFindAlbumMenuEntry(document), 1200);
        if (albumEntry) {
          gpActivateElement(albumEntry);
          await sleep(250);
        }
        dialog = await waitFor(gpFindDialogRoot, 1200);
      }

      const root = dialog || document;

      let existing = gpFindRowMatchingAlbum(gpGetAlbumPickerScope(), albumName);
      if (existing) {
        gpActivateElement(existing);
        await gpConfirmAlbumSelection();
        await sleep(450);
        hidePanel();
        return { success: true, message: `Items added to existing album "${albumName}"` };
      }

      const searchLike = root.querySelector(
        'input[type="search"], input[placeholder*="search" i], input[aria-label*="search" i]'
      );
      if (searchLike && !gpNorm(searchLike.placeholder).includes('title')) {
        gpSetReactInputValue(searchLike, albumName);
        existing = await waitFor(() => gpFindRowMatchingAlbum(gpGetAlbumPickerScope(), albumName), 1600);
        if (existing) {
          gpActivateElement(existing);
          await gpConfirmAlbumSelection();
          await sleep(450);
          hidePanel();
          return { success: true, message: `Items added to existing album "${albumName}"` };
        }
        warn(`Album "${albumName}" not found in search results; skipping auto-create to avoid duplicate album`);
        hidePanel();
        return {
          success: false,
          message: `Album "${albumName}" was not matched in the picker results. Please select it manually to avoid creating a duplicate.`,
        };
      }

      const newAlbumBtn = gpFindClickableByPhrases(root, ['new album', 'create album', 'create new album']);
      if (newAlbumBtn) {
        newAlbumBtn.click();
        await sleep(700);
      }

      const dialog2 = gpFindDialogRoot() || root;
      const albumInput = await waitFor(
        () =>
          dialog2.querySelector('input[placeholder*="album" i]') ||
          dialog2.querySelector('input[placeholder*="title" i]') ||
          dialog2.querySelector('input[aria-label*="album" i]') ||
          dialog2.querySelector('input[aria-label*="title" i]') ||
          Array.from(dialog2.querySelectorAll('input[type="text"], input:not([type])')).find(
            inp => gpIsVisible(inp) && !inp.readOnly && !inp.disabled
          ),
        4500
      );

      if (albumInput) {
        albumInput.focus();
        gpSetReactInputValue(albumInput, albumName);
        await sleep(450);

        const createBtn = gpFindClickableByPhrases(dialog2, ['create', 'done', 'add', 'save']);
        if (createBtn) {
          createBtn.click();
          await sleep(1200);
          hidePanel();
          return { success: true, message: `Items added to album "${albumName}"` };
        }
      }

      warn('Could not automatically add to album - UI may have changed');
      hidePanel();
      return {
        success: false,
        message: `Album feature: Please manually add selected items to "${albumName}". The automated flow may need updating due to Google Photos UI changes.`,
      };
    } catch (err) {
      warn('Error adding to album:', err);
      hidePanel();
      return { success: false, message: `Failed to add to album: ${err.message}` };
    }
  }

  // ── Modified onSendClick to include album functionality ────────────────────
  async function onSendClick(event) {
    if (event && event.shiftKey) {
      const confirmClear = confirm('Clear the stored Google Photos → Messenger queue?');
      if (confirmClear) {
        await clearQueue();
        hidePanel();
        alert('Queue cleared successfully.');
      }
      return;
    }

    const selected = getSelectedItems();
    if (!selected.length) return alert('No items selected.');
    if (selected.length > MAX_FILES)
      return alert(`Please select at most ${MAX_FILES} items at a time.`);

    const albumName = getAlbumName();

    showPanel('Fetching selected media…');
    const queue = [];

    for (let i = 0; i < selected.length; i++) {
      updatePanel(`Downloading ${i + 1} / ${selected.length}…`);
      try {
        const item = selected[i];
        let blob;
        let sourceUrl = null;

        if (item.type === 'video') {
          const videoResult = await fetchVideoBlob(item);
          blob = videoResult.blob;
          sourceUrl = videoResult.sourceUrl;
          if (!blob || blob.size === 0 || !hasExpectedMimeType(blob, 'video')) {
            throw new Error(`Expected video blob but got ${blob ? blob.type || 'unknown' : 'empty blob'}`);
          }
        } else {
          blob = await fetchBlob(getFullResUrl(item.thumbSrc));
          if (!blob || blob.size === 0 || !hasExpectedMimeType(blob, 'image')) {
            throw new Error(`Expected image blob but got ${blob ? blob.type || 'unknown' : 'empty blob'}`);
          }
        }

        const ext  = blob.type.includes('video') ? 'mp4' : (blob.type.split('/')[1] || 'jpg');
        const filename = `media_${i + 1}.${ext}`;

        if (item.type === 'video' && blob.size > LARGE_VIDEO_THRESHOLD_BYTES && sourceUrl) {
          queue.push({
            transferMode: 'remoteFetch',
            sourceUrl,
            mimeType: blob.type || 'video/mp4',
            filename,
            sizeBytes: blob.size,
          });
          log(`Queued large video via remoteFetch mode: ${blob.size} bytes`);
        } else {
          const b64  = await blobToBase64(blob);
          queue.push({
            transferMode: 'inlineDataUrl',
            dataUrl: b64,
            mimeType: blob.type,
            filename
          });
        }
        log(`Fetched item ${i + 1} (${item.type}):`, blob.type, blob.size, 'bytes');
      } catch (err) {
        warn(`Failed item ${i + 1}:`, err);
        updatePanel(`⚠️ Could not download item ${i + 1} — skipping.`);
        await sleep(1200);
      }
    }

    if (!queue.length) {
      hidePanel();
      return alert('Could not download any selected items.');
    }

    // ── Add to Google Photos Album (before opening Messenger) ───────────
    if (albumName) {
      try {
        const albumResult = await addToGooglePhotosAlbum(albumName, selected);
        if (!albumResult.success) {
          console.warn('[GP→Messenger] Album warning:', albumResult.message);
          updatePanel(`⚠️ ${albumResult.message}`);
          await sleep(1500);
        }
      } catch (albumErr) {
        warn('Album operation failed:', albumErr);
        // Continue with Messenger flow even if album fails
      }
    }

    const largeVideoCount = queue.filter(item => item.transferMode === 'remoteFetch').length;
    if (largeVideoCount > 0) {
      updatePanel(`Queuing ${queue.length} file(s), including ${largeVideoCount} large video(s)…`);
      await sleep(600);
    }
    updatePanel(`Queuing ${queue.length} file(s)… opening Messenger.`);
    await saveQueue(queue);
    await sleep(400);
    hidePanel();

    GM_openInTab('https://www.facebook.com/messages/', { active: true, insert: true });
  }

  function showPanel(msg) {
    let p = document.getElementById(PANEL_ID);
    if (!p) { p = document.createElement('div'); p.id = PANEL_ID; document.body.appendChild(p); }
    p.textContent = msg; p.style.display = 'flex';
  }
  function updatePanel(msg) { const p = document.getElementById(PANEL_ID); if (p) p.textContent = msg; }
  function hidePanel() { const p = document.getElementById(PANEL_ID); if (p) p.style.display = 'none'; }

  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      #${BUTTON_ID} {
        align-items: center;
        background: #1877f2;
        border: none;
        border-radius: 28px;
        bottom: 84px;
        color: white;
        cursor: pointer;
        display: inline-flex;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        gap: 6px;
        padding: 12px 18px;
        position: fixed;
        right: 24px;
        z-index: 2147483647;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.24);
        white-space: nowrap;
      }
      #${BUTTON_ID}:hover {
        background: #1464d8;
      }
      #${BUTTON_ID}:active {
        background: #0a50be;
      }
      #${INPUT_WRAPPER_ID} {
        position: fixed;
        right: 24px;
        bottom: 24px;
        z-index: 2147483647;
        display: flex;
        align-items: center;
      }
      #${ALBUM_INPUT_ID} {
        padding: 10px 14px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 24px;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: #202124;
        color: #e8eaed;
        caret-color: #e8eaed;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
        min-width: 180px;
        max-width: 250px;
        outline: none;
        transition: box-shadow 0.2s, border-color 0.2s;
      }
      #${ALBUM_INPUT_ID}:focus {
        border-color: rgba(24, 119, 242, 0.9);
        box-shadow: 0 4px 20px rgba(24, 119, 242, 0.3);
      }
      #${ALBUM_INPUT_ID}::placeholder {
        color: #9aa0a6;
      }
      #${PANEL_ID} {
        align-items: center;
        background: rgba(0, 0, 0, 0.85);
        border-radius: 10px;
        bottom: 30px;
        color: #fff;
        display: none;
        font-size: 14px;
        justify-content: center;
        left: 50%;
        padding: 16px 24px;
        position: fixed;
        transform: translateX(-50%);
        z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
    `;
    const target = document.head || document.documentElement || document.body;
    if (target) target.appendChild(s);
    log('Styles injected');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MESSENGER SIDE
  // ═══════════════════════════════════════════════════════════════════════════
  async function messengerSide() {
    injectStyles();
    createMessengerButton();
    await sleep(4000);
    await updateMessengerButtonState();
    setInterval(updateMessengerButtonState, 2500);
  }

  async function createMessengerButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.textContent = '📤 No files queued';
    btn.style.display = 'inline-flex';
    btn.style.position = 'fixed';
    btn.style.right = '24px';
    btn.style.bottom = '24px';
    btn.style.zIndex = '2147483647';
    btn.style.background = '#1877f2';
    btn.style.color = '#fff';
    btn.style.border = 'none';
    btn.style.borderRadius = '28px';
    btn.style.padding = '12px 18px';
    btn.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    btn.style.fontSize = '13px';
    btn.style.fontWeight = '600';
    btn.style.gap = '6px';
    btn.style.boxShadow = '0 20px 40px rgba(0, 0, 0, 0.24)';
    btn.style.whiteSpace = 'nowrap';
    btn.disabled = true;
    btn.style.opacity = '0.55';
    btn.title =
      'When files are queued from Google Photos: click to attach and send here. Disabled until a queue exists. Shift-click clears the queue.';
    btn.onclick = async (event) => {
      if (event && event.shiftKey) {
        const confirmClear = confirm('Clear the stored Google Photos → Messenger queue?');
        if (confirmClear) {
          await clearQueue();
          await updateMessengerButtonState();
          alert('Queue cleared successfully.');
        }
        return;
      }
      if (btn.disabled) return;
      btn.disabled = true;
      btn.style.opacity = '0.65';
      await processQueue();
      await updateMessengerButtonState();
    };

    const root = document.body || document.documentElement;
    root.appendChild(btn);
    log('Messenger side FAB injected');
  }

  async function updateMessengerButtonState() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;

    const meta = getQueueMetadata();
    if (meta?.length) {
      btn.textContent = meta.length > 1 ? `📤 Send ${meta.length} files to chat` : '📤 Send 1 file to chat';
      btn.disabled = false;
      btn.style.opacity = '1';
    } else {
      btn.textContent = '📤 No files queued';
      btn.disabled = true;
      btn.style.opacity = '0.65';
    }
  }

  async function processQueue() {
    let queue;
    try {
      queue = await loadQueue();
    } catch (err) {
      warn('Failed to load queue from storage:', err);
      alert(
        '[GP→Messenger] The queued files could not be read (possibly corrupted storage).\n\n' +
        'Try Shift-clicking the floating button to clear the queue, then queue the files again from Google Photos.'
      );
      return;
    }
    if (!queue?.length) return;

    await clearQueue();
    log(`Processing ${queue.length} file(s).`);

    try {
      const composeBox = await waitFor(
        () =>
          document.querySelector('[aria-label="Message"][contenteditable="true"]') ||
          document.querySelector('[aria-label*="message" i][contenteditable="true"]') ||
          document.querySelector('[contenteditable="true"][role="textbox"]') ||
          document.querySelector('div[contenteditable="true"][data-lexical-editor]'),
        15000
      );

      if (!composeBox) {
        alert(
          '[GP→Messenger] Could not find a Messenger chat compose box.\n\n' +
          'Make sure you have a conversation open at facebook.com/messages/t/…\n\n' +
          'Your files have been re-queued — navigate to a chat and wait a few seconds.'
        );
        await saveQueue(queue);
        return;
      }

      const files = [];
      for (const item of queue) {
        if (item.transferMode === 'remoteFetch') {
          showPanel(`Downloading large video for Messenger: ${item.filename}…`);
          try {
            const remoteBlob = await fetchBlob(item.sourceUrl);
            if (!remoteBlob || remoteBlob.size === 0 || !hasExpectedMimeType(remoteBlob, 'video')) {
              throw new Error(`Invalid delayed video blob type: ${remoteBlob ? remoteBlob.type || 'unknown' : 'empty blob'}`);
            }
            files.push(new File([remoteBlob], item.filename, { type: item.mimeType || remoteBlob.type || 'video/mp4' }));
          } finally {
            hidePanel();
          }
        } else {
          const bin   = atob(item.dataUrl.split(',')[1]);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          files.push(new File([bytes], item.filename, { type: item.mimeType }));
        }
      }

      const fileInput = await waitFor(
        () =>
          composeBox.closest('form, [role="main"], [role="region"]')
            ?.querySelector('input[type="file"]') ||
          document.querySelector('input[type="file"][accept*="image"]') ||
          document.querySelector('input[type="file"][accept*="video"]') ||
          document.querySelector('input[type="file"]'),
        6000
      );

      if (fileInput) {
        const dt = new DataTransfer();
        files.forEach(f => dt.items.add(f));
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        log('Files injected via file input.');
      } else {
        log('File input not found — trying clipboard paste simulation.');
        composeBox.focus();
        await sleep(200);

        const dt = new DataTransfer();
        files.forEach(f => dt.items.add(f));

        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        });
        composeBox.dispatchEvent(pasteEvent);
        log('Paste event dispatched.');
      }

      await sleep(2500);

      const sendBtn =
        document.querySelector('[aria-label="Send"][role="button"]') ||
        document.querySelector('[aria-label*="Send" i][role="button"]') ||
        document.querySelector('div[aria-label="Send"]');

      if (sendBtn) {
        sendBtn.click();
        log('Sent via Send button.');
      } else {
        composeBox.focus();
        composeBox.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true })
        );
        log('Sent via Enter key fallback.');
      }
    } catch (err) {
      warn('Messenger send flow failed; restoring queue for retry:', err);
      try {
        await saveQueue(queue);
      } catch (saveErr) {
        warn('Failed to restore queue after send failure:', saveErr);
      }
      alert(
        '[GP→Messenger] Sending failed, and your queue was restored.\n\n' +
        'Open a Messenger chat and click the button again to retry.'
      );
    }
  }

  function waitFor(fn, ms = 10000) {
    return new Promise(resolve => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const r = fn();
        if (r || Date.now() - t0 > ms) { clearInterval(iv); resolve(r || null); }
      }, 300);
    });
  }

})();