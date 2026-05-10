# PhotosToMessengerUserscript

A Tampermonkey userscript that adds a "Send to Messenger" button to Google Photos' share dialog.

## How it works

1. **Select photos/videos** in Google Photos
2. **Click the Share button** to open the share dialog
3. **Click "📤 Send to Messenger"** button that appears next to the "Next" button
4. The script downloads the full-resolution images/videos and opens Facebook Messenger
5. Files are uploaded directly to the chat (not as album links)

## Technical Details

The script uses multiple robust detection methods:

### Dialog Detection:
- Searches for the dialog title "Send in Google Photos" (very stable)
- Looks for modal/dialog elements containing share content
- Falls back to structural patterns if needed

### Selection Detection:
- Monitors `aria-checked="true"` attributes
- Checks for `data-selected` attributes and CSS classes
- Looks for checked checkboxes
- Detects selection styling (blue borders/outlines)
- Listens for click events on photo elements

This multi-layered approach ensures compatibility with Google Photos' evolving UI.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension
2. Create a new script and paste the contents of `user.js`
3. Save and enable the script

## Features

- Direct file upload (not album sharing)
- Supports multiple photos and videos
- Maintains original quality
- Works with Facebook Messenger web interface

## Troubleshooting

- Open browser DevTools (F12) → Console tab
- Look for `[GP→Messenger]` log messages
- The button only appears when items are selected and the share dialog is open