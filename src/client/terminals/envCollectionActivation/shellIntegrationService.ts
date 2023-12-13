// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { injectable, inject } from 'inversify';
import { IApplicationShell, ITerminalManager, IWorkspaceService } from '../../common/application/types';
import { identifyShellFromShellPath } from '../../common/terminal/shellDetectors/baseShellDetector';
import { TerminalShellType } from '../../common/terminal/types';
import { createDeferred, sleep } from '../../common/utils/async';
import { cache } from '../../common/utils/decorators';
import { traceError, traceInfo, traceVerbose } from '../../logging';
import { IShellIntegrationService } from '../types';

/**
 * This is a list of shells which support shell integration:
 * https://code.visualstudio.com/docs/terminal/shell-integration
 */
const ShellIntegrationShells = [
    TerminalShellType.powershell,
    TerminalShellType.powershellCore,
    TerminalShellType.bash,
    TerminalShellType.zsh,
    TerminalShellType.fish,
];

@injectable()
export class ShellIntegrationService implements IShellIntegrationService {
    constructor(
        @inject(ITerminalManager) private readonly terminalManager: ITerminalManager,
        @inject(IApplicationShell) private readonly appShell: IApplicationShell,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
    ) {}

    public async isWorking(shell: string): Promise<boolean> {
        return this._isWorking(shell).catch((ex) => {
            traceError(`Failed to determine if shell supports shell integration`, shell, ex);
            return false;
        });
    }

    @cache(-1, true)
    public async _isWorking(shell: string): Promise<boolean> {
        const isEnabled = this.workspaceService
            .getConfiguration('terminal')
            .get<boolean>('integrated.shellIntegration.enabled')!;
        if (!isEnabled) {
            traceVerbose('Shell integrated is disabled in user settings.');
        }
        const shellType = identifyShellFromShellPath(shell);
        const isSupposedToWork = isEnabled && ShellIntegrationShells.includes(shellType);
        if (!isSupposedToWork) {
            return false;
        }
        const deferred = createDeferred<void>();
        const timestamp = new Date().getTime();
        const name = `Python ${timestamp}`;
        const onDidExecuteTerminalCommand = this.appShell.onDidExecuteTerminalCommand?.bind(this.appShell);
        if (!onDidExecuteTerminalCommand) {
            // Proposed API is not available, assume shell integration is working at this point.
            return true;
        }
        try {
            const disposable = onDidExecuteTerminalCommand((e) => {
                if (e.terminal.name === name) {
                    deferred.resolve();
                }
            });
            const terminal = this.terminalManager.createTerminal({
                name,
                shellPath: shell,
                hideFromUser: true,
            });
            terminal.sendText(`echo ${shell}`);
            const success = await Promise.race([sleep(3000).then(() => false), deferred.promise.then(() => true)]);
            disposable.dispose();
            if (!success) {
                traceInfo(`Shell integration is not working for ${shellType}`);
            }
            return success;
        } catch (ex) {
            traceVerbose(`Proposed API is not available, failed to subscribe to onDidExecuteTerminalCommand`, ex);
            // Proposed API is not available, assume shell integration is working at this point.
            return true;
        }
    }
}
