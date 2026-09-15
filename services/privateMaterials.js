const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
export const privateImageMaximumBytes = 500 * 1024 * 1024

function mimeTypeFor(path = '', fallback = '') {
  const normalizedFallback = String(fallback || '').toLowerCase()
  if (allowedMimeTypes.has(normalizedFallback)) return normalizedFallback
  const extension = String(path).split('?')[0].split('.').pop()?.toLowerCase()
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' })[extension] || ''
}

function safeFilename(value = '', mimeType = '') {
  const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[mimeType] || 'jpg'
  const basename = String(value || '').split(/[\\/]/).pop()?.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 110)
  return basename && /\.[a-z0-9]{2,5}$/i.test(basename) ? basename : `private-material-${Date.now()}.${extension}`
}

function base64FromPath(path, file) {
  // #ifdef H5
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '')
    reader.onerror = () => reject(new Error('无法读取所选图片'))
    if (file instanceof Blob) reader.readAsDataURL(file)
    else fetch(path).then((response) => response.blob()).then((blob) => reader.readAsDataURL(blob)).catch(reject)
  })
  // #endif

  // #ifndef H5
  // #ifdef APP-PLUS
  return new Promise((resolve, reject) => {
    plus.io.resolveLocalFileSystemURL(path, entry => entry.file(localFile => {
      const reader = new plus.io.FileReader()
      reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '')
      reader.onerror = () => reject(new Error('无法读取所选图片'))
      reader.readAsDataURL(localFile)
    }, () => reject(new Error('无法打开所选图片'))), () => reject(new Error('无法找到所选图片')))
  })
  // #endif
  // #ifndef APP-PLUS
  return new Promise((resolve, reject) => {
    if (typeof uni.getFileSystemManager !== 'function') { reject(new Error('当前平台暂不支持读取图片，请使用网页版或微信小程序')); return }
    uni.getFileSystemManager().readFile({
      filePath: path,
      encoding: 'base64',
      success: (result) => resolve(result.data),
      fail: () => reject(new Error('无法读取所选图片'))
    })
  })
  // #endif
  // #endif
}

function chooseImages(count) {
  return new Promise((resolve, reject) => {
    uni.chooseImage({
      count,
      sizeType: ['original'],
      sourceType: ['album', 'camera'],
      success: resolve,
      fail: (error) => {
        if (/cancel/i.test(error?.errMsg || '')) resolve({ tempFiles: [], tempFilePaths: [] })
        else reject(new Error(error?.errMsg || '无法选择图片'))
      }
    })
  })
}

export async function chooseImageFiles({
  count = 1,
  materialType = 'other_evidence',
  label = '证明材料',
  maximumBytes = privateImageMaximumBytes
} = {}) {
  const result = await chooseImages(Math.max(1, Math.min(9, Number(count) || 1)))
  const files = result.tempFiles || (result.tempFilePaths || []).map((path) => ({ path }))
  const materials = []
  for (const file of files) {
    const path = file.path || file.tempFilePath || ''
    const mimeType = mimeTypeFor(path, file.type)
    if (!path || !allowedMimeTypes.has(mimeType)) throw new Error('仅支持 JPEG、PNG、WebP 或 GIF 图片')
    const declaredSize = Number(file.size || 0)
    if (declaredSize > maximumBytes) throw new Error('单张图片不能超过 500MB')
    // #ifdef H5
    const source=(file.file instanceof Blob?file.file:file instanceof Blob?file:await fetch(path).then(r=>r.blob()))
    if(!source.size||source.size>maximumBytes)throw new Error('单张图片须在500MB以内')
    materials.push({localPath:path,filename:safeFilename(file.name||path,mimeType),mimeType,fileSource:source,materialType,label})
    continue
    // #endif
    // #ifndef H5
    if(declaredSize>2*1024*1024){materials.push({localPath:path,filename:safeFilename(file.name||path,mimeType),mimeType,fileSource:{path,size:declaredSize},materialType,label});continue}
    const dataBase64 = await base64FromPath(path, file.file || file)
    const estimatedBytes = Math.floor(dataBase64.length * 3 / 4) - (dataBase64.endsWith('==') ? 2 : dataBase64.endsWith('=') ? 1 : 0)
    if (!dataBase64) throw new Error('所选图片内容为空')
    if (estimatedBytes > maximumBytes) throw new Error('单张图片不能超过 500MB')
    materials.push({
      localPath: path,
      filename: safeFilename(file.name || path, mimeType),
      mimeType,
      dataBase64,
      materialType,
      label
    })
    // #endif
  }
  return materials
}

export const choosePrivateImageMaterials = chooseImageFiles
