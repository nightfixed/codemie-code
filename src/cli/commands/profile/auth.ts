import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { CodeMieSSO } from '../../../providers/plugins/sso/sso.auth.js';
import { ConfigLoader } from '../../../utils/config.js';
import { ProviderRegistry } from '../../../providers/core/registry.js';
import { logger } from '../../../utils/logger.js';
import {
  getPlatformUrl,
  getStoredPlatformCredentials
} from '../../../providers/core/codemie-auth-helpers.js';
import { printEndCap, printPlannedActions, type PlannedAction } from '../shared/dry-run.js';

/**
 * Prints an auth dry-run plan and stops before any credential or network
 * side effect. Callers return immediately after this.
 */
function printAuthPlan(actions: PlannedAction[]): void {
  printPlannedActions(actions);
  printEndCap();
  process.exitCode = 0;
}

// Export individual commands for profile (not nested under 'auth')
export function createLoginCommand(): Command {
  const command = new Command('login');
  command
    .description('Authenticate with AI/Run CodeMie SSO')
    .option('--url <url>', 'AI/Run CodeMie URL to authenticate with')
    .action(async (options: { url?: string; dryRun?: boolean }) => {
      try {
        if (options.dryRun) {
          await previewLogin(options.url);
          return;
        }

        await handleLogin(options.url);
      } catch (error: unknown) {
        logger.error('Login failed:', error);
        process.exitCode = 1;
      }
    });

  return command;
}

export function createLogoutCommand(): Command {
  const command = new Command('logout');

  command
    .description('Clear SSO credentials and logout')
    .action(async (options: { dryRun?: boolean } = {}) => {
      try {
        if (options.dryRun) {
          await previewLogout();
          return;
        }

        await handleLogout();
      } catch (error: unknown) {
        logger.error('Logout failed:', error);
        process.exitCode = 1;
      }
    });

  return command;
}

export function createRefreshCommand(): Command {
  const command = new Command('refresh');

  command
    .description('Refresh SSO credentials')
    .action(async (options: { dryRun?: boolean } = {}) => {
      try {
        if (options.dryRun) {
          await previewRefresh();
          return;
        }

        await handleRefresh();
      } catch (error: unknown) {
        logger.error('Refresh failed:', error);
        process.exitCode = 1;
      }
    });

  return command;
}

async function handleLogin(url?: string): Promise<void> {
  const config = await ConfigLoader.load();

  const codeMieUrl = url || getPlatformUrl(config);
  if (!codeMieUrl) {
    console.log(chalk.red('❌ No AI/Run CodeMie URL configured or provided'));
    console.log(chalk.white('Use: codemie profile login --url https://your-airun-codemie-instance.com'));
    return;
  }

  const spinner = ora('Launching SSO authentication...').start();

  try {
    const sso = new CodeMieSSO();
    const result = await sso.authenticate({ codeMieUrl, timeout: 120000 });

    if (result.success) {
      spinner.succeed(chalk.green('SSO authentication successful'));
      console.log(chalk.cyan(`🔗 Connected to: ${codeMieUrl}`));
      console.log(chalk.cyan(`🔑 Credentials stored securely`));

      console.log('');
      console.log(chalk.bold('  Next Steps:'));
      console.log('');
      console.log('  ' + chalk.white('• Check profile status:') + '  ' + chalk.cyan('codemie profile status'));
      console.log('  ' + chalk.white('• Refresh token:') + '        ' + chalk.cyan('codemie profile refresh'));
      console.log('  ' + chalk.white('• Create profile:') + '       ' + chalk.cyan('codemie setup'));
      console.log('  ' + chalk.white('• Verify system:') + '        ' + chalk.cyan('codemie doctor'));
      console.log('  ' + chalk.white('• Explore more:') + '         ' + chalk.cyan('codemie --help'));
      console.log('');
    } else {
      spinner.fail(chalk.red('SSO authentication failed'));
      console.log(chalk.red(`Error: ${result.error}`));
    }
  } catch (error) {
    spinner.fail(chalk.red('Authentication error'));
    console.log(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
  }
}

async function handleLogout(): Promise<void> {
  const spinner = ora('Clearing SSO credentials...').start();

  try {
    const config = await ConfigLoader.load();
    // Clear only the URL that holds this profile's credentials, so logging out of
    // one environment never wipes the login of another. With no URL, clear the
    // default slot.
    const sso = new CodeMieSSO();
    const found = await getStoredPlatformCredentials(config);
    await sso.clearStoredCredentials(found?.url ?? getPlatformUrl(config));

    spinner.succeed(chalk.green('Successfully logged out'));
    console.log(chalk.white('SSO credentials have been cleared'));
  } catch (error) {
    spinner.fail(chalk.red('Logout failed'));
    console.log(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
  }
}

async function handleRefresh(): Promise<void> {
  const config = await ConfigLoader.load();

  // Check if current provider uses SSO authentication
  const provider = ProviderRegistry.getProvider(config.provider || '');
  if (!provider || provider.authType !== 'sso') {
    console.log(chalk.red('❌ Not configured for SSO authentication'));
    console.log(chalk.white('Run: codemie setup'));
    return;
  }

  // Refresh the URL that actually holds the credentials, else the first candidate
  const url = (await getStoredPlatformCredentials(config))?.url ?? getPlatformUrl(config);
  if (!url) {
    console.log(chalk.red('❌ No AI/Run CodeMie URL configured'));
    console.log(chalk.white('Run: codemie setup'));
    return;
  }

  // Clear existing credentials and re-authenticate against the same URL
  const sso = new CodeMieSSO();
  await sso.clearStoredCredentials(url);

  await handleLogin(url);
}

/**
 * Describes `codemie profile login --dry-run`. Describe-only: it resolves the
 * target URL from read-only config and never constructs a `CodeMieSSO`, starts
 * sign-in, or stores a credential.
 */
async function previewLogin(url?: string): Promise<void> {
  const config = await ConfigLoader.load();
  const codeMieUrl = url || getPlatformUrl(config);

  printAuthPlan([{
    kind: 'store-credential',
    label: 'would start sign-in',
    targets: [codeMieUrl ?? 'no AI/Run CodeMie URL configured or provided']
  }]);
}

/**
 * Describes `codemie profile logout --dry-run`. It resolves the URL from config
 * only: reading the credential store is avoided because an expired lookup can
 * delete an entry, and no credential is ever cleared.
 */
async function previewLogout(): Promise<void> {
  const config = await ConfigLoader.load();

  printAuthPlan([{
    kind: 'remove',
    label: 'would clear stored SSO credentials',
    targets: [getPlatformUrl(config) ?? 'default credential slot']
  }]);
}

/**
 * Describes `codemie profile refresh --dry-run`. The real refresh clears the
 * stored credentials and re-launches sign-in; the preview only says so, without
 * constructing a `CodeMieSSO`, clearing anything, or authenticating.
 */
async function previewRefresh(): Promise<void> {
  const config = await ConfigLoader.load();

  printAuthPlan([{
    kind: 'store-credential',
    label: 'would clear stored credentials and re-authenticate',
    targets: [getPlatformUrl(config) ?? 'default credential slot']
  }]);
}