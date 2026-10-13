// `check-bundle-size.mjs`의 타입(테스트가 TS에서 가져다 쓴다).
export interface BundleFile {
  name: string;
  bytes: number;
  gzipBytes: number;
}
export interface BundleSize {
  files: BundleFile[];
  initial: { bytes: number; gzipBytes: number; files: string[] };
  total: { bytes: number; gzipBytes: number };
}
export function initialScriptPaths(html: string): string[];
export function measureBundle(dist?: string): Promise<BundleSize>;
export function budgetFailure(
  result: BundleSize,
  budget?: { initialJsGzipMax?: number },
): string | undefined;
export function forbiddenFailure(result: BundleSize, names: string[]): string | undefined;
export function run(argv?: string[]): Promise<{ result: BundleSize; failure: string | undefined }>;
