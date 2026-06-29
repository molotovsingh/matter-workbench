export const USER_FACING_ASSISTANT_UNAVAILABLE_MESSAGE: string;
export const USER_FACING_ASSISTANT_UNAVAILABLE_CODE: string;
export const USER_FACING_RESTRICTED_AI_LANGUAGE_PATTERN: RegExp;
export function containsUserFacingRestrictedAiLanguage(value: unknown): boolean;
export function isAssistantAvailabilityError(value: unknown, code?: string): boolean;
export function userFacingAiErrorMessage(value: unknown, code?: string): string;
export function userFacingAiErrorCode(value: unknown, code?: string): string;
