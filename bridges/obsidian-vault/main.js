/**
 * Minimal Obsidian plugin (no build) — Vault Bridge client.
 * Copy folder to <vault>/.obsidian/plugins/vault-bridge/ and enable in Community plugins.
 * Requires Vault app running (http://127.0.0.1:8765).
 */
const { Plugin, Notice, Modal, MarkdownView, PluginSettingTab, Setting } = require('obsidian')

const BRIDGE_BASE = 'http://127.0.0.1:8765'
const DEFAULT_SETTINGS = { bridgeBase: BRIDGE_BASE, defaultProject: '' }

class AskVaultModal extends Modal {
  constructor(app, settings, onSubmit) {
    super(app)
    this.project = settings.defaultProject || ''
    this.text = ''
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
    ta.addEventListener('input', () => { this.text = ta.value })
    contentEl.createEl('label', { text: 'Project (optional)' })
    const inp = contentEl.createEl('input')
    inp.type = 'text'
    inp.value = this.project
    inp.style.width = '100%'
    inp.addEventListener('input', () => { this.project = inp.value })
    const btn = contentEl.createEl('button', { text: 'Ask' })
    btn.style.marginTop = '12px'
    btn.addEventListener('click', () => {
      void this.onSubmit(this.text.trim(), this.project.trim())
      this.close()
    })
  }
  onClose() { this.contentEl.empty() }
}

class VaultBridgeSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin)
    this.plugin = plugin
  }
  display() {
    const { containerEl } = this
    containerEl.empty()
    containerEl.createEl('h2', { text: 'Vault Bridge' })
    new Setting(containerEl)
      .setName('Bridge base URL')
      .setDesc('Default http://127.0.0.1:8765')
      .addText((text) =>
        text.setValue(this.plugin.settings.bridgeBase).onChange(async (v) => {
          this.plugin.settings.bridgeBase = v.trim() || BRIDGE_BASE
          await this.plugin.saveSettings()
        })
      )
    new Setting(containerEl)
      .setName('Default project')
      .addText((text) =>
        text.setValue(this.plugin.settings.defaultProject).onChange(async (v) => {
          this.plugin.settings.defaultProject = v.trim()
          await this.plugin.saveSettings()
        })
      )
  }
}

module.exports = class VaultBridgePlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
    this.addCommand({
      id: 'vault-health',
      name: 'Vault health',
      callback: async () => {
        try {
          const r = await fetch(`${this.settings.bridgeBase}/health`)
          const data = await r.json()
          new Notice(data.ok ? `Vault Bridge OK — ${data.name} v${data.version}` : 'ok=false')
        } catch (e) {
          new Notice(`Vault Bridge unreachable. Start Vault first. (${e.message || e})`)
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
              body: JSON.stringify({ text, project: project || undefined }),
            })
            const data = await r.json()
            if (!r.ok || data.error) {
              new Notice(data.error || `Ask failed (${r.status})`)
              return
            }
            const cites = (data.citations || []).map((c) => `- [${c.id}] ${c.title}`).join('\n')
            const block = `## Vault answer\n\n${data.answer || '(empty)'}\n` + (cites ? `\n### Citations\n${cites}\n` : '')
            const view = this.app.workspace.getActiveViewOfType(MarkdownView)
            if (view) {
              const editor = view.editor
              editor.replaceRange('\n' + block + '\n', editor.getCursor())
            } else {
              new Notice((data.answer || '').slice(0, 200))
            }
          } catch (e) {
            new Notice(`Vault Bridge unreachable. Start Vault first. (${e.message || e})`)
          }
        }).open()
      },
    })
    this.addSettingTab(new VaultBridgeSettingTab(this.app, this))
  }
  async saveSettings() { await this.saveData(this.settings) }
}
