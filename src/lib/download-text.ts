const REVOKE_DELAY_MS = 30_000;

/** 텍스트를 파일로 내려받게 한다. */
export function downloadText(text: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  // 문서에 붙여 누르고, 주소는 브라우저가 파일을 가져갈 시간을 준 뒤 해제한다(WebKit은 바로 해제하면
  // 빈 파일이 되거나 실패한다).
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}
