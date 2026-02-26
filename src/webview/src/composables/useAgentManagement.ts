import { ref, computed } from 'vue';

export interface AgentModel {
  providerID: string;
  modelID: string;
}

export interface AgentInfo {
  name: string;
  description?: string;
  mode: 'primary' | 'subagent' | 'all';
  model?: AgentModel;
  native?: boolean;
  hidden?: boolean;
  color?: string;
}

export interface AgentOption {
  id: string;
  name: string;
  label: string;
  description?: string;
  icon: string;
  model?: AgentModel;
  color?: string;
}

const agents = ref<AgentInfo[]>([]);
const isInitialized = ref(false);

const DEFAULT_AGENT_ICON = 'codicon-hubot';
const AGENT_ICONS: Record<string, string> = {
  build: 'codicon-tools',
  plan: 'codicon-lightbulb',
  sisyphus: 'codicon-rocket',
  prometheus: 'codicon-notebook',
  atlas: 'codicon-organization',
  oracle: 'codicon-comment-discussion',
  explore: 'codicon-search',
  librarian: 'codicon-book',
  general: 'codicon-globe'
};

function getAgentIcon(agentName: string): string {
  const lowerName = agentName.toLowerCase();
  for (const [key, icon] of Object.entries(AGENT_ICONS)) {
    if (lowerName.includes(key)) {
      return icon;
    }
  }
  return DEFAULT_AGENT_ICON;
}

function agentInfoToOption(info: AgentInfo): AgentOption {
  return {
    id: info.name,
    name: info.name,
    label: info.name,
    description: info.description,
    icon: getAgentIcon(info.name),
    model: info.model,
    color: info.color
  };
}

export function useAgentManagement() {
  const primaryAgents = computed(() => {
    return agents.value
      .filter((a) => (a.mode === 'primary' || a.mode === 'all') && !a.hidden)
      .map(agentInfoToOption);
  });

  const allAgents = computed(() => {
    return agents.value.map(agentInfoToOption);
  });

  const initFromBackend = (backendAgents: AgentInfo[]) => {
    if (!backendAgents || backendAgents.length === 0) {
      console.log('[AgentManagement] No agents from backend');
      return;
    }

    console.log('[AgentManagement] Initializing agents:', backendAgents.length);
    agents.value = backendAgents;
    isInitialized.value = true;
  };

  const getAgentByName = (name: string): AgentOption | undefined => {
    const agent = agents.value.find((a) => a.name === name);
    return agent ? agentInfoToOption(agent) : undefined;
  };

  const getAgentModelValue = (agentName: string): string | undefined => {
    // 优先用 ID 匹配，其次用 name 匹配
    let agent = agents.value.find((a) => a.id === agentName);
    if (!agent) {
      agent = agents.value.find((a) => a.name === agentName);
    }
    
    console.log('[AgentManagement] getAgentModelValue:', agentName, 'found agent:', JSON.stringify(agent));
    
    if (agent?.model && agent.model.providerID && agent.model.modelID) {
      const modelId = `${agent.model.providerID}/${agent.model.modelID}`;
      console.log('[AgentManagement] Returning modelId:', modelId);
      return modelId;
    }
    
    console.log('[AgentManagement] No model found for agent, returning undefined');
    return undefined;
  };

  return {
    agents,
    primaryAgents,
    allAgents,
    isInitialized: computed(() => isInitialized.value),
    initFromBackend,
    getAgentByName,
    getAgentModelValue
  };
}
