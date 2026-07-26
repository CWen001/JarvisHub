import React from 'react'
import { Stack, Text, Button, Group } from '@mantine/core'
import { IconFolder } from '@tabler/icons-react'
import { $ } from '../canvas/i18n'

type CanvasEmptyGuideProps = {
  mode: 'no-project' | 'empty-canvas'
  onGoToProjects?: () => void
}

export default function CanvasEmptyGuide({ mode, onGoToProjects }: CanvasEmptyGuideProps): JSX.Element {
  return (
    <div className="canvas-empty-guide">
      <Stack align="center" gap="md" className="canvas-empty-guide-content">
        {mode === 'no-project' ? (
          <>
            <Text size="lg" fw={500}>{$('尚未绑定项目')}</Text>
            <Text size="sm" c="dimmed">
              {$('请选择一个项目或新建项目，画布内容将自动保存到项目中。')}
            </Text>
            <Group gap="sm">
              <Button leftSection={<IconFolder size={16} />} variant="light" onClick={onGoToProjects}>
                {$('打开项目列表')}
              </Button>
            </Group>
          </>
        ) : (
          <>
            <Text size="sm" c="dimmed">{$('添加节点开始创作')}</Text>
          </>
        )}
      </Stack>
    </div>
  )
}
