/**
 * LiteLLM Setup Steps
 *
 * Interactive setup flow for LiteLLM provider.
 */

import type { ProviderSetupSteps, ProviderCredentials } from '../../core/types.js';
import type { PlannedAction } from '@/types/dry-run.js';
import { LiteLLMTemplate } from './litellm.template.js';
import inquirer from 'inquirer';

export const LiteLLMSetupSteps: ProviderSetupSteps = {
  name: 'litellm',

  async getCredentials(_isUpdate = false): Promise<ProviderCredentials> {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'baseUrl',
        message: 'LiteLLM Proxy URL:',
        default: LiteLLMTemplate.defaultBaseUrl,
        validate: (input: string) => input.trim() !== '' || 'Base URL is required'
      },
      {
        type: 'password',
        name: 'apiKey',
        message: 'API Key (optional, leave empty if not required):',
        mask: '*'
      }
    ]);

    return {
      baseUrl: answers.baseUrl.trim(),
      apiKey: answers.apiKey?.trim() || 'not-required'
    };
  },

  /**
   * Describe the LiteLLM setup's credential effects without performing any of
   * them (no proxy request, no config write).
   */
  describeCredentialSideEffects(): PlannedAction[] {
    return [
      {
        kind: 'store-credential',
        label:
          'Store the LiteLLM proxy API key in the profile config (the "not-required" placeholder when no key is supplied)',
        targets: ['apiKey']
      },
      {
        kind: 'write-file',
        label:
          'Write the LiteLLM proxy base URL and selected model into the profile config',
        targets: ['~/.codemie/codemie-cli.config.json', LiteLLMTemplate.defaultBaseUrl]
      }
    ];
  },

  async fetchModels(credentials: ProviderCredentials): Promise<string[]> {
    const { LiteLLMModelProxy } = await import('./litellm.models.js');

    const modelProxy = new LiteLLMModelProxy(
      credentials.baseUrl || LiteLLMTemplate.defaultBaseUrl,
      credentials.apiKey
    );

    try {
      const models = await modelProxy.listModels();
      return models.map(m => m.id);
    } catch {
      // If fetch fails, return empty so setup prompts the user to enter a
      // model manually instead of showing a static, possibly stale list.
      return [];
    }
  },

  buildConfig(credentials: ProviderCredentials, selectedModel: string) {
    return {
      provider: 'litellm',
      baseUrl: credentials.baseUrl,
      apiKey: credentials.apiKey,
      model: selectedModel
    };
  }
};
