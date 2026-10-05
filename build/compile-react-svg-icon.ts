export function compileReactIcon(svg: string): string {
  const openingTagStart = svg.indexOf('<svg');
  const openingTagEnd = svg.indexOf('>', openingTagStart);
  const closingTagStart = svg.indexOf('</svg', openingTagEnd);

  if (openingTagStart < 0 || openingTagEnd < 0 || closingTagStart < 0) {
    throw new Error('Expected an SVG root element from the static icon collection.');
  }

  const openingTag = svg.slice(openingTagStart, openingTagEnd);
  const viewBox = openingTag.match(/\bviewBox="([^"]+)"/)?.[1];
  const body = svg.slice(openingTagEnd + 1, closingTagStart);

  return [
    "import * as React from 'react';",
    'export default function Icon(props) {',
    "  return React.createElement('svg', { width: '1em', height: '1em',",
    `    ${viewBox ? `viewBox: ${JSON.stringify(viewBox)},` : ''} ...props,`,
    `    dangerouslySetInnerHTML: { __html: ${JSON.stringify(body)} },`,
    '  });',
    '}',
  ].join('\n');
}
