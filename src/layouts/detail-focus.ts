export function detailFocusEnabled(): boolean {
  return document.querySelector('.MuiModal-root:not(.MuiModal-hidden)') === null;
}
