/**
 * describeCredentialSideEffects() contract for every provider's setup steps.
 *
 * A dry-run setup must be able to preview a provider's credential/sign-in
 * effects without executing any of them. These tests dynamic-import each
 * setup-steps module after their auth/credential helpers are replaced with
 * spies, then assert the describe output names the real entry points and that
 * no spy was ever called.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlannedAction } from '@/types/dry-run.js';
import type { ProviderSetupSteps } from '../types.js';

const {
  mockAuthenticateWithCodeMie,
  mockRunClaudeBrowserLogin,
  mockExec,
  mockPrompt,
} = vi.hoisted(() => ({
  mockAuthenticateWithCodeMie: vi.fn(),
  mockRunClaudeBrowserLogin: vi.fn(),
  mockExec: vi.fn(),
  mockPrompt: vi.fn(),
}));

vi.mock('../codemie-auth-helpers.js', () => ({
  DEFAULT_CODEMIE_BASE_URL: 'https://codemie.example.com',
  authenticateWithCodeMie: mockAuthenticateWithCodeMie,
  promptForCodeMieUrl: vi.fn(),
  selectCodeMieProject: vi.fn(),
  getPlatformUrl: vi.fn(),
  getStoredPlatformCredentials: vi.fn(),
  ensureApiBase: vi.fn(),
}));

vi.mock('../../plugins/anthropic-subscription/anthropic-subscription.auth.js', () => ({
  ensureClaudeCliAvailable: vi.fn(),
  getClaudeAuthStatus: vi.fn(),
  runClaudeBrowserLogin: mockRunClaudeBrowserLogin,
  parseClaudeAuthStatus: vi.fn(),
}));

vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    exec: mockExec,
  };
});

vi.mock('inquirer', () => ({
  default: { prompt: mockPrompt },
}));

/** Flatten an action into the text a reviewer would read in the preview. */
function actionText(action: PlannedAction): string {
  return `${action.kind} ${action.label} ${action.targets.join(' ')}`;
}

function allText(actions: PlannedAction[]): string {
  return actions.map(actionText).join('\n');
}

function findMentioning(actions: PlannedAction[], needle: string): PlannedAction | undefined {
  return actions.find(action => actionText(action).includes(needle));
}

/**
 * Calls the seam through the interface type, so a missing member is a compile
 * error as well as a runtime TypeError.
 */
function describeSideEffects(setupSteps: ProviderSetupSteps): PlannedAction[] {
  return setupSteps.describeCredentialSideEffects();
}

async function importSetupSteps(): Promise<Record<string, ProviderSetupSteps>> {
  const [
    { SSOSetupSteps },
    { JWTBearerSetupSteps },
    { LiteLLMSetupSteps },
    { BedrockSetupSteps },
    { OllamaSetupSteps },
    { AnthropicSubscriptionSetupSteps },
    { MoonshotSubscriptionSetupSteps },
  ] = await Promise.all([
    import('../../plugins/sso/sso.setup-steps.js'),
    import('../../plugins/jwt/jwt.setup-steps.js'),
    import('../../plugins/litellm/litellm.setup-steps.js'),
    import('../../plugins/bedrock/bedrock.setup-steps.js'),
    import('../../plugins/ollama/ollama.setup-steps.js'),
    import('../../plugins/anthropic-subscription/anthropic-subscription.setup-steps.js'),
    import('../../plugins/moonshot-subscription/moonshot-subscription.setup-steps.js'),
  ]);

  return {
    sso: SSOSetupSteps,
    jwt: JWTBearerSetupSteps,
    litellm: LiteLLMSetupSteps,
    bedrock: BedrockSetupSteps,
    ollama: OllamaSetupSteps,
    'anthropic-subscription': AnthropicSubscriptionSetupSteps,
    'moonshot-subscription': MoonshotSubscriptionSetupSteps,
  };
}

describe('ProviderSetupSteps.describeCredentialSideEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('anthropic-subscription names both its Claude native login and CodeMie analytics sign-in', async () => {
    const { AnthropicSubscriptionSetupSteps } = await import(
      '../../plugins/anthropic-subscription/anthropic-subscription.setup-steps.js'
    );

    const actions = describeSideEffects(AnthropicSubscriptionSetupSteps);
    const text = allText(actions);

    expect(text).toContain('runClaudeBrowserLogin');
    expect(text).toContain('authenticateWithCodeMie');

    const claudeLogin = findMentioning(actions, 'runClaudeBrowserLogin');
    expect(claudeLogin?.kind).toBe('exec');

    const codeMieLogin = findMentioning(actions, 'authenticateWithCodeMie');
    expect(codeMieLogin?.kind).toBe('network');
  });

  it('moonshot-subscription lists the optional CodeMie analytics sign-in', async () => {
    const { MoonshotSubscriptionSetupSteps } = await import(
      '../../plugins/moonshot-subscription/moonshot-subscription.setup-steps.js'
    );

    expect(allText(describeSideEffects(MoonshotSubscriptionSetupSteps))).toContain(
      'authenticateWithCodeMie'
    );
  });

  it('bedrock lists createAwsProfile with the ~/.aws target', async () => {
    const { BedrockSetupSteps } = await import(
      '../../plugins/bedrock/bedrock.setup-steps.js'
    );

    const actions = describeSideEffects(BedrockSetupSteps);
    const awsProfile = findMentioning(actions, 'createAwsProfile');

    expect(awsProfile).toBeDefined();
    expect(awsProfile?.targets.some(target => target.includes('~/.aws'))).toBe(true);
  });

  it('sso lists the browser authenticateWithCodeMie sign-in', async () => {
    const { SSOSetupSteps } = await import('../../plugins/sso/sso.setup-steps.js');

    expect(allText(describeSideEffects(SSOSetupSteps))).toContain('authenticateWithCodeMie');
  });

  it('describes every provider without ever calling an auth or credential helper', async () => {
    const allSetupSteps = await importSetupSteps();
    const providers = Object.entries(allSetupSteps);

    expect(providers).toHaveLength(7);

    for (const [, setupSteps] of providers) {
      const actions = describeSideEffects(setupSteps);

      expect(Array.isArray(actions)).toBe(true);
      for (const action of actions) {
        expect(action.label.length).toBeGreaterThan(0);
        expect(action.targets.length).toBeGreaterThan(0);
      }
    }

    expect(mockAuthenticateWithCodeMie).not.toHaveBeenCalled();
    expect(mockRunClaudeBrowserLogin).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockPrompt).not.toHaveBeenCalled();
  });
});
