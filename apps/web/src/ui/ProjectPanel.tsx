import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Title, Text, Button, Group, Stack, Transition, ActionIcon, Tooltip, Popover, Modal, TextInput, Textarea, Select, useMantineColorScheme } from '@mantine/core'
import { useUIStore } from './uiStore'
import {
  deleteDreaminaAccount,
  deleteDreaminaProjectBinding,
  getDreaminaProjectBinding,
  importDreaminaLoginResponse,
  listDreaminaAccounts,
  listProjects,
  probeDreaminaAccount,
  cloneProject,
  deleteProject,
  upsertDreaminaAccount,
  upsertDreaminaProjectBinding,
  type DreaminaAccountDto,
  type DreaminaProjectBindingDto,
  type ProjectDto,
} from '../api/server'
import { IconCopy, IconTrash } from '@tabler/icons-react'
import { $, $t } from '../canvas/i18n'
import { notifications } from '@mantine/notifications'
import { calculateSafeMaxHeight } from './utils/panelPosition'
import { confirmLeaveForProjectChange } from './pendingUploadGuard'
import { stopPanelWheelPropagation } from './utils/panelWheel'
import { spaNavigate } from '../utils/spaNavigate'
import { PanelCard } from './PanelCard'
import { InlinePanel } from './InlinePanel'

function readLoadErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return fallback
}

export default function ProjectPanel(): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const anchorY = useUIStore(s => s.panelAnchorY)
  const currentProject = useUIStore(s => s.currentProject)
  const setCurrentProject = useUIStore(s => s.setCurrentProject)
  const mounted = active === 'project'
  const { colorScheme } = useMantineColorScheme()
  const isDarkTheme = colorScheme === 'dark'
  const projectCardBorder = isDarkTheme ? '1px solid rgba(59, 130, 246, 0.1)' : '1px solid rgba(148, 163, 184, 0.35)'
  const projectCardBackground = isDarkTheme ? 'rgba(15, 23, 42, 0.6)' : 'rgba(255, 255, 255, 0.92)'
  const projectCardHoverBackground = isDarkTheme ? 'rgba(15, 23, 42, 0.8)' : '#f4f7ff'
  const projectCardHoverBorder = isDarkTheme ? '#3b82f6' : '#2563eb'
  const projectCardHoverShadow = isDarkTheme ? '0 4px 20px rgba(59, 130, 246, 0.15)' : '0 10px 24px rgba(15, 23, 42, 0.12)'
  const deleteActionBorder = isDarkTheme ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid rgba(248, 113, 113, 0.45)'
  const [myProjects, setMyProjects] = React.useState<ProjectDto[]>([])
  const [myProjectsLoadError, setMyProjectsLoadError] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [deletingProjectId, setDeletingProjectId] = React.useState<string | null>(null)
  const [popoverProjectId, setPopoverProjectId] = React.useState<string | null>(null)
  const [dreaminaAccounts, setDreaminaAccounts] = React.useState<DreaminaAccountDto[]>([])
  const [dreaminaBinding, setDreaminaBinding] = React.useState<DreaminaProjectBindingDto | null>(null)
  const [dreaminaLoading, setDreaminaLoading] = React.useState(false)
  const [dreaminaBindingSaving, setDreaminaBindingSaving] = React.useState(false)
  const [dreaminaAccountModalOpen, setDreaminaAccountModalOpen] = React.useState(false)
  const [dreaminaSelectedAccountId, setDreaminaSelectedAccountId] = React.useState<string | null>(null)
  const [dreaminaNewAccountLabel, setDreaminaNewAccountLabel] = React.useState('')
  const [dreaminaNewAccountCliPath, setDreaminaNewAccountCliPath] = React.useState('')
  const [dreaminaLoginJson, setDreaminaLoginJson] = React.useState('')
  const currentProjectId = currentProject?.id ? String(currentProject.id).trim() : ''
  const selectedDreaminaAccount = React.useMemo(
    () => dreaminaAccounts.find((account) => account.id === dreaminaSelectedAccountId) || null,
    [dreaminaAccounts, dreaminaSelectedAccountId],
  )
  const boundDreaminaAccount = React.useMemo(
    () => dreaminaAccounts.find((account) => account.id === dreaminaBinding?.accountId) || null,
    [dreaminaAccounts, dreaminaBinding?.accountId],
  )

  React.useEffect(() => {
    if (!mounted) return
    setLoading(true)
    listProjects()
      .then((projects) => {
        setMyProjects(projects)
        setMyProjectsLoadError('')
      })
      .catch((error: unknown) => {
        setMyProjectsLoadError(readLoadErrorMessage(error, $('项目列表加载失败')))
      })
      .finally(() => setLoading(false))
  }, [mounted])

  const reloadDreaminaState = React.useCallback(async () => {
    if (!mounted) return
    setDreaminaLoading(true)
    try {
      const accounts = await listDreaminaAccounts()
      setDreaminaAccounts(accounts)
      if (currentProjectId) {
        const binding = await getDreaminaProjectBinding(currentProjectId)
        setDreaminaBinding(binding)
        setDreaminaSelectedAccountId(binding?.accountId || null)
      } else {
        setDreaminaBinding(null)
        setDreaminaSelectedAccountId(null)
      }
    } catch (error) {
      console.error('加载 Dreamina 状态失败:', error)
      setDreaminaAccounts([])
      setDreaminaBinding(null)
    } finally {
      setDreaminaLoading(false)
    }
  }, [mounted, currentProjectId])

  React.useEffect(() => {
    void reloadDreaminaState()
  }, [reloadDreaminaState])

  const handleSaveDreaminaBinding = React.useCallback(async () => {
    if (!currentProjectId) return
    if (!dreaminaSelectedAccountId) {
      notifications.show({ title: $('失败'), message: $('请先选择一个 Dreamina 账号'), autoClose: 2000, color: 'red' })
      return
    }
    setDreaminaBindingSaving(true)
    try {
      const binding = await upsertDreaminaProjectBinding(currentProjectId, {
        accountId: dreaminaSelectedAccountId,
        enabled: true,
      })
      setDreaminaBinding(binding)
      notifications.show({ title: $('成功'), message: $('Dreamina 项目账号已绑定'), autoClose: 2000, color: 'green' })
    } catch (error) {
      console.error('保存 Dreamina 绑定失败:', error)
      notifications.show({ title: $('失败'), message: $('保存 Dreamina 绑定失败'), autoClose: 2500, color: 'red' })
    } finally {
      setDreaminaBindingSaving(false)
    }
  }, [currentProjectId, dreaminaSelectedAccountId])

  const handleCreateDreaminaAccount = React.useCallback(async () => {
    const nextLabel = dreaminaNewAccountLabel.trim()
    if (!nextLabel) {
      notifications.show({ title: $('失败'), message: $('请先填写账号名称'), autoClose: 2000, color: 'red' })
      return
    }
    try {
      const account = await upsertDreaminaAccount({
        label: nextLabel,
        cliPath: dreaminaNewAccountCliPath.trim() || null,
      })
      setDreaminaNewAccountLabel('')
      setDreaminaNewAccountCliPath('')
      setDreaminaSelectedAccountId(account.id)
      await reloadDreaminaState()
      notifications.show({ title: $('成功'), message: $('Dreamina 账号已创建'), autoClose: 2000, color: 'green' })
    } catch (error) {
      console.error('创建 Dreamina 账号失败:', error)
      notifications.show({ title: $('失败'), message: $('创建 Dreamina 账号失败'), autoClose: 2500, color: 'red' })
    }
  }, [dreaminaNewAccountCliPath, dreaminaNewAccountLabel, reloadDreaminaState])

  const handleImportDreaminaLogin = React.useCallback(async () => {
    if (!dreaminaSelectedAccountId) {
      notifications.show({ title: $('失败'), message: $('请先选择账号'), autoClose: 2000, color: 'red' })
      return
    }
    const nextJson = dreaminaLoginJson.trim()
    if (!nextJson) {
      notifications.show({ title: $('失败'), message: $('请先粘贴登录 JSON'), autoClose: 2000, color: 'red' })
      return
    }
    try {
      const probe = await importDreaminaLoginResponse(dreaminaSelectedAccountId, nextJson)
      setDreaminaLoginJson('')
      await reloadDreaminaState()
      notifications.show({ title: probe.ok ? $('成功') : $('失败'), message: probe.message, autoClose: 2500, color: probe.ok ? 'green' : 'red' })
    } catch (error) {
      console.error('导入 Dreamina 登录态失败:', error)
      notifications.show({ title: $('失败'), message: $('导入 Dreamina 登录态失败'), autoClose: 2500, color: 'red' })
    }
  }, [dreaminaLoginJson, dreaminaSelectedAccountId, reloadDreaminaState])

  const handleProbeDreaminaAccount = React.useCallback(async () => {
    if (!dreaminaSelectedAccountId) return
    try {
      const probe = await probeDreaminaAccount(dreaminaSelectedAccountId)
      await reloadDreaminaState()
      notifications.show({ title: probe.ok ? $('成功') : $('失败'), message: probe.message, autoClose: 2500, color: probe.ok ? 'green' : 'red' })
    } catch (error) {
      console.error('检查 Dreamina 账号失败:', error)
      notifications.show({ title: $('失败'), message: $('检查 Dreamina 账号失败'), autoClose: 2500, color: 'red' })
    }
  }, [dreaminaSelectedAccountId, reloadDreaminaState])

  const handleCloneProject = async (project: ProjectDto) => {
    try {
      if (!confirmLeaveForProjectChange({ nextProjectName: project.name || '克隆项目' })) return
      const clonedProject = await cloneProject(project.id, $t('克隆项目 - {{name}}', { name: project.name }))
      setMyProjects(prev => [clonedProject, ...prev])
      notifications.show({
        id: `clone-success-${project.id}`,
        withCloseButton: true,
        autoClose: 4000,
        title: $('成功'),
        message: $t('项目「{{name}}」克隆成功', { name: project.name }),
        color: 'green',
        icon: <motion.div
          initial={{ scale: 0, rotate: 180 }}
          animate={{ scale: 1, rotate: 360 }}
          transition={{ duration: 0.6, type: "spring", stiffness: 200 }}
        >
          🚀
        </motion.div>,
        style: {
          backdropFilter: 'blur(10px)',
          backgroundColor: 'rgba(34, 197, 94, 0.12)',
          border: '1px solid rgba(34, 197, 94, 0.2)',
        }
      })
      if (clonedProject?.id) {
        setCurrentProject({ id: clonedProject.id, name: clonedProject.name })
        setActivePanel(null)
      }
    } catch (error) {
      console.error('克隆项目失败:', error)
      notifications.show({
        id: 'clone-error',
        withCloseButton: true,
        autoClose: 4000,
        title: $('失败'),
        message: $('克隆项目失败'),
        color: 'red',
        icon: <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, type: "spring" }}
        >
          ⚠️
        </motion.div>,
        style: {
          backdropFilter: 'blur(10px)',
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
        }
      })
    }
  }

  const closePopover = () => setPopoverProjectId(null)

  const openDeletePopover = (projectId: string) => {
    setPopoverProjectId(projectId)
  }
  const confirmPopoverDelete = (project: ProjectDto) => {
    closePopover()
    handleDeleteProject(project)
  }
  const handleDeleteProject = async (project: ProjectDto) => {
    setDeletingProjectId(project.id)
    try {
      await deleteProject(project.id)
      setMyProjects(prev => prev.filter(p => p.id !== project.id))
      if (currentProject?.id === project.id) {
        setCurrentProject(null)
      }
      notifications.show({
        id: `delete-project-${project.id}`,
        withCloseButton: true,
        autoClose: 4000,
        title: $('成功'),
        message: $t('项目「{{name}}」已删除', { name: project.name }),
        color: 'green',
        icon: <motion.div
          initial={{ scale: 0, rotate: 0 }}
          animate={{ scale: 1, rotate: 360 }}
          transition={{ duration: 0.4, type: "spring" }}
        >
          ✅
        </motion.div>,
        style: {
          backdropFilter: 'blur(10px)',
          backgroundColor: 'rgba(34, 197, 94, 0.12)',
          border: '1px solid rgba(34, 197, 94, 0.2)',
        }
      })
    } catch (error) {
      console.error('删除项目失败:', error)
      notifications.show({
        id: `delete-project-error-${project.id}`,
        withCloseButton: true,
        autoClose: 4000,
        title: $('失败'),
        message: $t('删除项目失败'),
        color: 'red',
        icon: <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.4, type: "spring" }}
        >
          ❌
        </motion.div>,
        style: {
          backdropFilter: 'blur(10px)',
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.2)'
        }
      })
    } finally {
      setDeletingProjectId(null)
    }
  }

  if (!mounted) return null

  // 计算安全的最大高度
  const maxHeight = calculateSafeMaxHeight(anchorY, 150)

  return (
    <div className="project-panel-anchor" style={{ position: 'fixed', left: 82, top: anchorY ? anchorY - 150 : 140, zIndex: 300 }} data-ux-panel>
      <Transition className="project-panel-transition" mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div className="project-panel-transition-inner" style={styles}>
            <PanelCard
              className="glass"
              style={{
                width: 500,
                maxHeight: `${maxHeight}px`,
                minHeight: 0,
                transformOrigin: 'left center',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
              onWheelCapture={stopPanelWheelPropagation}
              data-ux-panel
            >
              <div className="project-panel-arrow panel-arrow" />
              <motion.div
                className="project-panel-header-motion"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                style={{ position: 'sticky', top: 0, zIndex: 1, background: 'transparent' }}
              >
                <Group className="project-panel-header" justify="space-between" mb={8}>
                  <Title className="project-panel-title" order={6}>{$('项目')}</Title>
                  <Group className="project-panel-header-actions" gap={8}>
                    <Button
                      className="project-panel-header-dreamina-button"
                      size="xs"
                      variant="subtle"
                      onClick={() => setDreaminaAccountModalOpen(true)}
                    >
                      {$('Dreamina 账号')}
                    </Button>
                    <motion.div className="project-panel-create-motion" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                      <Button className="project-panel-create-button" size="xs" variant="light" onClick={async () => {
                        if (!confirmLeaveForProjectChange({ nextProjectName: '上传原文创建项目' })) return
                        setActivePanel(null)
                        spaNavigate('/projects')
                      }}>
                        {$('上传原文')}
                      </Button>
                    </motion.div>
                  </Group>
                </Group>
              </motion.div>

                <div className="project-panel-body" style={{ flex: 1, overflowY: 'auto', paddingRight: 4, minHeight: 0 }}>
                {currentProjectId ? (
                  <InlinePanel
                    className="project-panel-dreamina-card"
                    mb="sm"
                    style={{
                      border: projectCardBorder,
                      background: projectCardBackground,
                    }}
                  >
                    <Stack className="project-panel-dreamina-stack" gap={8}>
                      <Group className="project-panel-dreamina-header" justify="space-between" align="center">
                        <div className="project-panel-dreamina-header-text">
                          <Text className="project-panel-dreamina-title" fw={600} size="sm">Dreamina / 即梦</Text>
                          <Text className="project-panel-dreamina-subtitle" size="xs" c="dimmed">
                            {boundDreaminaAccount
                              ? `当前项目已绑定账号 ${boundDreaminaAccount.label}`
                              : '当前项目尚未绑定 Dreamina 账号'}
                          </Text>
                        </div>
                        <Group className="project-panel-dreamina-actions" gap={6}>
                          <Button className="project-panel-dreamina-manage-button" size="compact-xs" variant="light" onClick={() => setDreaminaAccountModalOpen(true)}>
                            {$('管理账号')}
                          </Button>
                          <Button className="project-panel-dreamina-probe-button" size="compact-xs" variant="subtle" onClick={() => void handleProbeDreaminaAccount()} disabled={!dreaminaSelectedAccountId}>
                            {$('检查')}
                          </Button>
                        </Group>
                      </Group>
                      <Group className="project-panel-dreamina-binding-row" align="flex-end" gap={8} wrap="nowrap">
                        <Select
                          className="project-panel-dreamina-select"
                          style={{ flex: 1 }}
                          label={$('项目账号')}
                          placeholder={dreaminaLoading ? $('加载中...') : $('选择 Dreamina 账号')}
                          data={dreaminaAccounts.map((account) => ({
                            value: account.id,
                            label: `${account.label}${account.lastError ? ' · 未就绪' : ''}`,
                          }))}
                          value={dreaminaSelectedAccountId}
                          onChange={setDreaminaSelectedAccountId}
                          searchable
                          clearable
                        />
                        <Button
                          className="project-panel-dreamina-bind-button"
                          size="sm"
                          loading={dreaminaBindingSaving}
                          onClick={() => void handleSaveDreaminaBinding()}
                        >
                          {$('保存绑定')}
                        </Button>
                        <Button
                          className="project-panel-dreamina-unbind-button"
                          size="sm"
                          variant="subtle"
                          color="red"
                          disabled={!dreaminaBinding}
                          onClick={async () => {
                            if (!currentProjectId) return
                            try {
                              await deleteDreaminaProjectBinding(currentProjectId)
                              setDreaminaBinding(null)
                              await reloadDreaminaState()
                              notifications.show({ title: $('成功'), message: $('Dreamina 项目绑定已移除'), autoClose: 2000, color: 'green' })
                            } catch (error) {
                              console.error('删除 Dreamina 项目绑定失败:', error)
                              notifications.show({ title: $('失败'), message: $('删除 Dreamina 项目绑定失败'), autoClose: 2500, color: 'red' })
                            }
                          }}
                        >
                          {$('解绑')}
                        </Button>
                      </Group>
                    </Stack>
                  </InlinePanel>
                ) : null}
                <div className="project-panel-my-list">
                    <AnimatePresence className="project-panel-my-list-presence" mode="wait">
                      {myProjectsLoadError && !loading && (
                        <motion.div
                          className="project-panel-load-error-motion"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                        >
                          <Text className="project-panel-load-error-text" size="xs" c="red" ta="center">{myProjectsLoadError}</Text>
                        </motion.div>
                      )}
                      {myProjects.length === 0 && !myProjectsLoadError && !loading && (
                        <motion.div
                          className="project-panel-empty-motion"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                        >
                          <Text className="project-panel-empty-text" size="xs" c="dimmed" ta="center">{$('暂无项目')}</Text>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <Stack className="project-panel-list" gap={6}>
                      {myProjects.map((p, index) => (
                        <motion.div
                          className="project-panel-card-motion"
                          key={p.id}
                          initial={{ opacity: 0, x: -15 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 15 }}
                          transition={{
                            duration: 0.15,
                            delay: index * 0.02,
                            type: "spring",
                            stiffness: 500,
                            damping: 25
                          }}
                          whileHover={{
                            scale: 1.005,
                            boxShadow: projectCardHoverShadow,
                            borderColor: projectCardHoverBorder,
                            backgroundColor: projectCardHoverBackground
                          }}
                          style={{
                            border: projectCardBorder,
                            borderRadius: 8,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            margin: '6px 12px',
                            padding: '2px 0',
                            backgroundColor: projectCardBackground
                          }}
                        >
                          <Group className="project-panel-card" justify="space-between" p="sm" gap="md">
                            <div className="project-panel-card-main" style={{ flex: 1, minWidth: 0 }}>
                              <Group className="project-panel-card-title-row" gap={10} mb={6}>
                                <motion.div
                                  className="project-panel-card-title-motion"
                                  whileHover={{ scale: 1.02 }}
                                  transition={{ type: "spring", stiffness: 400 }}
                                >
                                  <Text
                                    className="project-panel-card-title"
                                    size="sm"
                                    fw={currentProject?.id===p.id?600:500}
                                    c={currentProject?.id===p.id?'blue':undefined}
                                    style={{
                                      letterSpacing: '0.01em',
                                      lineHeight: 1.4
                                    }}
                                  >
                                    {p.name}
                                  </Text>
                                </motion.div>
                              </Group>
                            </div>
                            <Group className="project-panel-card-actions" gap={6} align="center">
                              <motion.div
                                className="project-panel-clone-motion"
                                whileHover={{ scale: 1.08 }}
                                whileTap={{ scale: 0.96 }}
                                transition={{ type: "spring", stiffness: 400 }}
                              >
                                <Tooltip
                                  className="project-panel-clone-tooltip"
                                  label={$('克隆项目')}
                                  position="top"
                                  withArrow
                                >
                                  <ActionIcon
                                    className="project-panel-clone-action"
                                    size="sm"
                                    variant="subtle"
                                    onClick={async () => handleCloneProject(p)}
                                  >
                                    <IconCopy className="project-panel-clone-icon" size={14} />
                                  </ActionIcon>
                                </Tooltip>
                              </motion.div>
                              <motion.div
                                className="project-panel-delete-motion"
                                whileHover={{ scale: 1.04 }}
                                whileTap={{ scale: 0.96 }}
                                transition={{ type: "spring", stiffness: 400 }}
                              >
                                <Popover
                                  className="project-panel-delete-popover"
                                  opened={popoverProjectId === p.id}
                                  onClose={closePopover}
                                  withArrow
                                  position="top"
                                  trapFocus
                                  shadow="md"
                                  radius="md"
                                  withinPortal
                                  dropdownProps={{ withinPortal: true, zIndex: 9000 }}
                                  closeOnClickOutside
                                >
                                  <Popover.Target className="project-panel-delete-target">
                                    <Tooltip
                                      className="project-panel-delete-tooltip"
                                      label={$t('删除项目')}
                                      position="top"
                                      withArrow
                                    >
                                      <ActionIcon
                                        className="project-panel-delete-action"
                                        size="sm"
                                        variant="subtle"
                                        color="red"
                                        onClick={() => openDeletePopover(p.id)}
                                        loading={deletingProjectId === p.id}
                                        style={{
                                          border: deleteActionBorder
                                        }}
                                      >
                                        <IconTrash className="project-panel-delete-icon" size={14} />
                                      </ActionIcon>
                                    </Tooltip>
                                  </Popover.Target>
                                  <Popover.Dropdown className="project-panel-delete-dropdown">
                                    <Text className="project-panel-delete-text" size="xs">{$t('确定要删除项目「{{name}}」吗？', { name: p.name })}</Text>
                                    <Group className="project-panel-delete-actions" position="right" spacing="xs" mt="xs">
                                      <Button className="project-panel-delete-cancel" size="xs" variant="subtle" onClick={closePopover}>{$('取消')}</Button>
                                      <Button className="project-panel-delete-confirm" size="xs" color="red" loading={deletingProjectId === p.id} onClick={() => confirmPopoverDelete(p)}>{$('删除')}</Button>
                                    </Group>
                                  </Popover.Dropdown>
                                </Popover>
                              </motion.div>
                              <motion.div
                                className="project-panel-select-motion"
                                whileHover={{
                                  scale: 1.04,
                                  x: 2
                                }}
                                whileTap={{
                                  scale: 0.98,
                                  x: 0
                                }}
                                transition={{ type: "spring", stiffness: 500 }}
                              >
                                <Button
                                  className="project-panel-select-button"
                                  size="xs"
                                  variant="light"
                                  onClick={async () => {
                                    if (!confirmLeaveForProjectChange({ nextProjectName: p.name })) return
                                    setCurrentProject({ id: p.id, name: p.name })
                                    setActivePanel(null)
                                  }}
                                  style={{
                                    fontWeight: 500,
                                    letterSpacing: '0.02em'
                                  }}
                                >
                                  {$('选择')}
                                </Button>
                              </motion.div>
                            </Group>
                          </Group>
                        </motion.div>
                      ))}
                    </Stack>
                  </div>
                </div>
              <Modal
                className="project-panel-dreamina-modal"
                opened={dreaminaAccountModalOpen}
                onClose={() => setDreaminaAccountModalOpen(false)}
                title={$('Dreamina 账号管理')}
                centered
                radius="md"
                size="lg"
              >
                <Stack className="project-panel-dreamina-modal-stack" gap="sm">
                  <TextInput
                    className="project-panel-dreamina-new-label"
                    label={$('新账号名称')}
                    placeholder={$('例如：项目 A 专用即梦')}
                    value={dreaminaNewAccountLabel}
                    onChange={(e) => setDreaminaNewAccountLabel(e.currentTarget.value)}
                  />
                  <TextInput
                    className="project-panel-dreamina-cli-path"
                    label={$('CLI 路径（可选）')}
                    placeholder="dreamina"
                    value={dreaminaNewAccountCliPath}
                    onChange={(e) => setDreaminaNewAccountCliPath(e.currentTarget.value)}
                  />
                  <Group className="project-panel-dreamina-create-actions" justify="flex-end">
                    <Button className="project-panel-dreamina-create-submit" onClick={() => void handleCreateDreaminaAccount()}>
                      {$('创建账号')}
                    </Button>
                  </Group>
                  <Select
                    className="project-panel-dreamina-modal-select"
                    label={$('当前操作账号')}
                    data={dreaminaAccounts.map((account) => ({
                      value: account.id,
                      label: `${account.label}${account.lastError ? ' · 未就绪' : ''}`,
                    }))}
                    value={dreaminaSelectedAccountId}
                    onChange={setDreaminaSelectedAccountId}
                    searchable
                    clearable
                  />
                  <Textarea
                    className="project-panel-dreamina-login-json"
                    label={$('导入登录 JSON')}
                    placeholder={$('把 dreamina import_login_response 需要的完整 JSON 粘贴到这里')}
                    value={dreaminaLoginJson}
                    onChange={(e) => setDreaminaLoginJson(e.currentTarget.value)}
                    minRows={6}
                    maxRows={10}
                  />
                  <Group className="project-panel-dreamina-modal-actions" justify="space-between" align="center">
                    <Text className="project-panel-dreamina-modal-tip" size="xs" c="dimmed">
                      {selectedDreaminaAccount
                        ? $t('当前账号：{{label}}。支持账号创建、登录态导入、健康检查和删除。', { label: selectedDreaminaAccount.label })
                        : $('支持账号创建、登录态导入、健康检查和删除。')}
                    </Text>
                    <Group className="project-panel-dreamina-modal-buttons" gap={8}>
                      <Button className="project-panel-dreamina-import-button" variant="light" onClick={() => void handleImportDreaminaLogin()} disabled={!dreaminaSelectedAccountId}>
                        {$('导入登录态')}
                      </Button>
                      <Button className="project-panel-dreamina-probe-button" variant="subtle" onClick={() => void handleProbeDreaminaAccount()} disabled={!dreaminaSelectedAccountId}>
                        {$('检查账号')}
                      </Button>
                      <Button
                        className="project-panel-dreamina-delete-button"
                        variant="subtle"
                        color="red"
                        disabled={!dreaminaSelectedAccountId}
                        onClick={async () => {
                          if (!dreaminaSelectedAccountId) return
                          if (!window.confirm($('确定删除当前 Dreamina 账号吗？'))) return
                          try {
                            await deleteDreaminaAccount(dreaminaSelectedAccountId)
                            setDreaminaSelectedAccountId(null)
                            await reloadDreaminaState()
                            notifications.show({ title: $('成功'), message: $('Dreamina 账号已删除'), autoClose: 2000, color: 'green' })
                          } catch (error) {
                            console.error('删除 Dreamina 账号失败:', error)
                            notifications.show({ title: $('失败'), message: $('删除 Dreamina 账号失败'), autoClose: 2500, color: 'red' })
                          }
                        }}
                      >
                        {$('删除账号')}
                      </Button>
                    </Group>
                  </Group>
                </Stack>
              </Modal>
            </PanelCard>
          </div>
        )}
      </Transition>
    </div>
  )
}
