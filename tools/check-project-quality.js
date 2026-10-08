const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')

const projectRoot = path.resolve(__dirname, '..')
const miniprogramRoot = path.join(projectRoot, 'miniprogram')
const cloudfunctionsRoot = path.join(projectRoot, 'cloudfunctions')
const ignoredDirectories = new Set(['node_modules', '.git', '.codex_tmp', 'miniprogram_npm'])

function walkFiles(root, extensions) {
  const results = []
  if (!fs.existsSync(root)) return results

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const absolutePath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      results.push(...walkFiles(absolutePath, extensions))
    } else if (extensions.has(path.extname(entry.name))) {
      results.push(absolutePath)
    }
  }
  return results
}

function relative(filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/')
}

function checkJsonFiles() {
  const files = walkFiles(projectRoot, new Set(['.json']))
  const errors = []
  for (const filePath of files) {
    try {
      JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch (error) {
      errors.push(`${relative(filePath)}: ${error.message}`)
    }
  }
  return { label: `JSON 解析（${files.length} 个文件）`, errors }
}

function checkBrowserApis() {
  const files = walkFiles(miniprogramRoot, new Set(['.ts', '.js', '.wxml']))
  const forbiddenPattern = /\b(document|window|localStorage|sessionStorage|getElementById|querySelector)\b/
  const errors = []
  for (const filePath of files) {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
    lines.forEach((line, index) => {
      if (forbiddenPattern.test(line)) {
        errors.push(`${relative(filePath)}:${index + 1}: ${line.trim()}`)
      }
    })
  }
  return { label: '浏览器 DOM/BOM 禁用扫描', errors }
}

function checkCloudFunctionSyntax() {
  const files = walkFiles(cloudfunctionsRoot, new Set(['.js']))
  const errors = []
  for (const filePath of files) {
    const result = childProcess.spawnSync(process.execPath, ['--check', filePath], {
      cwd: projectRoot,
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      errors.push(`${relative(filePath)}: ${(result.stderr || result.stdout).trim()}`)
    }
  }
  return { label: `云函数 JS 语法（${files.length} 个文件）`, errors }
}

function checkPageDeclarations() {
  const appConfigPath = path.join(miniprogramRoot, 'app.json')
  const appConfig = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'))
  const declaredPages = [...(appConfig.pages || [])]
  for (const subPackage of appConfig.subPackages || []) {
    for (const page of subPackage.pages || []) {
      declaredPages.push(`${subPackage.root}/${page}`)
    }
  }

  const errors = []
  for (const pagePath of declaredPages) {
    for (const extension of ['.ts', '.wxml', '.less', '.json']) {
      const filePath = path.join(miniprogramRoot, `${pagePath}${extension}`)
      if (!fs.existsSync(filePath)) {
        errors.push(`${pagePath}: 缺少 ${extension} 文件`)
      }
    }
  }
  return { label: `页面声明完整性（${declaredPages.length} 个页面）`, errors }
}

const checks = [
  checkJsonFiles(),
  checkBrowserApis(),
  checkCloudFunctionSyntax(),
  checkPageDeclarations(),
]

let failed = false
for (const check of checks) {
  if (check.errors.length === 0) {
    console.log(`[通过] ${check.label}`)
    continue
  }
  failed = true
  console.error(`[失败] ${check.label}`)
  check.errors.forEach((error) => console.error(`  - ${error}`))
}

if (failed) {
  process.exitCode = 1
} else {
  console.log('项目静态质量门禁全部通过。')
}
