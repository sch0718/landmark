/** 끌어 온 것에 파일이 들어 있는가(텍스트·링크 끌기는 거른다). */
export const hasFiles = (event: DragEvent): boolean =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files');
