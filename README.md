# PhotosToMessengerUserscript

A [Tampermonkey](https://www.tampermonkey.net/) userscript that queues selected media from **Google Photos** and uploads it as real files into **Facebook Messenger** (web). Optionally, it can run Google’s **Add to album** flow before opening Messenger.

## Requirements

- [Tampermonkey](https://www.tampermonkey.net/) (or a compatible userscript manager)
- Grants: `GM_setValue`, `GM_getValue`, `GM_deleteValue`, `GM_xmlhttpRequest`, `GM_openInTab`, `unsafeWindow`

## Installation

1. Install Tampermonkey in your browser.
2. Add a new userscript and paste the contents of [`user.js`](user.js), **or** open the raw script URL from the `@downloadURL` in the script header and let Tampermonkey install it.
3. Save and ensure the script is enabled for `https://photos.google.com/*` and `https://www.facebook.com/messages/*`.

## How to use

### Google Photos

1. Select up to **10** photos or videos (grid selection with checkboxes).
2. Optional: type an **album name** in the floating field labeled *Album name (optional)*. The script will try to add the selection to that album (existing or new) via the normal Photos UI before sending to Messenger.
3. Click **📤 Send to Messenger**. The script downloads full-resolution media, may run the album picker, then stores the queue and opens Messenger in a new tab.
4. **Shift-click** the same button to clear any stored queue (with confirmation).

### Messenger (facebook.com/messages)

1. Open a conversation (`facebook.com/messages/...`).
2. Wait for the floating button to show queued file count.
3. Click **📤 Send … to chat** to attach and send. **Shift-click** clears the queue.

Large videos may be queued for download on the Messenger side to avoid huge inline storage.

## Features

- Direct file upload to Messenger (not a Photos album link).
- Floating controls on Google Photos (send button + optional album name).
- Album field uses a dark theme so typed text stays readable on light and dark pages.
- Selection detection uses several strategies (`aria-checked`, `aria-selected`, checkboxes, etc.) because Google Photos changes often.
- Console logging under the `[GP→Messenger]` prefix for debugging.

## Album automation (fragile)

The album step drives the real **Add to → Album** UI in the browser. Google can change markup or behavior at any time, so this may partially work or ask you to finish manually. The script tries to prefer **existing** albums when the name matches and avoid creating duplicates when unsure.

If album automation fails, you can leave the album field empty and add items to an album yourself, or complete the dialog when the script stops.

## Troubleshooting

1. Open **DevTools → Console** and filter for `GP→Messenger`.
2. Confirm Tampermonkey shows the script **on** for both Photos and Messenger URLs.
3. If Messenger never sees files: use **Shift-click** on the Photos button to clear the queue, then queue again from Photos with a chat open on Messenger.
4. For album issues: check the console warning text; complete the picker manually if needed.

## Repository

Script source: [`user.js`](user.js). Version is in the `// @version` header at the top of that file.
