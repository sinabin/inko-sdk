// English UI strings — built-in locale 'en'.
// Keys mirror messages.ko.ts. Missing keys fall back to Korean, then to the raw key.
export const en: Record<string, string> = {
  // Tools
  'tool.select': 'Select',
  'tool.pen': 'Pen',
  'tool.highlighter': 'Highlighter',
  'tool.eraser': 'Eraser',
  'tool.rectangle': 'Rectangle',
  'tool.circle': 'Circle',
  'tool.line': 'Line',
  'tool.text': 'Text',

  // Toolbar
  'toolbar.thumbnailsHide': 'Hide thumbnails',
  'toolbar.thumbnailsShow': 'Show thumbnails',
  'toolbar.prevPage': 'Previous page',
  'toolbar.nextPage': 'Next page',
  'toolbar.currentPage': 'Current page',
  'toolbar.undo': 'Undo',
  'toolbar.redo': 'Redo',
  'toolbar.zoomOut': 'Zoom out',
  'toolbar.zoomIn': 'Zoom in',
  'toolbar.orientationLandscape': 'Landscape view',
  'toolbar.orientationPortrait': 'Portrait view',
  'toolbar.deleteSelection': 'Delete selection',
  'toolbar.bookmarksShow': 'Show bookmarks',
  'toolbar.bookmarksHide': 'Hide bookmarks',

  'toolbar.history': 'History',
  'toolbar.save': 'Save',

  // Bookmark (embedded PDF outline) panel
  'bookmark.title': 'Bookmarks',
  'bookmark.loading': 'Loading outline...',
  'bookmark.outlineEmpty': 'This PDF has no outline information.',
  'bookmark.untitled': 'Untitled',
  'bookmark.pageLabel': 'page {n}',
  'bookmark.goToPage': '{title} — go to {page}',
  'bookmark.unresolved': '{title} — destination unavailable',
  'bookmark.externalUnsupported': '{title} — external links are not opened by the viewer',
  'bookmark.expand': 'Expand {title}',
  'bookmark.collapse': 'Collapse {title}',
  'bookmark.close': 'Close bookmark panel',

  // History panel
  'history.title': 'History',
  'history.empty': 'No history yet.',
  'history.continueEdit': 'Continue editing',
  'history.unknownUser': 'Unknown',
  'history.hideUser': 'Hide {name}',
  'history.showUser': 'Show {name}',

  // Common
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.closeNotification': 'Dismiss notification',

  // Tool option sheets
  'sheet.color': 'Color',
  'sheet.thickness': 'Thickness',
  'sheet.lineThickness': 'Line thickness',
  'sheet.size': 'Size',
  'sheet.pressure': 'Pressure sensitivity',
  'sheet.customColor': 'Custom color',
  'sheet.customColorPick': 'Pick custom color',
  'sheet.dialogLabel': '{header} settings',
  'sheet.colorSwatch': 'Color {color}',
  'sheet.widthSwatch': '{label} {n}px',
  'sheet.textPreviewSample': 'AaBbCc Gg',

  // Text input
  'text.placeholder': 'Enter text...',

  // Toast categories
  'error.categoryParse': 'Data',
  'error.categoryRender': 'Rendering',
  'error.categoryStorage': 'Storage',
  'error.categoryBridge': 'Connection',
  'error.categoryTool': 'Tool',
  'error.categoryNetwork': 'Network',
  'error.categoryUnknown': 'System',

  // Viewer status / notifications (PdfViewer)
  'viewer.tapToPlaceText': 'Tap the canvas to place text',
  'viewer.savedVersion': 'Saved (version {version})',
  'viewer.saveRequested': 'Save request sent',
  'viewer.saveDataError': 'Failed to prepare data to save',
  'viewer.saveFailed': 'Local save failed',
  'viewer.encodeFailed': 'Failed to encode save data',

  // Thumbnails
  'thumbnails.noPdf': 'No PDF loaded',
  'thumbnails.loadingList': 'Loading thumbnails... ({n}/{total})',
  'thumbnail.loading': 'Loading...',
  'thumbnail.error': 'Error',
  'thumbnail.pageLabel': 'Page {n}',
  'thumbnail.contextError': 'Failed to create 2D context',
}
