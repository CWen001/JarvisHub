// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import HomePage from './HomePage'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  })
})

describe('HUST Design Studio landing page', () => {
  it('links the light hero and selected outcomes to the studio', () => {
    render(<HomePage />)

    expect(screen.getByRole('heading', { level: 1, name: '专业设计，由此生成' })).toBeTruthy()
    expect(screen.queryByText('Design Intelligence')).toBeNull()
    expect(screen.getByAltText('华中科技大学设计学院')).toBeTruthy()
    expect(screen.getByAltText('WOWSA')).toBeTruthy()
    expect(screen.getByAltText('服务设计工程中心')).toBeTruthy()
    expect(screen.getByText('让专业设计知识进入每一次生成。')).toBeTruthy()
    expect(screen.getByText('精选设计成果 · 2026')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: '设计成果' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /印度市场手机外观设计迭代/ }).getAttribute('href')).toBe('/cases/india-phone-design')

    const video = document.querySelector('video') as HTMLVideoElement
    expect(video.autoplay).toBe(true)
    expect(video.loop).toBe(true)
    expect(video.muted).toBe(true)
    expect(video.playsInline).toBe(true)

    expect(screen.getAllByRole('link', { name: /开始设计/ })).toHaveLength(4)
    screen.getAllByRole('link', { name: /开始设计/ }).forEach((link) => {
      expect(link.getAttribute('href')).toBe('/studio')
    })
    expect(screen.getByAltText('蓝色冠军主题平板产品概念')).toBeTruthy()
    expect(screen.getByAltText('黑橙色极限越野智能手表产品概念')).toBeTruthy()
  })
})
