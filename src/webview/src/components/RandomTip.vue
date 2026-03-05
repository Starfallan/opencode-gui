<template>
  <div class="empty-state-content">
    <img
      v-if="opencodeLogoSrc"
      class="empty-mascot"
      :src="opencodeLogoSrc"
      alt="OpenCode"
      draggable="false"
    />
    <OpenCodeIcon v-else class="empty-mascot" />
    <p class="empty-state-message">{{ currentTip }}</p>
    <p v-if="showStartupHint" class="startup-wait-message">
      <span class="codicon codicon-sync codicon-modifier-spin startup-wait-icon"></span>
      正在启动 OpenCode 服务，请稍候...
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, inject } from 'vue';
import { useSignal } from '@gn8/alien-signals-vue';
import OpenCodeIcon from './OpenCodeIcon.vue';
import { RuntimeKey } from '../composables/runtimeContext';

interface Props {
  platform: string;
}

const props = defineProps<Props>();

const runtime = inject(RuntimeKey);
if (!runtime) {
  throw new Error('[RandomTip] Runtime not provided');
}

const assetUris = useSignal(runtime.appContext.assetUris);
const connectionState = useSignal(runtime.connectionManager.state);
const showStartupHint = computed(() => connectionState.value !== 'connected');

const opencodeLogoSrc = computed(() => {
  const assets = assetUris.value;
  if (!assets) return '';
  const logo = assets['opencode-logo'];
  if (!logo) return '';

  const root = document.documentElement;
  const isLight =
    root.classList.contains('vscode-light') ||
    root.classList.contains('vscode-high-contrast-light');
  return isLight ? logo.light : logo.dark;
});

const tips = computed(() => {
  const platformKey = props.platform === 'windows' ? 'Alt' : 'Option';
  return [
    '从哪里开始？可以询问关于代码库的问题，或者直接开始编写代码。',
    '准备好编码了吗？\n让我们写点值得部署的东西。',
    '使用顶部的模型下拉菜单选择合适的工具。',
    '创建 AGENTS.md 文件，让 OpenCode 每次都能遵循您的项目指南。',
    '厌倦了重复自己？将指南放在 AGENTS.md 中，OpenCode 可以重复使用。',
    `选中文本并按 ${platformKey} + K 进行对话。`,
    '一个人的垃圾是另一个人的宝藏。',
    '今天是使用电脑的好日子，不是吗？',
    '您来对地方了！',
    '在设置里配置 MCP 服务器。\n终端和这里共用同一份配置。'
  ];
});

const currentTip = ref(tips.value[0]);

onMounted(() => {
  // 随机选择一条提示
  const index = Math.floor(Math.random() * tips.value.length);
  currentTip.value = tips.value[index];
});
</script>

<style scoped>
.empty-state-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 32px 16px;
}

.empty-mascot {
  width: 44px;
  height: 44px;
  object-fit: contain;
  border-radius: 10px;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-panel-border) 85%, transparent);
}

.empty-state-message {
  margin: 0;
  padding: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--vscode-descriptionForeground);
  text-align: center;
  white-space: pre-line;
  max-width: 400px;
}

.startup-wait-message {
  margin: 0;
  padding: 4px 10px;
  border: 1px solid color-mix(in srgb, var(--vscode-focusBorder) 45%, transparent);
  border-radius: 999px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--vscode-descriptionForeground);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: color-mix(in srgb, var(--vscode-editorInfo-background) 20%, transparent);
}

.startup-wait-icon {
  font-size: 11px;
  opacity: 0.8;
}
</style>
