import { BaseProvider } from './base';
import { LMStudioProvider } from './lmstudio';
import { OllamaProvider } from './ollama';
import { Config, Provider } from '../types';

export function createProvider(config: Config): BaseProvider {
  const provider = config.provider;
  const providerConfig = config[provider];

  switch (provider) {
    case 'lmstudio':
      return new LMStudioProvider(providerConfig);
    case 'ollama':
      return new OllamaProvider(providerConfig);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export { BaseProvider, LMStudioProvider, OllamaProvider };
