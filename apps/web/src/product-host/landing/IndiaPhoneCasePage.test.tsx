// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import IndiaPhoneCasePage from './IndiaPhoneCasePage'

describe('India phone design iteration case', () => {
  it('presents the complete public evidence sequence and language switch', () => {
    render(<IndiaPhoneCasePage />)

    expect(screen.getByRole('heading', { level: 1, name: '印度市场手机外观设计迭代' })).toBeTruthy()
    expect(screen.getByText('76', { selector: 'dt' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: '设计质量的迭代变化' })).toBeTruthy()
    expect(screen.getByText('固定量化 Rubric 从 Batch 06 基线开始。', { exact: false })).toBeTruthy()
    expect(screen.getAllByText(/LEARNING BATCH/)).toHaveLength(16)
    expect(screen.getByText('VALIDATION 01')).toBeTruthy()
    expect(screen.getByText('彩砂地画（Rangoli）：相机功能节点秩序')).toBeTruthy()
    expect(screen.getByText('印度高级工艺组合（Premium Indian Craft Directions）')).toBeTruthy()
    expect(screen.getByText('拒绝：一个方案复制了可识别的竞品相机组合。')).toBeTruthy()
    expect(screen.getByText('第四个方向只保留了 Prompt，未生成图像；Comparison Board 如实保留空位。')).toBeTruthy()

    screen.getAllByRole('link', { name: /开始设计/ }).forEach((link) => {
      expect(link.getAttribute('href')).toBe('/studio')
    })

    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(screen.getByRole('heading', { level: 1, name: 'India-market smartphone exterior design iteration' })).toBeTruthy()
    expect(screen.getByText('Reject — one output copied a recognizable competitor camera signature.')).toBeTruthy()
    expect(screen.getByText('Premium Indian Craft Directions', { selector: 'h3' })).toBeTruthy()
  })

  it('opens a comparison board without hiding its download action', () => {
    render(<IndiaPhoneCasePage />)
    fireEvent.click(screen.getByRole('button', { name: /Batch 15 · 最终最佳/ }))

    expect(screen.getByRole('dialog', { name: 'Batch 15 Comparison Board' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /下载高清图/ }).getAttribute('download')).not.toBeNull()
  })
})
