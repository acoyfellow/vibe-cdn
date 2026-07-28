export const STATIC_FILE_EXTENSIONS_THAT_MUST_404 = new Set([
  'glb', 'gltf', 'bin', 'wasm', 'json', 'png', 'jpg', 'jpeg', 'webp', 'avif',
  'gif', 'svg', 'ico', 'js', 'mjs', 'cjs', 'css', 'map', 'txt', 'xml', 'wav',
  'mp3', 'ogg', 'webm', 'mp4', 'ktx2', 'basis', 'hdr', 'exr', 'zip', 'br', 'gz',
])

export function pathExtension(pathname: string): string | undefined {
  const last = pathname.split('/').pop() ?? ''
  const dot = last.lastIndexOf('.')
  if (dot <= 0 || dot === last.length - 1) return undefined
  return last.slice(dot + 1).toLowerCase()
}

export function shouldFourOhFour(pathname: string): boolean {
  const ext = pathExtension(pathname)
  if (!ext) return false
  if (ext === 'html' || ext === 'htm') return false
  return STATIC_FILE_EXTENSIONS_THAT_MUST_404.has(ext)
}
