/* eslint-disable no-console */
// One-shot canvas measurement: verify group auto-fit produces tight padding.
// Usage: node apps/web/scripts/measureGroupFit.mjs <projectId> <flowId>
// Defaults to the project URL the user gave us.

import { chromium } from '<repo>/node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PROJECT_ID = process.argv[2] || '70db55f6-1dde-4c60-9ec1-961c682e5f7f'
const FLOW_ID = process.argv[3] || '66e53bb6-d3cd-4bbe-a6d1-19bba3eae747'
const URL = `http://localhost:5173/studio?projectId=${PROJECT_ID}&flowId=${FLOW_ID}`

// Reuse the user-data-dir that the MCP playwright server has already populated
// with this user's auth cookies and last-opened flow context. Avoids login.
const PROFILE = process.env.PW_PROFILE
  || '<home>/Library/Caches/ms-playwright/mcp-chrome-75e76d9'
const browser = await chromium.launchPersistentContext(
  PROFILE,
  {
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    viewport: { width: 1440, height: 900 },
  },
)
try {
  const ctx = browser
  const page = await ctx.newPage()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('load').catch(() => {})

  // Diagnostic: capture page state immediately to inspect what we got.
  await page.screenshot({ path: resolve(process.cwd(), 'canvas-diagnostic-before-wait.png') })
  const earlyTitle = await page.title()
  const earlyUrl = page.url()
  console.log('early diagnostic:', { earlyUrl, earlyTitle })

  await page.waitForSelector('.react-flow__node', { timeout: 15_000 })
  // Give the canvas time to autofit + dim measurements + dim-driven refits to settle
  await page.waitForTimeout(2_500)

  const screenshotPath = resolve(process.cwd(), 'canvas-after-fit-headless.png')
  await page.screenshot({ path: screenshotPath })

  const result = await page.evaluate(() => {
    const vp = document.querySelector('.react-flow__viewport')
    const vpTr = vp ? vp.style.transform : ''
    const sm = /scale\(([\d.]+)\)/.exec(vpTr)
    const scale = sm ? parseFloat(sm[1]) : 1

    const els = Array.from(document.querySelectorAll('.react-flow__node'))
    const groups = new Map()
    const childList = []
    for (const el of els) {
      const id = el.getAttribute('data-id') || ''
      const tr = el.style.transform || ''
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(tr)
      const x = m ? parseFloat(m[1]) : 0
      const y = m ? parseFloat(m[2]) : 0
      let w = parseFloat(el.style.width) || 0
      let h = parseFloat(el.style.height) || 0
      if (!w || !h) {
        const r = el.getBoundingClientRect()
        w = r.width / scale
        h = r.height / scale
      }
      const isGroup = (el.className || '').includes('node-groupNode')
      if (isGroup) groups.set(id, { id, x, y, w, h })
      else childList.push({ id, x, y, w, h })
    }

    // Probe React Flow internal store for manualSize / parent linkage by walking
    // the fiber tree from any rendered group node.
    function readGroupData(id) {
      const node = document.querySelector(`[data-id="${id}"]`)
      if (!node) return null
      const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'))
      if (!fiberKey) return null
      let fiber = node[fiberKey]
      let levels = 0
      while (fiber && levels < 30) {
        const props = fiber.memoizedProps
        if (props && props.data && (typeof props.data.manualSize !== 'undefined' || props.data.label || props.data.groupKind)) {
          return {
            manualSize: props.data.manualSize === true,
            nodeWidth: typeof props.data.nodeWidth === 'number' ? props.data.nodeWidth : null,
            nodeHeight: typeof props.data.nodeHeight === 'number' ? props.data.nodeHeight : null,
          }
        }
        fiber = fiber.return
        levels++
      }
      return null
    }

    const out = []
    for (const g of groups.values()) {
      const inside = childList.filter((c) =>
        c.x + 1 >= g.x && c.y + 1 >= g.y &&
        c.x + c.w <= g.x + g.w + 2 && c.y + c.h <= g.y + g.h + 2,
      )
      let bbox = null
      if (inside.length) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const c of inside) {
          if (c.x < minX) minX = c.x
          if (c.y < minY) minY = c.y
          if (c.x + c.w > maxX) maxX = c.x + c.w
          if (c.y + c.h > maxY) maxY = c.y + c.h
        }
        bbox = { minX, minY, maxX, maxY }
      }
      out.push({
        id: g.id,
        groupSize: { w: Math.round(g.w), h: Math.round(g.h) },
        childCount: inside.length,
        slack: bbox
          ? {
              left: Math.round(bbox.minX - g.x),
              top: Math.round(bbox.minY - g.y),
              right: Math.round(g.x + g.w - bbox.maxX),
              bottom: Math.round(g.y + g.h - bbox.maxY),
            }
          : null,
        groupData: readGroupData(g.id),
      })
    }
    return { scale, groups: out }
  })

  console.log(JSON.stringify(result, null, 2))
  writeFileSync(resolve(process.cwd(), 'canvas-after-fit-measurements.json'), JSON.stringify(result, null, 2))
  console.log(`\nScreenshot: ${screenshotPath}`)
} finally {
  await browser.close()
}
