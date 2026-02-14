import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import type { ThreadChannel } from 'discord.js';
import type { StateStore } from '../effects/state-store.js';
import type { AskState, PendingApproval } from '../types.js';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'Permission' });
import { buildPermissionRequestEmbed, buildAskQuestionStepEmbed } from '../modules/embeds.js';
import { sendEmbedWithApprovalButtons, sendEmbedWithAskButtons, buildQuestionButtons, sendTextInThread } from '../effects/discord-sender.js';

/** Dependency injection interface for the permission handler */
export interface PermissionHandlerDeps {
  store: StateStore;
  threadId: string;
  thread: ThreadChannel;
  cwd: string;
  /** Timeout in ms for approval requests — auto-deny after this period (0 = no timeout) */
  approvalTimeoutMs: number;
}

/**
 * Creates a canUseTool callback that bridges SDK permission requests to Discord buttons
 *
 * Core mechanism: creates a Promise and stores its resolve in StateStore,
 * SDK pauses and waits for the user to click Approve/Deny on Discord
 *
 * @param deps - Dependencies required by the permission handler
 * @returns An async callback conforming to the SDK CanUseTool type
 */
export function createCanUseTool(deps: PermissionHandlerDeps): CanUseTool {
  return async (toolName, input, options) => {
    const { store, threadId, thread, cwd, approvalTimeoutMs } = deps;

    log.info({ threadId, tool: toolName }, 'Awaiting permission approval');

    // AskUserQuestion special handling: display option buttons one question at a time, supporting multi-select and multiple questions
    if (toolName === 'AskUserQuestion' || toolName === 'AskUser') {
      const typedInput = input as Record<string, unknown>;
      const rawQuestions = typedInput.questions as Array<{
        question?: string;
        header?: string;
        options?: Array<{ label?: string; description?: string }>;
        multiSelect?: boolean;
      }> | undefined;

      if (rawQuestions && rawQuestions.length > 0 && rawQuestions[0]?.options?.length) {
        // Normalize questions
        const questions = rawQuestions.map((q) => ({
          question: q.question || '',
          header: q.header || '',
          options: (q.options || []).map((o) => ({
            label: o.label || 'Option',
            description: o.description || '',
          })),
          multiSelect: q.multiSelect || false,
        }));

        const askState: AskState = {
          totalQuestions: questions.length,
          currentQuestionIndex: 0,
          collectedAnswers: {},
          selectedOptions: new Set(),
          isMultiSelect: questions[0].multiSelect,
          questions,
        };

        const embed = buildAskQuestionStepEmbed(askState);
        const buttons = buildQuestionButtons(threadId, askState);
        const message = await sendEmbedWithAskButtons(thread, embed, buttons);

        // @mention to notify the user that there are questions to answer
        const session = store.getSession(threadId);
        if (session?.userId) {
          await sendTextInThread(thread, `<@${session.userId}> Claude has questions for you to answer.`);
        }

        return new Promise((resolve) => {
          let timeoutId: ReturnType<typeof setTimeout> | null = null;

          const approval: PendingApproval = {
            toolName,
            toolInput: input,
            messageId: message.id,
            resolve: (result) => {
              if (timeoutId) clearTimeout(timeoutId);
              if (result.behavior === 'allow') {
                resolve({
                  behavior: 'allow',
                  updatedInput: (result.updatedInput as Record<string, unknown>) ?? input,
                });
              } else {
                resolve({
                  behavior: 'deny',
                  message: result.message || 'User denied',
                });
              }
            },
            createdAt: new Date(),
            askState,
          };
          store.setPendingApproval(threadId, approval);

          // Approval timeout — auto-deny if user doesn't respond in time
          if (approvalTimeoutMs > 0) {
            timeoutId = setTimeout(() => {
              const pending = store.getPendingApproval(threadId);
              if (pending && pending.messageId === message.id) {
                log.info({ threadId, tool: toolName, timeoutMs: approvalTimeoutMs }, 'Approval timed out');
                store.resolvePendingApproval(threadId, {
                  behavior: 'deny',
                  message: `Permission request timed out after ${Math.round(approvalTimeoutMs / 60000)} minutes`,
                });
                sendTextInThread(thread, `⏰ Approval request timed out after ${Math.round(approvalTimeoutMs / 60000)} minutes. Automatically denied.`).catch(() => {});
              }
            }, approvalTimeoutMs);
          }

          if (options.signal) {
            options.signal.addEventListener('abort', () => {
              if (timeoutId) clearTimeout(timeoutId);
              const pending = store.getPendingApproval(threadId);
              if (pending && pending.messageId === message.id) {
                store.resolvePendingApproval(threadId, {
                  behavior: 'deny',
                  message: 'Task has been stopped',
                });
              }
            }, { once: true });
          }
        });
      }
    }

    // Build permission request Embed
    const embed = buildPermissionRequestEmbed(toolName, input, cwd);

    // Send Embed + Approve/Deny buttons to Thread
    const message = await sendEmbedWithApprovalButtons(thread, embed, threadId);

    // @mention to notify the user that approval is needed
    const session = store.getSession(threadId);
    if (session?.userId) {
      await sendTextInThread(thread, `<@${session.userId}> A tool requires your approval.`);
    }

    // Create Promise, store resolve in StateStore
    return new Promise((resolve) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const approval: PendingApproval = {
        toolName,
        toolInput: input,
        messageId: message.id,
        resolve: (result) => {
          if (timeoutId) clearTimeout(timeoutId);
          if (result.behavior === 'allow') {
            log.info({ threadId, tool: toolName }, 'User approved');
            resolve({
              behavior: 'allow',
              updatedInput: (result.updatedInput as Record<string, unknown>) ?? input,
            });
          } else {
            log.info({ threadId, tool: toolName }, 'User denied');
            resolve({
              behavior: 'deny',
              message: result.message || 'User denied',
            });
          }
        },
        createdAt: new Date(),
      };

      store.setPendingApproval(threadId, approval);

      // Approval timeout — auto-deny if user doesn't respond in time
      if (approvalTimeoutMs > 0) {
        timeoutId = setTimeout(() => {
          const pending = store.getPendingApproval(threadId);
          if (pending && pending.messageId === message.id) {
            log.info({ threadId, tool: toolName, timeoutMs: approvalTimeoutMs }, 'Approval timed out');
            store.resolvePendingApproval(threadId, {
              behavior: 'deny',
              message: `Permission request timed out after ${Math.round(approvalTimeoutMs / 60000)} minutes`,
            });
            sendTextInThread(thread, `⏰ Approval request timed out after ${Math.round(approvalTimeoutMs / 60000)} minutes. Automatically denied.`).catch(() => {});
          }
        }, approvalTimeoutMs);
      }

      // If AbortSignal fires, auto-deny
      if (options.signal) {
        options.signal.addEventListener(
          'abort',
          () => {
            if (timeoutId) clearTimeout(timeoutId);
            const pending = store.getPendingApproval(threadId);
            if (pending && pending.messageId === message.id) {
              store.resolvePendingApproval(threadId, {
                behavior: 'deny',
                message: 'Task has been stopped',
              });
            }
          },
          { once: true },
        );
      }
    });
  };
}
