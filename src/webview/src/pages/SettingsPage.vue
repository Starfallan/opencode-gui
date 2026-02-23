<template>
  <div class="settings-page">
    <div class="settings-header">
      <div class="header-left">
        <button class="back-btn" title="返回" @click="$emit('close')">
          <span class="codicon codicon-arrow-left"></span>
        </button>
        <h2 class="settings-title">设置</h2>
      </div>
      <div class="header-right">
        <button class="apply-btn" :disabled="isApplying" @click="applyConfigNow">
          <span
            class="codicon"
            :class="isApplying ? 'codicon-loading codicon-modifier-spin' : 'codicon-sync'"
          ></span>
          <span>{{ isApplying ? '生效中...' : '应用并刷新模型' }}</span>
        </button>
      </div>
    </div>

    <div v-if="applyMessage" :class="['apply-banner', applyError ? 'is-error' : 'is-ok']">
      {{ applyMessage }}
    </div>

    <div class="settings-content">
      <nav class="settings-nav-container">
        <div class="settings-nav">
          <button
            v-for="section in sections"
            :key="section.id"
            :class="['nav-item', { active: currentSection === section.id }]"
            :title="section.label"
            @click="currentSection = section.id"
          >
            <span :class="`codicon codicon-${section.icon}`"></span>
            <span class="nav-label">{{ section.label }}</span>
            <span v-if="section.needsRestart" class="badge-restart" title="需要重启会话">!</span>
          </button>
        </div>
      </nav>

      <div class="settings-panel">
        <div class="panel-container">
          <OpenCodeFilesSettings v-if="currentSection === 'opencodeFiles'" />
          <OhMySettings v-else-if="currentSection === 'ohMy'" />
          <ProvidersSettings v-else-if="currentSection === 'providers'" />
          <McpServersSettings v-else-if="currentSection === 'mcp'" />
          <AgentsSettings v-else-if="currentSection === 'agents'" />
          <SkillsSettings v-else-if="currentSection === 'skills'" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject, onUnmounted, ref } from 'vue';
import McpServersSettings from '../components/Settings/McpServersSettings.vue';
import OpenCodeFilesSettings from '../components/Settings/OpenCodeFilesSettings.vue';
import OhMySettings from '../components/Settings/OhMySettings.vue';
import ProvidersSettings from '../components/Settings/ProvidersSettings.vue';
import AgentsSettings from '../components/Settings/AgentsSettings.vue';
import SkillsSettings from '../components/Settings/SkillsSettings.vue';
import { RuntimeKey } from '../composables/runtimeContext';

interface SettingsSection {
  id: string;
  label: string;
  icon: string;
  needsRestart?: boolean;
}

defineEmits<{
  close: [];
}>();

const currentSection = ref('opencodeFiles');
const runtime = inject(RuntimeKey);
if (!runtime) {
  throw new Error('[SettingsPage] Runtime not provided');
}

const isApplying = ref(false);
const applyMessage = ref('');
const applyError = ref(false);
let applyMessageTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleClearApplyMessage() {
  if (applyMessageTimer) clearTimeout(applyMessageTimer);
  applyMessageTimer = setTimeout(() => {
    applyMessage.value = '';
  }, 5000);
}

async function applyConfigNow(): Promise<void> {
  if (isApplying.value) return;

  isApplying.value = true;
  applyError.value = false;
  applyMessage.value = '';

  try {
    const connection = await runtime!.connectionManager.get();
    const resp = await connection.applyOpencodeConfig(true);
    if (resp?.type !== 'apply_opencode_config_response') {
      throw new Error(`Unexpected response: ${String(resp?.type ?? resp)}`);
    }
    if (!resp.success) {
      throw new Error(String(resp.error ?? '应用失败'));
    }

    const url = typeof resp.baseUrl === 'string' && resp.baseUrl ? ` (${resp.baseUrl})` : '';
    applyMessage.value = `配置已生效${url}`;
    scheduleClearApplyMessage();
  } catch (error) {
    applyError.value = true;
    applyMessage.value = error instanceof Error ? error.message : String(error);
    scheduleClearApplyMessage();
  } finally {
    isApplying.value = false;
  }
}

onUnmounted(() => {
  if (applyMessageTimer) clearTimeout(applyMessageTimer);
});

const sections: SettingsSection[] = [
  {
    id: 'opencodeFiles',
    label: 'OpenCode 配置',
    icon: 'json'
  },
  {
    id: 'ohMy',
    label: 'oh-my-opencode',
    icon: 'settings-gear'
  },
  {
    id: 'providers',
    label: 'Providers',
    icon: 'cloud'
  },
  {
    id: 'mcp',
    label: 'MCP服务器',
    icon: 'server',
    needsRestart: true
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: 'robot'
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: 'extensions'
  }
];
</script>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--vscode-foreground);
  cursor: pointer;
  transition: background-color 0.15s;
}

.back-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
}

.settings-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.apply-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.apply-btn:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

.apply-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.apply-banner {
  margin: 8px 16px 0 16px;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--vscode-panel-border);
  font-size: 12px;
}

.apply-banner.is-ok {
  color: var(--vscode-testing-iconPassed, #73c991);
  background: color-mix(in srgb, var(--vscode-testing-iconPassed, #73c991) 12%, transparent);
}

.apply-banner.is-error {
  color: var(--vscode-errorForeground);
  background: color-mix(in srgb, var(--vscode-errorForeground) 10%, transparent);
}

.settings-content {
  display: flex;
  flex: 1;
  overflow: hidden;
  container-type: inline-size;
}

.settings-nav-container {
  flex-shrink: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.settings-nav {
  width: 200px;
  padding: 12px 8px;
  border-right: 1px solid var(--vscode-panel-border);
  overflow-y: auto;
  transition: width 0.2s ease;
  flex: 1;
  display: flex;
  flex-direction: column;
}

@container (max-width: 500px) {
  .settings-nav {
    width: 44px;
    padding: 8px 4px;
  }

  .nav-item {
    justify-content: center;
    padding: 8px 0;
  }

  .nav-label {
    display: none;
  }

  .badge-restart {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 10px;
    height: 10px;
    font-size: 8px;
  }
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  margin-bottom: 2px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--vscode-foreground);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s;
  position: relative;
}

.nav-item:hover {
  background: var(--vscode-list-hoverBackground);
}

.nav-item.active {
  background: var(--vscode-list-activeSelectionBackground);
  color: var(--vscode-list-activeSelectionForeground);
}

.nav-label {
  flex: 1;
}

.badge-restart {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--vscode-editorWarning-foreground, var(--vscode-charts-orange));
  color: var(--vscode-badge-foreground, var(--vscode-button-foreground));
  font-size: 10px;
  font-weight: bold;
}

.settings-panel {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px 24px;
}

.panel-container {
  max-width: 800px;
  margin: 0 auto;
  min-height: 100%;
}
</style>
