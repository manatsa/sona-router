import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { Config, Provider } from './types';

const CONFIG_FILENAME = 'sona-router.config.yaml';

export const DEFAULT_CONFIG: Config = {
  provider: 'lmstudio',
  port: 9001,
  lmstudio: {
    baseUrl: 'http://localhost:1234/v1',
    model: 'qwen2.5-coder-32b-instruct',
    modelRouting: {
      // Claude 4 models - complex reasoning, agentic tasks
      'claude-opus-4': 'qwen2.5-coder-32b-instruct',
      'claude-sonnet-4': 'qwen2.5-coder-32b-instruct',
      // Claude 3.5 models - coding focused
      'claude-3-5-sonnet': 'deepseek-coder-v2-lite-instruct',
      'claude-3-5-haiku': 'qwen2.5-coder-7b-instruct',
      // Claude 3 models
      'claude-3-opus': 'qwen2.5-coder-32b-instruct',
      'claude-3-sonnet': 'deepseek-coder-v2-lite-instruct',
      'claude-3-haiku': 'qwen2.5-coder-7b-instruct',
    },
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:32b',
    modelRouting: {
      // Claude 4 models - need largest models for complex reasoning
      'claude-opus-4': 'qwen2.5:72b',
      'claude-sonnet-4': 'qwen2.5:32b',
      // Claude 3.5 models - coding focused
      'claude-3-5-sonnet': 'deepseek-coder:33b',
      'claude-3-5-haiku': 'qwen2.5:7b',
      // Claude 3 models
      'claude-3-opus': 'llama3:70b',
      'claude-3-sonnet': 'qwen2.5:14b',
      'claude-3-haiku': 'phi3:mini',
    },
  },
};

function getConfigPath(): string {
  return path.join(process.cwd(), CONFIG_FILENAME);
}

export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

export function loadConfig(): Config {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = yaml.parse(content) as Partial<Config>;

    return {
      provider: parsed.provider || DEFAULT_CONFIG.provider,
      port: parsed.port || DEFAULT_CONFIG.port,
      lmstudio: {
        ...DEFAULT_CONFIG.lmstudio,
        ...parsed.lmstudio,
      },
      ollama: {
        ...DEFAULT_CONFIG.ollama,
        ...parsed.ollama,
      },
    };
  } catch (error) {
    console.error('Error loading config:', error);
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: Config): void {
  const configPath = getConfigPath();
  const content = yaml.stringify(config);
  fs.writeFileSync(configPath, content, 'utf-8');
}

export function initConfig(): void {
  if (configExists()) {
    throw new Error(`Config file already exists at ${getConfigPath()}`);
  }
  saveConfig(DEFAULT_CONFIG);
}

export function setProvider(provider: Provider): Config {
  const config = loadConfig();
  config.provider = provider;
  saveConfig(config);
  return config;
}

export function setPort(port: number): Config {
  const config = loadConfig();
  config.port = port;
  saveConfig(config);
  return config;
}

export function setProviderUrl(provider: Provider, url: string): Config {
  const config = loadConfig();
  config[provider].baseUrl = url;
  saveConfig(config);
  return config;
}

export function setProviderModel(provider: Provider, model: string): Config {
  const config = loadConfig();
  config[provider].model = model;
  saveConfig(config);
  return config;
}

export function setModelRouting(
  provider: Provider,
  claudeModel: string,
  localModel: string
): Config {
  const config = loadConfig();
  if (!config[provider].modelRouting) {
    config[provider].modelRouting = {};
  }
  config[provider].modelRouting[claudeModel] = localModel;
  saveConfig(config);
  return config;
}

export function resolveModel(config: Config, requestedModel: string): string {
  const providerConfig = config[config.provider];
  const routing = providerConfig.modelRouting || {};

  // Try exact match first
  if (routing[requestedModel]) {
    return routing[requestedModel];
  }

  // Try prefix match (e.g., "claude-3-opus-20240229" matches "claude-3-opus")
  for (const [pattern, localModel] of Object.entries(routing)) {
    if (requestedModel.startsWith(pattern)) {
      return localModel;
    }
  }

  // Fall back to default model
  return providerConfig.model;
}
