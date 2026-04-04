'use strict'

const sharp = require('sharp')
const { removeBackground } = require('@imgly/background-removal-node')
const { Vibrant } = require('node-vibrant/node')
const namer = require('color-namer')

/**
 * Image Processing Service
 * Handles resize, crop, and background removal operations using Sharp
 */
class ImageService {
  constructor() {
    // Use default bundled models from @imgly/background-removal-node package
    this.bgRemovalConfig = {
      model: 'medium', // 'small' (~40MB) or 'medium' (~80MB)
      debug: false
    }
  }
  normalizeOutputFormat(format) {
    if (!format) return 'jpeg'
    if (format === 'jpg' || format === 'jpeg') return 'jpeg'
    return format
  }
  /**
   * Resize an image
   * @param {Object} fileData - Multipart file data
   * @param {Object} options - Resize options
   * @returns {Promise<{buffer: Buffer, info: Object}>}
   */
  async resize(fileData, options) {
    const { width, height, fit = 'inside', format, quality, background } = options
    const outputFormat = this.normalizeOutputFormat(format)

    // Convert file stream to buffer
    const inputBuffer = await fileData.toBuffer()

    // Create Sharp instance
    let pipeline = sharp(inputBuffer)

    // Apply resize
    const resizeOptions = {
      width,
      height,
      fit, // cover, contain, fill, inside, outside
      withoutEnlargement: false
    }

    // Add background color if specified (for formats without alpha)
    if (background) {
      resizeOptions.background = background
    }

    pipeline = pipeline.resize(resizeOptions)

    // Apply output format
    if (outputFormat === 'jpeg') {
      pipeline = pipeline.jpeg({ quality: quality || 80 })
    } else if (outputFormat === 'webp') {
      pipeline = pipeline.webp({ quality: quality || 80 })
    } else if (outputFormat === 'png') {
      pipeline = pipeline.png()
    } else {
      pipeline = pipeline.jpeg({ quality: quality || 80 })
    }

    // Process and return
    const buffer = await pipeline.toBuffer()
    const info = await sharp(buffer).metadata()

    return { buffer, info }
  }

  /**
   * Crop an image
   * @param {Object} fileData - Multipart file data
   * @param {Object} options - Crop options
   * @returns {Promise<{buffer: Buffer, info: Object}>}
   */
  async crop(fileData, options) {
    const { x, y, width, height, aspect, gravity = 'center', format, quality } = options
    const outputFormat = this.normalizeOutputFormat(format)

    // Convert file stream to buffer
    const inputBuffer = await fileData.toBuffer()

    // Create Sharp instance
    let pipeline = sharp(inputBuffer)

    // Rectangle crop takes precedence
    if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
      pipeline = pipeline.extract({ left: x, top: y, width, height })
    } else if (aspect) {
      // Aspect ratio crop
      const [aspectWidth, aspectHeight] = aspect.split(':').map(Number)
      const targetAspect = aspectWidth / aspectHeight

      // Get image metadata
      const metadata = await sharp(inputBuffer).metadata()
      const imageAspect = metadata.width / metadata.height

      let extractWidth, extractHeight, left, top

      if (imageAspect > targetAspect) {
        // Image is wider than target aspect
        extractHeight = metadata.height
        extractWidth = Math.round(extractHeight * targetAspect)
        top = 0

        // Calculate left based on gravity
        if (gravity === 'west') {
          left = 0
        } else if (gravity === 'east') {
          left = metadata.width - extractWidth
        } else {
          left = Math.round((metadata.width - extractWidth) / 2)
        }
      } else {
        // Image is taller than target aspect
        extractWidth = metadata.width
        extractHeight = Math.round(extractWidth / targetAspect)
        left = 0

        // Calculate top based on gravity
        if (gravity === 'north') {
          top = 0
        } else if (gravity === 'south') {
          top = metadata.height - extractHeight
        } else {
          top = Math.round((metadata.height - extractHeight) / 2)
        }
      }

      pipeline = pipeline.extract({ left, top, width: extractWidth, height: extractHeight })
    }

    // Apply output format
    if (outputFormat === 'jpeg') {
      pipeline = pipeline.jpeg({ quality: quality || 80 })
    } else if (outputFormat === 'webp') {
      pipeline = pipeline.webp({ quality: quality || 80 })
    } else if (outputFormat === 'png') {
      pipeline = pipeline.png()
    } else {
      pipeline = pipeline.jpeg({ quality: quality || 80 })
    }

    // Process and return
    const buffer = await pipeline.toBuffer()
    const info = await sharp(buffer).metadata()

    return { buffer, info }
  }

  /**
   * Remove background from an image
   * @param {Object} fileData - Multipart file data
   * @param {Object} options - Background removal options
   * @returns {Promise<{buffer: Buffer, info: Object}>}
   */
  async removeBackground(fileData, options) {
    const { output = 'image', format, feather, threshold } = options
    const outputFormat = this.normalizeOutputFormat(format)

    // Convert file stream to buffer
    const inputBuffer = await fileData.toBuffer()

    // Create a Blob with proper mime type for the background removal library
    const inputBlob = new Blob([inputBuffer], { type: fileData.mimetype || 'image/png' })

    // Configure background removal output based on requested output type
    const bgConfig = {
      ...this.bgRemovalConfig,
      output: {
        format: 'image/png',
        quality: 0.8,
        type: output === 'mask' ? 'mask' : 'foreground'
      }
    }

    // Run background removal using @imgly/background-removal-node
    const blob = await removeBackground(inputBlob, bgConfig)

    // Convert Blob to Buffer
    const arrayBuffer = await blob.arrayBuffer()
    let resultBuffer = Buffer.from(arrayBuffer)

    // Process with Sharp for additional transformations
    // Note: When output is 'mask', the library already returns a grayscale mask
    let pipeline = sharp(resultBuffer)

    // Apply feathering (blur the alpha channel edges)
    if (feather && feather > 0 && output !== 'mask') {
      // Split into channels, blur alpha, then recombine
      const metadata = await sharp(resultBuffer).metadata()

      if (metadata.channels === 4) {
        // Extract RGB and Alpha channels
        const rgb = await sharp(resultBuffer)
          .removeAlpha()
          .toBuffer()

        const alpha = await sharp(resultBuffer)
          .extractChannel('alpha')
          .blur(feather)
          .toBuffer()

        // Recombine
        resultBuffer = await sharp(rgb)
          .joinChannel(alpha)
          .toBuffer()

        pipeline = sharp(resultBuffer)
      }
    }

    // Apply threshold to alpha channel (for mask output)
    if (threshold !== undefined && output === 'mask') {
      pipeline = pipeline.threshold(threshold)
    }

    // Apply output format
    if (outputFormat === 'jpeg') {
      // JPEG doesn't support transparency, flatten with white background
      pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 80 })
    } else if (outputFormat === 'webp') {
      // WebP supports transparency natively
      pipeline = pipeline.webp({ quality: 80 })
    } else {
      // PNG preserves alpha channel — the correct default for background removal
      pipeline = pipeline.png()
    }

    const buffer = await pipeline.toBuffer()
    const info = await sharp(buffer).metadata()

    return { buffer, info }
  }

  /**
   * Extract prominent colors from an image and convert to color names
   * @param {Object} fileData - Multipart file data
   * @param {Object} options - Color extraction options
   * @returns {Promise<{colors: string[], palette: Object}>}
   */
  async extractColors(fileData, options = {}) {
    const { maxColors = 3, multicolorThreshold = 0.20 } = options

    // Convert file stream to buffer
    const inputBuffer = await fileData.toBuffer()

    // Resize image to 200x200 for faster color extraction
    const resizedBuffer = await sharp(inputBuffer)
      .resize(200, 200, { fit: 'inside' })
      .toBuffer()

    // Extract color palette using node-vibrant
    const palette = await Vibrant.from(resizedBuffer).getPalette()

    // Convert palette to array and sort by population (prominence)
    const swatches = Object.entries(palette)
      .filter(([_, swatch]) => swatch !== null)
      .map(([name, swatch]) => ({
        name,
        hex: swatch.hex,
        population: swatch.population,
        rgb: swatch.rgb
      }))
      .sort((a, b) => b.population - a.population)
      .slice(0, maxColors)

    if (swatches.length === 0) {
      return { colors: [], palette: {} }
    }

    // Convert hex colors to color names using color-namer (basic palette)
    const colorNames = swatches.map(swatch => {
      const result = namer(swatch.hex, { pick: ['basic'] })
      return result.basic[0].name
    })

    // Remove duplicates while preserving order
    const uniqueColorNames = [...new Set(colorNames)]

    // Calculate total population
    const totalPopulation = swatches.reduce((sum, s) => sum + s.population, 0)

    // Check if colors are relatively similar in prominence (multicolor detection)
    // If we have 3+ colors and each represents at least multicolorThreshold of total, add "multicolor"
    const isMulticolor = swatches.length >= 3 &&
      swatches.every(swatch => (swatch.population / totalPopulation) >= multicolorThreshold)

    const finalColors = [...uniqueColorNames]
    if (isMulticolor && !finalColors.includes('multicolor')) {
      finalColors.push('multicolor')
    }

    // Return color names and detailed palette info
    return {
      colors: finalColors,
      palette: {
        swatches: swatches.map(s => ({
          hex: s.hex,
          rgb: s.rgb,
          colorName: namer(s.hex, { pick: ['basic'] }).basic[0].name,
          population: s.population,
          percentage: Math.round((s.population / totalPopulation) * 100)
        })),
        totalPopulation,
        isMulticolor
      }
    }
  }
}

module.exports = new ImageService()
