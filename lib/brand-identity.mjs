// Shared vector geometry for the interface, local entry pages and print exports.
export const brandMarkPaths = [
  'M2 51 24 5h11l16 42-9 16L29 24 14 51Z',
  'm48 14 12-9h10l-4 46H53l3-31-9 4Z',
  'M73 20C73 0 107 0 107 20c0 8-6 13-13 19h13v12H73V40l18-16c5-5 2-10-3-10-4 0-5 3-5 6Z',
];
export const brandMarkSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 64" aria-hidden="true">${brandMarkPaths.map((d) => `<path d="${d}" fill="currentColor"/>`).join('')}</svg>`;
