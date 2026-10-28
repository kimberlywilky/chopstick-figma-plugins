/**
 * Chopstick Figma Plugins - ZIP Download Utility
 *
 * Shared function for generating and downloading ZIP files.
 * JSZip must be passed in by the consuming plugin since the shared
 * package has no node_modules of its own for Vite to resolve from.
 */

interface ZipFile {
  path: string;
  content: string;
}

/**
 * Generates a YYYYMMDD timestamp string for file naming.
 */
export function getDateTimestamp(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Creates a ZIP from file entries and triggers a browser download.
 *
 * @param files - Array of file path + content pairs to include in the ZIP
 * @param filePrefix - Prefix for the downloaded ZIP filename (e.g., "chopstick-tokens")
 * @param JSZipConstructor - The JSZip class (imported by the consuming plugin)
 */
export async function downloadZip(
  files: ZipFile[],
  filePrefix: string,
  JSZipConstructor: any
): Promise<void> {
  const zip = new JSZipConstructor();

  for (const file of files) {
    zip.file(file.path, file.content);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filePrefix}-${getDateTimestamp()}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
