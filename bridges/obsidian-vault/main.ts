/**
 * Obsidian community plugin scaffold — Vault Bridge client.
 *
 * Install: copy this folder to <vault>/.obsidian/plugins/vault-bridge/
 * Compile or paste as main.js for a quick trial (see README).
 * Requires the Vault desktop app running (Bridge on 127.0.0.1:8765).
 */

import { App, Notice, Plugin, PluginSettingTab, Setting, Modal, MarkdownView } from 'obsidian'

const BRIDGE_BASE = 'http://127.0.0.1:8765'

interface VaultBridgeSettings {
  bridgeBase: string
  defaultProject: string
}

const DEFAULT_SETTINGS: VaultBridgeSettings = {
  bridgeBase: BRIDGE_BASE,
  defaultProject: '',
}

export default class VaultBridgePlugin extends Plugin {
  settings: VaultBridgeSettings = DEFAULT_SETTINGS

  async onload() {
    await this.loadSettings()

    this.addCommand({
      id: 'vault-health',
      name: 'Vault health',
      callback: async () => {
        try {
          const r = await fetch(`${this.settings.bridgeBase}/health`)
          const data = (await r.json()) as { ok?: boolean; name?: string; version?: string }
          if (data.ok) {
            new Notice(`Vault Bridge OK — ${data.name ?? 'Vault'} v${data.version ?? '?'}`)
          } else {
            new Notice('Vault Bridge responded but ok=false')
          }
        } catch (e) {
          new Notice(
            `Vault Bridge unreachable. Start the Vault app first. (${e instanceof Error ? e.message : e})`
          )
        }
      },
    })

    this.addCommand({
      id: 'ask-vault',
      name: 'Ask Vault…',
      callback: () => {
        new AskVaultModal(this.app, this.settings, async (text, project) => {
          try {
            const r = await fetch(`${this.settings.bridgeBase}/v1/ask`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text,
                project: project || undefined,
              }),
            })
            const data = (await r.json()) as {
              answer?: string
              citations?: Array<{ id: string; title: string }>
              error?: string
            }
            if (!r.ok || data.error) {
              new Notice(data.error ?? `Ask failed (${r.status})`)
              return
            }
            const cites = (data.citations ?? [])
              .map((c) => `- [${c.id}] ${c.title}`)
              .join('\n')
            const block = [
              `## Vault answer`,
              '',
              data.answer ?? '(empty)',
              '',
              cites ? `### Citations\n${cites}` : '',
            ]
              .filter(Boolean)
              .join('\n')

            const view = this.app.workspace.getActiveViewOfType(MarkdownView)
            if (view) {
              const editor = view.editor
              const cursor = editor.getCursor()
              editor.replaceRange('\n' + block + '\n', cursor)
            } else {
              new Notice(data.answer?.slice(0, 200) ?? 'No answer')
            }
          } catch (e) {
            new Notice(
              `Vault Bridge unreachable. Start Vault first. (${e instanceof Error ? e.message : e})`
            )
          }
        }).open()
      },
    })

    this.addSettingTab(new VaultBridgeSettingTab(this.app, this))
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings() {
    await this.saveData(this.settings)
  }
}

class AskVaultModal extends Modal {
  text = ''
  project = ''
  onSubmit: (text: string, project: string) => void | Promise<void>

  constructor(
    app: App,
    settings: VaultBridgeSettings,
    onSubmit: (text: string, project: string) => void | Promise<void>
  ) {
    super(app)
    this.project = settings.defaultProject
    this.onSubmit = onSubmit
  }

  onOpen() {
    const { contentEl } = this
    contentEl.empty()
    contentEl.createEl('h2', { text: 'Ask Vault' })

    contentEl.createEl('label', { text: 'Question' })
    const ta = contentEl.createEl('textarea')
    ta.rows = 4
    ta.style.width = '100%'
    ta.addEventListener('input', () => {
      this.text = ta.value
    })

    contentEl.createEl('label', { text: 'Project (optional)' })
    const inp = contentEl.createEl('input')
    inp.type = 'text'
    inp.value = this.project
    inp.style.width = '100%'
    inp.addEventListener('input', () => {
      this.project = inp.value
    })

    const btn = contentEl.createEl('button', { text: 'Ask' })
    btn.style.marginTop = '12px'
    btn.addEventListener('click', () => {
      void this.onSubmit(this.text.trim(), this.project.trim())
      this.close()
    })
  }

  onClose() {
    this.contentEl.empty()
  }
}

class VaultBridgeSettingTab extends PluginSettingTab {
  plugin: VaultBridgePlugin

  constructor(app: App, plugin: VaultBridgePlugin) {
    super(app, plugin)
    this.plugin = plugin
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()
    containerEl.createEl('h2', { text: 'Vault Bridge' })

    new Setting(containerEl)
      .setName('Bridge base URL')
      .setDesc('Default http://127.0.0.1:8765 (loopback only)')
      .addText((text) =>
        text.setValue(this.plugin.settings.bridgeBase).onChange(async (v) => {
          this.plugin.settings.bridgeBase = v.trim() || BRIDGE_BASE
          await this.plugin.saveSettings()
        })
      )

    new Setting(containerEl)
      .setName('Default project')
      .setDesc('Optional vault/media project scope for Ask Vault')
      .addText((text) =>
        text.setValue(this.plugin.settings.defaultProject).onChange(async (v) => {
          this.plugin.settings.defaultProject = v.trim()
          await this.plugin.saveSettings()
        })
      )
  }
}
