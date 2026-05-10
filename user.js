// ==UserScript==
// @name         Google Photos → Facebook Messenger (Direct Upload)
// @namespace    https://github.com/you/gphoto-to-messenger
// @version      1.3.0
// @description  Select photos/videos in Google Photos and send them directly to a Messenger chat as file uploads (not album links).
// @updateURL    https://github.com/TomVarga/PhotosToMessengerUserscript/raw/refs/heads/main/user.js
// @downloadURL  https://github.com/TomVarga/PhotosToMessengerUserscript/raw/refs/heads/main/user.js
// @author       You
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
  const BUTTON_ID   = 'gp2m-send-btn';
  const PANEL_ID    = 'gp2m-panel';
  const MAX_FILES   = 10;
  const POLL_MS     = 800;
  const DATA_CHUNK_SIZE = 256 * 1024; // chunk large base64 values into 256KB pieces
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
    log('Running on Google Photos side - using floating Messenger FAB');
    googlePhotosSide();
    return;
  }
  
  warn(`Script running on unexpected domain: ${location.hostname}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // GOOGLE PHOTOS SIDE
  // ═══════════════════════════════════════════════════════════════════════════
  function googlePhotosSide() {
    injectStyles();
    createFloatingButton();
    observeButtonRoot();
    let lastSelectedCount = 0;

    // If Google Photos rerenders the page shell, keep recreating the FAB.
    setInterval(createFloatingButton, 3000);

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
    btn.style.bottom = '24px';
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
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function getSelectedItems() {
    const items = [];
    const seen = new Set();

    const normalizeUrl = url => url && url.replace(/\\?authuser=\d+/, '');
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

    // Method 1: selected checkboxes in the photo grid
    const selectedBoxes = Array.from(document.querySelectorAll('[role="checkbox"][aria-checked="true"]'));
    dlog(`Method 1: Found ${selectedBoxes.length} selected checkboxes`);
    selectedBoxes.forEach(box => {
      const itemRoot = box.closest('div.rtIMgb') || box.closest('a.p137Zd') || findItemRoot(box.parentElement);
      addItem(itemRoot || box);
    });

    // Method 2: aria-selected on tabs and items
    if (!items.length) {
      const selectedEls = Array.from(document.querySelectorAll('[aria-selected="true"]'));
      dlog(`Method 2: Found ${selectedEls.length} aria-selected=true elements`);
      selectedEls.forEach(el => {
        const itemRoot = findItemRoot(el);
        addItem(itemRoot || el);
      });
    }

    // Method 3: data-selected attributes
    if (!items.length) {
      const dataSelectedEls = Array.from(document.querySelectorAll('[data-selected="true"]'));
      dlog(`Method 3: Found ${dataSelectedEls.length} data-selected=true elements`);
      dataSelectedEls.forEach(el => addItem(findItemRoot(el) || el));
    }

    // Method 4: checked inputs (rare in this UI)
    if (!items.length) {
      const checkedInputs = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'));
      dlog(`Method 4: Found ${checkedInputs.length} checked input elements`);
      checkedInputs.forEach(input => addItem(findItemRoot(input) || input));
    }

    dlog(`Total selected items found: ${items.length}`);
    return items;
  }

  // lh3.googleusercontent.com URLs end with =wNNN-hNNN; swap for =d (download)
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
    
    // Strategy 1: Try to extract video URLs from detail page directly
    if (item.detailHref) {
      try {
        const html = await fetchDetailPageHtml(item.detailHref);
        
        // Look for video URLs in all forms
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
    
    // Pattern 1: Direct googlevideo.com URLs
    const googleVideoPattern = /https:\/\/[^"'\s]+googlevideo\.com[^"'\s]*/g;
    const googleVideoMatches = html.match(googleVideoPattern);
    if (googleVideoMatches) {
      googleVideoMatches.forEach(url => {
        const clean = url.replace(/['">\s].*$/, '');
        if (clean.length > 20) urls.add(clean);
      });
    }

    // Pattern 2: JSON-embedded URLs with "url" keys
    const jsonUrlPattern = /"url":"(https:\/\/[^"]+)"/g;
    let match;
    while ((match = jsonUrlPattern.exec(html)) !== null) {
      const url = match[1];
      if (url.includes('video') || url.includes('media') || url.includes('stream')) {
        urls.add(url);
      }
    }

    // Pattern 3: m.c values (Google's media cache pattern)
    const mediaCachePattern = /https:\/\/[^"'\s]*(?:lh3\.googleusercontent|photos\.fife)[^"'\s]*=/g;
    const mediaCacheMatches = html.match(mediaCachePattern);
    if (mediaCacheMatches) {
      mediaCacheMatches.forEach(baseUrl => {
        // Try video-specific parameter variants
        ['=dv', '=dv-rw', '=dv-no', '=d', '=d-rw'].forEach(param => {
          urls.add(baseUrl.replace(/=[^&"'\s]*$/, param));
        });
      });
    }

    // Pattern 4: Look for blob URLs or data URLs (less likely to work but worth trying)
    const srcPattern = /src="([^"]*(?:blob:|data:video)[^"]*)"/g;
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

  function hasExpectedMimeType(blob, mediaKind) {
    const type = (blob && blob.type ? blob.type : '').toLowerCase();
    if (!type) return false;
    if (mediaKind === 'image') return type.startsWith('image/');
    if (mediaKind === 'video') return type.startsWith('video/') || type.includes('stream');
    return false;
  }

  async function saveQueue(queue) {
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
          await GM_setValue(generateChunkKey(itemId, index), chunks[index]);
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
    await GM_setValue(STORAGE_KEY, JSON.stringify(metadata));
    return metadata;
  }

  async function getQueueMetadata() {
    const raw = await GM_getValue(STORAGE_KEY, null);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function loadQueue() {
    const metadata = await getQueueMetadata();
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
        const chunk = await GM_getValue(generateChunkKey(item.id, index), null);
        if (chunk === null) throw new Error(`Missing queue chunk ${index} for ${item.id}`);
        dataUrl += chunk;
      }
      queue.push({ transferMode: 'inlineDataUrl', filename: item.filename, mimeType: item.mimeType, dataUrl });
    }
    return queue;
  }

  async function clearQueue() {
    const metadata = await getQueueMetadata();
    if (metadata?.length) {
      for (const item of metadata) {
        if (!item.id || !item.chunkCount) continue;
        for (let index = 0; index < item.chunkCount; index++) {
          await GM_deleteValue(generateChunkKey(item.id, index));
        }
      }
    }
    await GM_setValue(STORAGE_KEY, null);
  }

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

    showPanel('Fetching selected media…');
    const queue = [];

    // Iterate through each selected item one-by-one
    for (let i = 0; i < selected.length; i++) {
      updatePanel(`Downloading ${i + 1} / ${selected.length}…`);
      try {
        const item = selected[i];
        let blob;
        let sourceUrl = null;

        if (item.type === 'video') {
          // For videos: fetch via detail page URL extraction
          const videoResult = await fetchVideoBlob(item);
          blob = videoResult.blob;
          sourceUrl = videoResult.sourceUrl;
          if (!blob || blob.size === 0 || !hasExpectedMimeType(blob, 'video')) {
            throw new Error(`Expected video blob but got ${blob ? blob.type || 'unknown' : 'empty blob'}`);
          }
        } else {
          // For images: fetch full resolution
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

    const largeVideoCount = queue.filter(item => item.transferMode === 'remoteFetch').length;
    if (largeVideoCount > 0) {
      updatePanel(`Queuing ${queue.length} file(s), including ${largeVideoCount} large video(s)…`);
      await sleep(600);
    }
    updatePanel(`Queuing ${queue.length} file(s)… opening Messenger.`);
    await saveQueue(queue);
    await sleep(400);
    hidePanel();

    // Open Facebook Messages — if a specific chat was last open it will resume
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
        bottom: 24px;
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
  // MESSENGER SIDE  (facebook.com/messages/*)
  // ═══════════════════════════════════════════════════════════════════════════
  async function messengerSide() {
    injectStyles();
    createMessengerButton();

    // Facebook's SPA takes a while to hydrate before we can access the compose box.
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
    btn.title = 'Waiting for queued files from Google Photos';
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
    btn.title = 'Click to send queued files to Messenger. Shift-click to clear the queue.';

    const root = document.body || document.documentElement;
    root.appendChild(btn);
    log('Messenger side FAB injected');
  }

  async function updateMessengerButtonState() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;

    const meta = await getQueueMetadata();
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

    await clearQueue(); // clear immediately to avoid double-send
    log(`Processing ${queue.length} file(s).`);

    try {
      // ── Wait for a chat's compose box to be present ────────────────────────
      // Facebook Messenger uses a contenteditable div as the compose area.
      // The aria-label varies by locale; we try several selectors.
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

      // ── Reconstruct File objects (inline base64 or delayed remote fetch) ───
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

      // ── Strategy 1: inject via Facebook's hidden file input ───────────────
      // Facebook Messenger (on facebook.com) keeps a hidden <input type="file">
      // tied to the attachment/image button. Setting its .files triggers the
      // same upload pipeline as a manual attachment.
      const fileInput = await waitFor(
        () =>
          // The image/attachment input is often scoped near the composer
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
        // ── Strategy 2: paste via ClipboardEvent on the compose box ──────────
        // Facebook's composer handles paste events with file data, which is
        // how screenshot-paste works — we can replicate this.
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

      // ── Wait for previews to render, then click Send ───────────────────────
      await sleep(2500);

      // Facebook's send button has a specific aria-label
      const sendBtn =
        document.querySelector('[aria-label="Send"][role="button"]') ||
        document.querySelector('[aria-label*="Send" i][role="button"]') ||
        document.querySelector('div[aria-label="Send"]');

      if (sendBtn) {
        sendBtn.click();
        log('Sent via Send button.');
      } else {
        // Fallback: Enter key in the compose box
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