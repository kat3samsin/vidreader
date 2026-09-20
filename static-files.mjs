const staticFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/preferences-init.js', 'preferences-init.js'],
  ['/reader.css', 'reader.css'],
  ['/tokens.css', 'tokens.css'],
]);

export const staticFileFor = pathname => staticFiles.get(pathname) || null;
