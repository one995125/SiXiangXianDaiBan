export interface GrowthPosterInput {
  progress: number
  checkinCount: number
  milestoneCount: number
}

interface CanvasQueryResult {
  node?: any
  width?: number
  height?: number
}

const POSTER_WIDTH = 750
const POSTER_HEIGHT = 1000
const BRAND_LOGO_PATH = '/assets/images/brand/app-avatar-144-v2.png'
const MINI_PROGRAM_CODE_PATH = '/assets/images/brand/miniprogram-code-growth.png'

/**
 * 绘制“朋友同行邀请”成长海报并导出临时图片。
 *
 * 参数说明：component 为当前 Component 实例，用于限定 Canvas 查询作用域；input 为实时成长数据。
 * 调用时机：用户点击“生成分享海报”后。
 * 注意事项：使用小程序 Canvas 2D API，不依赖浏览器 DOM；小程序码保持正方形完整绘制，避免影响识别。
 */
export async function createGrowthSharePoster(component: WechatMiniprogram.Component.TrivialInstance, input: GrowthPosterInput): Promise<string> {
  const canvas = await queryCanvasNode(component)
  const context = canvas.getContext('2d') as any

  canvas.width = POSTER_WIDTH
  canvas.height = POSTER_HEIGHT

  drawPosterBackground(context)
  await drawPosterHeader(context, canvas)
  drawPosterHeadline(context)
  drawCompanionIllustration(context)
  drawSevenDayPath(context, input.progress)
  drawProgressCard(context, input)
  drawTodayCard(context)
  await drawInvitationCard(context, canvas)

  return exportCanvasImage(component, canvas)
}

function queryCanvasNode(component: WechatMiniprogram.Component.TrivialInstance): Promise<any> {
  return new Promise((resolve, reject) => {
    wx.createSelectorQuery()
      .in(component)
      .select('#growthShareCanvas')
      .fields({ node: true, size: true })
      .exec((result) => {
        const canvasResult = result && result[0] as CanvasQueryResult | undefined
        if (!canvasResult || !canvasResult.node) {
          reject(new Error('分享海报画布初始化失败'))
          return
        }
        resolve(canvasResult.node)
      })
  })
}

function drawPosterBackground(context: any): void {
  context.fillStyle = '#fff8ee'
  context.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)

  context.fillStyle = 'rgba(184, 159, 119, 0.15)'
  for (let y = 20; y < POSTER_HEIGHT; y += 28) {
    for (let x = 18; x < POSTER_WIDTH; x += 28) {
      context.beginPath()
      context.arc(x, y, 1.2, 0, Math.PI * 2)
      context.fill()
    }
  }
}

async function drawPosterHeader(context: any, canvas: any): Promise<void> {
  const logo = await loadCanvasImage(canvas, BRAND_LOGO_PATH)
  context.drawImage(logo, 278, 36, 54, 54)
  drawText(context, '一起打卡', 346, 74, 30, '#17152d', 800, 'left')
}

function drawPosterHeadline(context: any): void {
  drawText(context, '一个人坚持，也可以', POSTER_WIDTH / 2, 144, 42, '#17152d', 900, 'center')
  drawText(context, '两个人同行，会更有趣', POSTER_WIDTH / 2, 205, 44, '#17152d', 900, 'center')

  context.strokeStyle = '#8577dd'
  context.lineWidth = 5
  context.lineCap = 'round'
  context.beginPath()
  context.moveTo(421, 220)
  context.quadraticCurveTo(530, 232, 650, 217)
  context.stroke()
}

function drawCompanionIllustration(context: any): void {
  drawSoftCircle(context, 325, 305, 62, '#cfc4ff')
  drawSoftCircle(context, 432, 305, 62, '#bdebdc')
  drawSmileFace(context, 325, 305)
  drawSmileFace(context, 432, 305)

  context.fillStyle = '#f5a49c'
  context.beginPath()
  context.moveTo(378, 246)
  context.bezierCurveTo(365, 229, 342, 242, 378, 267)
  context.bezierCurveTo(414, 242, 391, 229, 378, 246)
  context.fill()
}

function drawSevenDayPath(context: any, progress: number): void {
  const points = [
    { x: 105, y: 400 }, { x: 195, y: 421 }, { x: 286, y: 435 }, { x: 377, y: 431 },
    { x: 468, y: 414 }, { x: 558, y: 389 }, { x: 645, y: 355 },
  ]

  context.strokeStyle = '#eadfcf'
  context.lineWidth = 8
  context.lineCap = 'round'
  context.beginPath()
  points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y))
  context.stroke()

  points.forEach((point, index) => {
    const completed = index < progress
    context.fillStyle = completed ? '#8577dd' : '#fff8ee'
    context.strokeStyle = completed ? '#8577dd' : '#dfcfb7'
    context.lineWidth = 3
    context.beginPath()
    context.arc(point.x, point.y, index === Math.min(progress, 7) - 1 ? 24 : 20, 0, Math.PI * 2)
    context.fill()
    context.stroke()
    drawText(context, String(index + 1), point.x, point.y + 8, 22, completed ? '#ffffff' : '#a7957c', 900, 'center')
  })

  context.fillStyle = '#8577dd'
  context.fillRect(641, 292, 5, 48)
  context.beginPath()
  context.moveTo(646, 294)
  context.lineTo(692, 307)
  context.lineTo(646, 321)
  context.closePath()
  context.fill()
}

function drawProgressCard(context: any, input: GrowthPosterInput): void {
  drawRoundedCard(context, 70, 474, 610, 132, 28, '#fffdf9', 'rgba(133, 119, 221, 0.24)')
  drawText(context, '我的成长进度', 104, 516, 26, '#17152d', 800, 'left')
  drawText(context, String(input.progress), 104, 575, 58, '#8577dd', 900, 'left')
  drawText(context, '/7', 160, 575, 34, '#17152d', 800, 'left')

  const startX = 292
  for (let index = 0; index < 7; index += 1) {
    if (index < 6) {
      context.strokeStyle = index < input.progress - 1 ? '#8577dd' : '#ded5e8'
      context.lineWidth = 4
      context.beginPath()
      context.moveTo(startX + index * 51 + 14, 550)
      context.lineTo(startX + (index + 1) * 51 - 14, 550)
      context.stroke()
    }
    context.fillStyle = index < input.progress ? '#8577dd' : '#eee8f3'
    context.beginPath()
    context.arc(startX + index * 51, 550, 13, 0, Math.PI * 2)
    context.fill()
    if (index < input.progress) {
      drawCheck(context, startX + index * 51, 550, 6, '#ffffff')
    }
  }

  drawText(context, `签到 ${input.checkinCount} 天 · 任务 ${input.milestoneCount}/3`, 292, 588, 20, '#746b82', 700, 'left')
}

function drawTodayCard(context: any): void {
  drawRoundedCard(context, 110, 632, 530, 96, 24, '#fffdf9', 'rgba(232, 160, 150, 0.28)')
  context.fillStyle = '#f5a49c'
  context.beginPath()
  context.arc(164, 680, 30, 0, Math.PI * 2)
  context.fill()
  drawCheck(context, 164, 680, 14, '#ffffff')
  drawText(context, '今天完成一件小事', 218, 689, 28, '#17152d', 800, 'left')
}

async function drawInvitationCard(context: any, canvas: any): Promise<void> {
  drawRoundedCard(context, 60, 760, 630, 192, 30, '#fffdf9', 'rgba(133, 119, 221, 0.2)')
  drawText(context, '一起开始七日成长', 98, 819, 34, '#17152d', 900, 'left')
  drawText(context, '不必连续，每一次都算数', 98, 861, 21, '#746b82', 600, 'left')
  drawPill(context, 98, 884, 292, 48, '#eee9ff')
  drawText(context, '长按识别小程序码', 244, 916, 22, '#5e50bd', 800, 'center')

  const miniProgramCode = await loadCanvasImage(canvas, MINI_PROGRAM_CODE_PATH)
  context.fillStyle = '#ffffff'
  roundRect(context, 500, 790, 154, 154, 22)
  context.fill()
  context.drawImage(miniProgramCode, 510, 800, 134, 134)
}

function exportCanvasImage(component: WechatMiniprogram.Component.TrivialInstance, canvas: any): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      x: 0,
      y: 0,
      width: POSTER_WIDTH,
      height: POSTER_HEIGHT,
      destWidth: POSTER_WIDTH,
      destHeight: POSTER_HEIGHT,
      fileType: 'png',
      quality: 1,
      success: ({ tempFilePath }) => resolve(tempFilePath),
      fail: () => reject(new Error('分享海报导出失败')),
    }, component)
  })
}

function loadCanvasImage(canvas: any, source: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`海报素材加载失败：${source}`))
    image.src = source
  })
}

function drawRoundedCard(context: any, x: number, y: number, width: number, height: number, radius: number, fill: string, stroke: string): void {
  context.save()
  context.shadowColor = 'rgba(63, 47, 95, 0.08)'
  context.shadowBlur = 18
  context.shadowOffsetY = 8
  roundRect(context, x, y, width, height, radius)
  context.fillStyle = fill
  context.fill()
  context.restore()
  roundRect(context, x, y, width, height, radius)
  context.strokeStyle = stroke
  context.lineWidth = 2
  context.stroke()
}

function drawPill(context: any, x: number, y: number, width: number, height: number, fill: string): void {
  roundRect(context, x, y, width, height, height / 2)
  context.fillStyle = fill
  context.fill()
}

function roundRect(context: any, x: number, y: number, width: number, height: number, radius: number): void {
  const safeRadius = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + safeRadius, y)
  context.arcTo(x + width, y, x + width, y + height, safeRadius)
  context.arcTo(x + width, y + height, x, y + height, safeRadius)
  context.arcTo(x, y + height, x, y, safeRadius)
  context.arcTo(x, y, x + width, y, safeRadius)
  context.closePath()
}

function drawSoftCircle(context: any, x: number, y: number, radius: number, color: string): void {
  context.save()
  context.shadowColor = 'rgba(63, 47, 95, 0.1)'
  context.shadowBlur = 14
  context.shadowOffsetY = 7
  context.fillStyle = color
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
  context.fill()
  context.restore()
}

function drawSmileFace(context: any, x: number, y: number): void {
  context.fillStyle = '#2c2942'
  context.beginPath()
  context.arc(x - 16, y - 8, 4, 0, Math.PI * 2)
  context.arc(x + 16, y - 8, 4, 0, Math.PI * 2)
  context.fill()
  context.strokeStyle = '#2c2942'
  context.lineWidth = 3
  context.beginPath()
  context.arc(x, y + 4, 19, 0.18 * Math.PI, 0.82 * Math.PI)
  context.stroke()
}

function drawCheck(context: any, x: number, y: number, size: number, color: string): void {
  context.strokeStyle = color
  context.lineWidth = Math.max(2, size * 0.35)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.beginPath()
  context.moveTo(x - size, y)
  context.lineTo(x - size * 0.25, y + size * 0.7)
  context.lineTo(x + size, y - size * 0.75)
  context.stroke()
}

function drawText(context: any, text: string, x: number, y: number, size: number, color: string, weight: number, align: 'left' | 'center' | 'right'): void {
  context.fillStyle = color
  context.font = `${weight} ${size}px sans-serif`
  context.textAlign = align
  context.textBaseline = 'alphabetic'
  context.fillText(text, x, y)
}
