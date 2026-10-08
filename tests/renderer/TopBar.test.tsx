import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TopBar, type TopBarProps } from '../../src/features/TopBar'
import { makeLlmStatus } from './lkv'

function makeProps(overrides: Partial<TopBarProps> = {}): TopBarProps {
  return {
    advanced: false,
    mode: 'chat',
    activePluginId: null,
    pluginsMenuAnchor: null,
    visiblePlugins: [],
    aiStatusText: 'AI: …',
    llmStatus: makeLlmStatus(),
    aiReady: false,
    theme: 'blink',
    searchText: '',
    busy: false,
    onSearchText: vi.fn(),
    onRunSearch: vi.fn(),
    onAiSettings: vi.fn(),
    onRecheck: vi.fn(),
    onPersonalities: vi.fn(),
    onPluginsMenu: vi.fn(),
    onSelectPlugin: vi.fn(),
    onAdvanced: vi.fn(),
    onTheme: vi.fn(),
    ...overrides,
  }
}

describe('TopBar', () => {
  it('renders the brand and search box', () => {
    render(<TopBar {...makeProps()} />)
    expect(screen.getByText('Vault')).toBeInTheDocument()
    expect(screen.getByLabelText('Find notes')).toBeInTheDocument()
  })

  it('runs search on Enter and on the Search button', () => {
    const props = makeProps({ searchText: 'hello' })
    render(<TopBar {...props} />)
    fireEvent.keyDown(screen.getByLabelText('Find notes'), { key: 'Enter' })
    expect(props.onRunSearch).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(props.onRunSearch).toHaveBeenCalledTimes(2)
  })

  it('opens AI settings from the status chip', () => {
    const props = makeProps()
    render(<TopBar {...props} />)
    fireEvent.click(screen.getByTestId('ai-chip'))
    expect(props.onAiSettings).toHaveBeenCalled()
    expect(props.onRecheck).toHaveBeenCalled()
  })

  it('hides the Personalities button in simple mode and shows it in advanced', () => {
    const props = makeProps({ advanced: true })
    render(<TopBar {...props} />)
    fireEvent.click(screen.getByText('Personalities'))
    expect(props.onPersonalities).toHaveBeenCalled()
  })

  it('opens the plugins menu and selects a plugin', () => {
    const props = makeProps({
      pluginsMenuAnchor: document.createElement('div'),
      visiblePlugins: [{ id: 'p1', name: 'Plugin One', description: 'desc', render: () => null }],
    })
    render(<TopBar {...props} />)
    fireEvent.click(screen.getByText('Plugin One'))
    expect(props.onSelectPlugin).toHaveBeenCalledWith('p1')
  })

  it('toggles advanced and theme', () => {
    const props = makeProps({ advanced: false })
    render(<TopBar {...props} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(props.onAdvanced).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByLabelText('Toggle color theme'))
    expect(props.onTheme).toHaveBeenCalled()
  })

  it('shows a Media chat button when the media-chat plugin is available', () => {
    const props = makeProps({
      visiblePlugins: [{ id: 'media-chat', name: 'Media chat', description: 'Chat with video', render: () => null }],
    })
    render(<TopBar {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Media chat' }))
    expect(props.onSelectPlugin).toHaveBeenCalledWith('media-chat')
  })

  it('hides the Media chat button when the plugin is unavailable', () => {
    render(<TopBar {...makeProps({ visiblePlugins: [] })} />)
    expect(screen.queryByRole('button', { name: 'Media chat' })).not.toBeInTheDocument()
  })

  it('opens settings from the gear button', () => {
    const props = makeProps()
    render(<TopBar {...props} />)
    fireEvent.click(screen.getByLabelText('Settings'))
    expect(props.onAiSettings).toHaveBeenCalled()
  })
})
