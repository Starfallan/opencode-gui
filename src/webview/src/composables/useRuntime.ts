import { onMounted, onUnmounted, watch } from 'vue';
import { signal, effect } from 'alien-signals';
import { EventEmitter } from '../utils/events';
import { ConnectionManager } from '../core/ConnectionManager';
import { VSCodeTransport } from '../transport/VSCodeTransport';
import { AppContext } from '../core/AppContext';
import { SessionStore } from '../core/SessionStore';
import { useModelManagement } from './useModelManagement';
import { useAgentManagement } from './useAgentManagement';
import type { SelectionRange } from '../core/Session';

export interface RuntimeInstance {
  connectionManager: ConnectionManager;
  appContext: AppContext;
  sessionStore: SessionStore;
  atMentionEvents: EventEmitter<string>;
  selectionEvents: EventEmitter<any>;
}

export function useRuntime(): RuntimeInstance {
  const atMentionEvents = new EventEmitter<string>();
  const selectionEvents = new EventEmitter<any>();

  const connectionManager = new ConnectionManager(
    () => new VSCodeTransport(atMentionEvents, selectionEvents)
  );
  const appContext = new AppContext(connectionManager);

  // 创建 alien-signal 用于 SessionContext
  // AppContext.currentSelection 是 Vue Ref，但 SessionContext 需要 alien-signal
  const currentSelectionSignal = signal<SelectionRange | undefined>(undefined);

  // 双向同步 Vue Ref ↔ Alien Signal
  // Vue Ref → Alien Signal
  watch(
    () => appContext.currentSelection(),
    (newValue) => {
      currentSelectionSignal(newValue);
    },
    { immediate: true }
  );

  const sessionStore = new SessionStore(connectionManager, {
    commandRegistry: appContext.commandRegistry,
    currentSelection: currentSelectionSignal,
    fileOpener: appContext.fileOpener,
    showNotification: appContext.showNotification?.bind(appContext),
    startNewConversationTab: appContext.startNewConversationTab?.bind(appContext),
    renameTab: appContext.renameTab?.bind(appContext),
    openURL: appContext.openURL.bind(appContext)
  });

  selectionEvents.add((selection) => {
    appContext.currentSelection(selection);
  });

  // SessionStore 内部的 effect 会自动监听 connection 建立并拉取会话列表

  // 监听 claudeConfig 变化并注册 Slash Commands
  let slashCommandDisposers: Array<() => void> = [];

  // 初始化模型管理
  const { initFromBackend: initModelsFromBackend } = useModelManagement();
  const { initFromBackend: initAgentsFromBackend } = useAgentManagement();

  // 初始化 agents 列表（从后端 /agent 接口获取）
  const initAgents = async () => {
    const conn = connectionManager.connection();
    if (!conn) return;

    try {
      const response = await conn.getAgents();
      console.log('[Runtime] getAgents raw response:', JSON.stringify(response));
      if (response?.agents && Array.isArray(response.agents)) {
        const agentInfos = response.agents.map((a: any) => ({
          id: a.name, // 使用 name 作为 id
          name: a.name,
          description: a.description,
          mode:
            a.category?.toLowerCase() === 'primary' || a.category?.toLowerCase() === 'all'
              ? 'primary'
              : 'subagent',
          model: a.model 
            ? (typeof a.model === 'string' 
                ? { providerID: '', modelID: a.model }
                : { providerID: a.model.providerID || '', modelID: a.model.modelID || '' })
            : undefined,
          hidden: a.hidden === true
        }));
        console.log('[Runtime] agentInfos:', JSON.stringify(agentInfos.slice(0, 2)));
        initAgentsFromBackend(agentInfos);
        console.log('[Runtime] Initialized agents:', agentInfos.length);
      }
    } catch (e) {
      console.warn('[Runtime] Failed to get agents:', e);
    }
  };

  const cleanupSlashCommands = effect(() => {
    const connection = connectionManager.connection();
    const claudeConfig = connection?.claudeConfig();

    // 清理旧的 Slash Commands
    slashCommandDisposers.forEach((dispose) => dispose());
    slashCommandDisposers = [];

    // 初始化模型列表（从后端获取）
    if (claudeConfig?.models && Array.isArray(claudeConfig.models)) {
      initModelsFromBackend(claudeConfig.models);
    }

    // 注册新的 Slash Commands
    if (claudeConfig?.slashCommands && Array.isArray(claudeConfig.slashCommands)) {
      slashCommandDisposers = claudeConfig.slashCommands
        .filter((cmd: any) => typeof cmd?.name === 'string' && cmd.name)
        .map((cmd: any) => {
          return appContext.commandRegistry.registerAction(
            {
              id: `slash-command-${cmd.name}`,
              label: `/${cmd.name}`,
              description: typeof cmd?.description === 'string' ? cmd.description : undefined
            },
            'Slash Commands',
            () => {
              console.log('[Runtime] Execute slash command:', cmd.name);
              const activeSession = sessionStore.activeSession();
              if (activeSession) {
                void activeSession.send(`/${cmd.name}`, [], false);
              } else {
                console.warn('[Runtime] No active session to execute slash command');
              }
            }
          );
        });

      console.log('[Runtime] Registered', slashCommandDisposers.length, 'slash commands');
    }
  });

  onMounted(() => {
    let disposed = false;

    (async () => {
      const connection = await connectionManager.get();
      try {
        await connection.opened;
      } catch (e) {
        console.error('[runtime] open failed', e);
        return;
      }

      if (disposed) return;

      // 初始化 agents 列表
      initAgents();

      try {
        const selection = await connection.getCurrentSelection();
        if (!disposed) appContext.currentSelection(selection?.selection ?? undefined);
      } catch (e) {
        console.warn('[runtime] selection fetch failed', e);
      }

      try {
        const assets = await connection.getAssetUris();
        if (!disposed) appContext.assetUris(assets.assetUris);
      } catch (e) {
        console.warn('[runtime] assets fetch failed', e);
      }

      // 获取所有会话列表
      await sessionStore.listSessions();

      // 尝试恢复保存的 session
      if (!disposed && !sessionStore.activeSession()) {
        try {
          const savedSession = await connection.getSavedSession();
          const savedSessionId = savedSession?.sessionId;

          if (savedSessionId) {
            console.log('[runtime] Found saved session ID:', savedSessionId);
            // 尝试打开保存的 session
            const sessions = sessionStore.sessions();
            const existingSession = sessions.find((s) => s.sessionId() === savedSessionId);

            if (existingSession) {
              console.log('[runtime] Restoring existing session:', savedSessionId);
              sessionStore.setActiveSession(existingSession);
            } else {
              // session 不存在，尝试通过 ID 打开
              console.log('[runtime] Opening session by ID:', savedSessionId);
              await sessionStore.openSessionById(savedSessionId);
            }
          }
        } catch (e) {
          console.warn('[runtime] Failed to restore session:', e);
        }
      }

      // 如果仍然没有活跃 session，创建一个新的
      if (!disposed && !sessionStore.activeSession()) {
        console.log('[runtime] Creating new session');
        await sessionStore.createSession({ isExplicit: false });
      }

      // 监听 activeSession 变化，保存 session ID
      const cleanupSessionWatch = effect(() => {
        const activeSession = sessionStore.activeSession();
        const sessionId = activeSession?.sessionId();
        if (sessionId) {
          // 保存到 workspaceState
          connection.saveActiveSession(sessionId).catch((e) => {
            console.warn('[runtime] Failed to save session ID:', e);
          });
        }
      });

      // 保存 cleanup 函数
      const originalOnUnmounted = onUnmounted;
      originalOnUnmounted(() => {
        cleanupSessionWatch();
      });
    })();

    onUnmounted(() => {
      disposed = true;

      // 清理命令注册
      slashCommandDisposers.forEach((dispose) => dispose());
      cleanupSlashCommands();

      connectionManager.close();
    });
  });

  return { connectionManager, appContext, sessionStore, atMentionEvents, selectionEvents };
}
