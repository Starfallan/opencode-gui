<template>
  <DropdownTrigger align="center" :close-on-click-outside="true">
    <template #trigger>
      <div class="mode-dropdown" :title="currentModeConfig.label">
        <div class="dropdown-content">
          <i :class="`codicon ${currentModeConfig.icon}`" class="mode-icon" />
          <div class="dropdown-text">
            <span class="dropdown-label">{{ currentModeConfig.label }}</span>
          </div>
        </div>
        <div class="codicon codicon-chevron-up chevron-icon text-[12px]!" />
      </div>
    </template>

    <template #content="{ close }">
      <DropdownItem
        v-for="(pm, index) in primaryAgents"
        :key="pm.id"
        :item="{
          id: pm.id,
          label: pm.label,
          detail: pm.description,
          checked: effectivePrimaryAgentMode === pm.id,
          type: 'primary-agent'
        }"
        :is-selected="effectivePrimaryAgentMode === pm.id"
        :index="index"
        @click="() => handlePrimaryAgentSelect(pm.id, close)"
      >
        <template #icon>
          <i :class="`codicon ${pm.icon}`" />
        </template>
      </DropdownItem>
    </template>
  </DropdownTrigger>
</template>

<script setup lang="ts">
import { computed, watch, onMounted } from 'vue';
import { DropdownTrigger, DropdownItem } from './Dropdown';
import { useAgentManagement } from '../composables/useAgentManagement';
import { inject } from 'vue';
import { RuntimeKey } from '../composables/runtimeContext';
import type { Connection } from '../core/ConnectionManager';

export type PrimaryAgentMode = string;

export interface PrimaryAgentModeConfig {
  id: string;
  label: string;
  description: string;
  icon: string;
  color?: string;
}

const runtime = inject(RuntimeKey);

const {
  agents,
  primaryAgents: fetchedPrimaryAgents,
  isInitialized: agentsInitialized,
  getAgentModelValue
} = useAgentManagement();

const fallbackModes: PrimaryAgentModeConfig[] = [
  {
    id: 'build',
    label: 'Build',
    description: '默认助手：工具可用，适合开发执行',
    icon: 'codicon-tools'
  },
  {
    id: 'plan',
    label: 'Plan',
    description: '规划助手：偏分析与计划，少执行',
    icon: 'codicon-lightbulb'
  }
];

interface Props {
  primaryAgentMode?: PrimaryAgentMode;
  selectedAgent?: string;
}

interface Emits {
  (e: 'primary-agent-select', mode: string, modelValue?: string): void;
}

const props = withDefaults(defineProps<Props>(), {
  primaryAgentMode: undefined
});

const emit = defineEmits<Emits>();

// 当前选中的 agent：优先使用 props.selectedAgent，否则使用 primaryAgentMode
const effectivePrimaryAgentMode = computed<string>(() => {
  // 如果传入了 selectedAgent，使用它
  if (props.selectedAgent) {
    return props.selectedAgent;
  }
  return props.primaryAgentMode ?? 'build';
});

const primaryAgents = computed<PrimaryAgentModeConfig[]>(() => {
  if (fetchedPrimaryAgents.value.length > 0) {
    return fetchedPrimaryAgents.value.map((a) => ({
      id: a.id,
      label: a.label,
      description: a.description || '',
      icon: a.icon,
      color: a.color
    }));
  }
  return fallbackModes;
});

const currentModeConfig = computed(() => {
  return (
    primaryAgents.value.find((m) => m.id === effectivePrimaryAgentMode.value) ??
    primaryAgents.value[0] ??
    fallbackModes[0]
  );
});

function handlePrimaryAgentSelect(mode: string, close: () => void) {
  const conn = runtime?.connectionManager?.connection() as unknown as Connection | undefined;
  conn?.debugLog?.('debug', `=== ModeSelect START === mode=${mode}`);

  let modelValue: string | undefined;
  try {
    modelValue = getAgentModelValue(mode);
    conn?.debugLog?.(
      'debug',
      `=== modelValue=${JSON.stringify(modelValue)}, agents=${JSON.stringify(agents.value.map((a) => ({ id: a.id, name: a.name })))}`
    );
  } catch (e: any) {
    conn?.debugLog?.('error', `=== getAgentModelValue ERROR: ${e?.message || e}`);
  }

  close();
  conn?.debugLog?.(
    'debug',
    `=== EMITTING primary-agent-select mode=${mode} modelValue=${JSON.stringify(modelValue)}`
  );
  emit('primary-agent-select', mode, modelValue);
}
onMounted(async () => {
  // Debug: log initialization state
  if (runtime?.connectionManager) {
    const conn = runtime.connectionManager.connection() as unknown as Connection;
    conn.debugLog?.(
      'debug',
      `ModeSelect onMounted: agentsInitialized=${agentsInitialized.value}, hasConnection=${!!conn}`
    );
  }

  if (!runtime?.connectionManager || agentsInitialized.value) return;

  const conn = runtime.connectionManager.connection() as unknown as Connection;
  if (conn?.getSavedAgent) {
    try {
      const saved = await conn.getSavedAgent();
      conn.debugLog?.('debug', `ModeSelect getSavedAgent: ${JSON.stringify(saved)}`);
      if (saved?.agentName) {
        emit('primary-agent-select', saved.agentName, getAgentModelValue(saved.agentName));
      }
    } catch (e) {
      console.warn('[ModeSelect] Failed to load saved agent:', e);
    }
  }
});
</script>

<style scoped>
/* Mode dropdown styles - existing look */
.mode-dropdown {
  display: flex;
  gap: 4px;
  font-size: 12px;
  align-items: center;
  line-height: 24px;
  min-width: 0;
  max-width: 100%;
  padding: 2px 6px;
  border-radius: 23px;
  flex-shrink: 1;
  cursor: pointer;
  border: none;
  background: transparent;
  overflow: hidden;
  transition: background-color 0.2s ease;
}

.mode-dropdown:hover {
  background-color: var(--vscode-inputOption-hoverBackground);
}

.mode-icon {
  font-size: 12px;
  flex-shrink: 0;
  opacity: 0.8;
  color: var(--vscode-foreground);
}

.dropdown-content {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.dropdown-text {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 12px;
  display: flex;
  align-items: baseline;
  gap: 3px;
  height: 13px;
  font-weight: 400;
}

.dropdown-label {
  opacity: 0.8;
  max-width: 180px;
  overflow: hidden;
  height: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.chevron-icon {
  font-size: 9px;
  flex-shrink: 0;
  opacity: 0.5;
  color: var(--vscode-foreground);
}

.section-divider {
  height: 1px;
  margin: 6px 4px;
  background: var(--vscode-editorGroup-border);
  opacity: 0.6;
}

:deep(.dropdown-trigger-container) {
  min-width: 0;
  max-width: 100%;
}

@media (max-width: 560px) {
  .mode-dropdown {
    padding-left: 2px;
    padding-right: 2px;
  }

  .mode-dropdown .dropdown-text {
    display: none;
  }

  .mode-dropdown .chevron-icon {
    display: none;
  }
}
</style>
