import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PersonalityPreviewDialog } from '../../src/features/PersonalityPreviewDialog'
import { lkvMock } from './lkv'

function open() {
  render(<PersonalityPreviewDialog open onClose={vi.fn()} body="Use headings" name="Structured" />)
  fireEvent.click(screen.getByRole('button', { name: 'Run preview' }))
}

describe('PersonalityPreviewDialog', () => {
  it('renders Markdown and numbered citations like chat (#238)', async () => {
    const lkv = lkvMock()
    lkv.prompts.preview.mockResolvedValue({
      answer: '## Main idea\n\n- **Habits** compound [itm_1]\n- Cues matter [itm_2]',
      citations: [
        { id: 'itm_1', title: 'Atomic habits' },
        { id: 'itm_2', title: 'Cue notes' },
      ],
    })
    open()
    expect(await screen.findByRole('heading', { name: 'Main idea' })).toBeInTheDocument()
    expect(screen.getByText('Habits').tagName).toBe('STRONG')
    expect(screen.queryByText(/##|\*\*|itm_/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Citation 2: Cue notes')).toHaveTextContent('[2]')
    expect(screen.getByText('[1] Atomic habits')).toBeInTheDocument()
    expect(screen.getByText('[2] Cue notes')).toBeInTheDocument()
  })
})
